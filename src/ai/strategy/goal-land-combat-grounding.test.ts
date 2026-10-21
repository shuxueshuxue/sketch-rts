import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { UNIT_DEFS } from '../../shared/catalog';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { effectiveCombatRating, structureRating } from '../policy/v6/strength';
import { goalFact } from './goal-facts';
import { goalLandActionProvider } from './goal-land-actions';
import { readGoalLandCapabilityFact } from './goal-land-facts';
import { assessGoalLandEngagement, createGoalLandCombatGrounding, type GoalLandCombatGroundingPorts } from './goal-land-combat-grounding';
import type { GoalCombatOption, GoalEstimate, GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import { assessLandCombatAttrition, landCombatWorkTicks } from './land-combat-assessment';
import { landIdAt, regionIndex } from './regions';
import { evaluateSituation, situationConstructionCount } from './situation';

const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['published-input'] });
const ref = (entityId: string) => ({ kind: 'existing' as const, entityId });
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
function observed(fact: GoalFact, tick: number, ticks = 20): GoalFactObservation {
  return { fact, state: 'met', observedTick: tick, availableTick: tick, revision: `published-${ticks}`, evidence: [],
    reason: { code: 'published-route', factIds: [fact.id], values: {} }, route: { distance: 100, points: [], ticks } };
}
function fixture(options: { hp?: number; targetX?: number; spread?: boolean; counter?: boolean; responder?: boolean; tower?: boolean; readFact?: (fact: GoalFact, tick: number) => GoalFactObservation } = {}) {
  let scene = sketchScene('land-exact-target-native-assessment').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us', race: 'grove' }).player('foe', { team: 'foe', race: 'ember' }).player('ally', { team: 'us' })
    .townHall('foe', options.targetX ?? 1500, 1200, { id: 'enemy-site', hp: options.hp ?? 100 })
    .townHall('us', 400, 400, { id: 'home' })
    .unit('us', 'footman', 1000, 1200, { id: 'fighter-a', hp: 35 })
    .unit('us', 'archer', options.spread ? 2000 : 1020, 1200, { id: 'fighter-b', hp: 30 })
    .unit('ally', 'horseArcher', 900, 1200, { id: 'ally-fighter' });
  if (options.counter) scene = scene.unit('us', 'horseArcher', 980, 1220, { id: 'counter' })
    .unit('foe', 'horseArcher', 1450, 1200, { id: 'harasser', hp: 10 });
  if (options.responder) scene = scene.unit('foe', 'emberRavager', 1600, 1200, { id: 'responder' });
  if (options.tower) scene = scene.tower('foe', 1520, 1250, { id: 'battery' });
  const snapshot = snapshotGame(scene.build().createGame()); regionIndex(snapshot.map);
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory());
  let context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_knight',
    readFact: fact => options.readFact ? options.readFact(fact, snapshot.tick) : observed(fact, snapshot.tick) };
  const ports: GoalLandCombatGroundingPorts = {
    resolveCohort: refs => ({ state: 'met', factIds: ['native-cohort'], candidates: refs.flatMap(reference => {
      const assessment = reference.kind === 'existing' ? snapshot.units.find(unit => unit.id === reference.entityId) : undefined;
      return assessment ? [{ reference, assessment }] : [];
    }) }),
    arrival: () => ({ status: 'reachable', ticks: 20, landTicks: 20, crossings: [] }),
    landRoute: (from, to) => ({ status: 'known', distance: Math.hypot(from.x - to.x, from.y - to.y), points: [from, to] }),
    movementRisk: () => known({ expectedLossGold: 7, survivalProbability: .8 }),
  };
  const at = { entityId: 'enemy-site', landId: landIdAt(snapshot.map, { x: options.targetX ?? 1500, y: 1200 })!, point: { x: options.targetX ?? 1500, y: 1200 } };
  const effect = goalFact({ kind: 'enemy-site-destroyed', site: at });
  const factory = createGoalLandCombatGrounding(context, ports);
  context = { ...context, grounding: { ...factory, resolveCohort: ports.resolveCohort,
    buildSites: () => { throw Error('combat private build selector'); }, productionOptions: () => { throw Error('combat private train selector'); },
    transportOptions: () => { throw Error('combat private transport selector'); } } };
  return { context, ports, at, effect, read: factory.combatOptions! };
}
function rows(result: ReturnType<NonNullable<ReturnType<typeof createGoalLandCombatGrounding>['combatOptions']>>): readonly GoalCombatOption[] {
  expect(result.state).toBe('met'); if (result.state !== 'met') throw Error(JSON.stringify(result)); return result.candidates;
}
function full(f: ReturnType<typeof fixture>, effect = f.effect) { return rows(strict(() => f.read(effect))).find(option => option.cohort.length === 2)!; }

describe('land combat grounding from real targets and published physical facts', () => {
  it('quotes rolling hold attrition over the current response window and retains the complete control duration', () => {
    const f = fixture({ responder: true, tower: true }), before = JSON.stringify(f.context.snapshot);
    // A shorter supported observation makes native damage remain below the
    // death-cost cap, so accidentally pricing 12000 ticks cannot pass merely
    // because both long losses have saturated at the cohort's replacement.
    const base = { ...f.context, situation: { ...f.context.situation, horizonTicks: 60 } };
    const factory = createGoalLandCombatGrounding(base, f.ports);
    const context = { ...base, grounding: { ...f.context.grounding!, ...factory } };
    const read = (effect: GoalFact) => rows(factory.combatOptions!(effect)).find(option => option.cohort.length === 2)!;
    const short = goalFact({ kind: 'route-controlled', at: f.at, throughTick: context.tick + context.situation.horizonTicks });
    const long = goalFact({ kind: 'route-controlled', at: f.at, throughTick: f.context.tick + 12000 });
    const current = read(short), retained = read(long);
    expect(current.cost.state).toBe('met'); expect(retained.cost.state).toBe('met');
    if (current.cost.state !== 'met' || retained.cost.state !== 'met') throw Error('current observed battle unpublished');
    expect(retained.cost.value.map(term => ({ code: term.code, gold: term.gold })))
      .toEqual(current.cost.value.map(term => ({ code: term.code, gold: term.gold })));
    expect(retained.cost.value.some(term => term.gold > 0)).toBe(true);
    expect(retained.successProbability).toMatchObject({ state: 'met' });
    if (current.successProbability.state !== 'met' || retained.successProbability.state !== 'met') throw Error('current P missing');
    expect(retained.successProbability.value).toBe(current.successProbability.value);
    expect(retained.successProbability.value).toBeLessThan(1);
    const price = f.context.snapshot.units.filter(unit => unit.owner === 'us')
      .reduce((sum, unit) => sum + UNIT_DEFS[unit.kind].cost, 0);
    expect(retained.cost.value.find(term => term.code === 'land-native-expected-attrition')!.gold)
      .toBeLessThan(price * (1 - retained.successProbability.value));
    expect(retained.duration).toMatchObject({ state: 'met', value: 12000 });
    expect(retained.byTick).toBe(f.context.tick + 12000);
    const action = goalLandActionProvider.actionsFor(long, context).find(action => (action.executor.parameters.cohort as unknown[]).length === 2)!;
    expect(action.effects[0]!.fact).toEqual(long);
    expect(action.executor.parameters).toMatchObject({ throughTick: f.context.tick + 12000, protectionWindowTicks: context.situation.horizonTicks });
    expect(action.demands.every(demand => demand.until === 'finish')).toBe(true);
    expect(JSON.stringify(f.context.snapshot)).toBe(before);
  });

  it('retains unpublished current responders for a rolling hold instead of inventing protection', () => {
    const f = fixture({ responder: true, readFact: (fact, tick) => fact.predicate.kind === 'route'
      && fact.predicate.actor?.kind === 'existing' && fact.predicate.actor.entityId === 'responder'
      ? { ...observed(fact, tick), state: 'pending', requestedTick: tick, requestId: 'current-responder-route' } : observed(fact, tick) });
    const effect = goalFact({ kind: 'route-controlled', at: f.at, throughTick: f.context.tick + 12000 });
    expect(full(f, effect).cost).toMatchObject({ state: 'pending', requestIds: ['current-responder-route'] });
    expect(full(f, effect).successProbability.state).toBe('pending');
  });
  it('includes real building HP in work and does not run a second Situation, selector or path query', () => {
    const f = fixture(), doubleFixture = fixture({ hp: 200 }), before = JSON.stringify(f.context.snapshot), count = situationConstructionCount();
    const option = full(f), fighters = f.context.snapshot.units.filter(unit => unit.owner === 'us');
    const target = f.context.snapshot.buildings.find(building => building.id === 'enemy-site')!;
    expect(option.duration).toMatchObject({ state: 'met', value: 20 + landCombatWorkTicks([target], fighters) });
    const doubled = full(doubleFixture);
    expect(doubled.duration.state).toBe('met');
    if (option.duration.state === 'met' && doubled.duration.state === 'met') expect(doubled.duration.value - 20).toBe((option.duration.value - 20) * 2);
    expect(option.cost.state).toBe('met'); expect(option.successProbability).toMatchObject({ state: 'met', value: .8 });
    expect(rows(f.read(f.effect))).toHaveLength(3);
    const actions = strict(() => goalLandActionProvider.actionsFor(f.effect, f.context));
    expect(actions).toHaveLength(3); expect(actions.every(action => action.kind === 'destroy-target')).toBe(true);
    expect(actions.every(action => JSON.stringify(action).includes('ally-fighter'))).toBe(false);
    expect(situationConstructionCount()).toBe(count); expect(JSON.stringify(f.context.snapshot)).toBe(before);
  });

  it('uses original land field-strength P/attrition and separately measures native combat-rating', () => {
    const f = fixture({ responder: true, tower: true }), option = full(f), { snapshot, situation } = f.context;
    const fighters = snapshot.units.filter(unit => unit.owner === 'us'), responder = snapshot.units.find(unit => unit.id === 'responder')!;
    const target = snapshot.buildings.find(building => building.id === 'enemy-site')!, tower = snapshot.buildings.find(building => building.id === 'battery')!;
    const workTicks = landCombatWorkTicks([target], fighters);
    const power = situation.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.strength, 0);
    const fieldRequired = situation.units.find(unit => unit.id === responder.id)!.strength + structureRating(tower);
    const original = assessLandCombatAttrition({ tick: snapshot.tick, arrivalTicks: 20, workTicks, fighters,
      fieldStrength: power, requiredFieldStrength: fieldRequired,
      firing: [{ body: responder, arrivalTicks: 20, expiresTick: null }, { body: tower, arrivalTicks: null, expiresTick: null }] });
    expect(option.requiredForce).toBe(effectiveCombatRating(snapshot, responder) + structureRating(tower));
    expect(option.requiredForce).not.toBeCloseTo(fieldRequired, 6);
    expect(option.successProbability).toMatchObject({ state: 'met', value: .8 * original.successProbability });
    expect(option.cost).toMatchObject({ state: 'met', value: [
      { code: 'land-native-expected-attrition', gold: .8 * original.expectedLossGold }, { code: 'combat-movement-loss', gold: 7 },
    ] });
    expect(original.damage).toBeGreaterThan(0);
  });

  it('keeps stable missing opponent ETA, current future availability and unquoted risk pending', () => {
    const f = fixture({ responder: true, readFact: (fact, tick) => fact.predicate.kind === 'route'
      && fact.predicate.actor?.kind === 'existing' && fact.predicate.actor.entityId === 'responder'
      ? { ...observed(fact, tick), state: 'pending', requestedTick: tick, requestId: 'shared-enemy-road' }
      : observed(fact, tick) });
    expect(full(f).cost).toMatchObject({ state: 'pending', requestIds: ['shared-enemy-road'] });
    const later = fixture({ readFact: (fact, tick) => ({ ...observed(fact, tick), availableTick: tick + 100 }) });
    expect(full(later).duration.state).toBe('pending');
    const missing = fixture(), { movementRisk: _risk, ...ports } = missing.ports;
    const option = rows(strict(() => createGoalLandCombatGrounding(missing.context, ports).combatOptions!(missing.effect)))[0]!;
    expect(option.duration.state).toBe('met'); expect(option.cost).toMatchObject({ state: 'pending', reason: { code: 'land-combat-movement-risk-unquoted' } });
    expect(option.successProbability.state).toBe('pending');
  });

  it('does not borrow excluded/interrupted units or trust a healthier resolved assessment copy', () => {
    const f = fixture(), ports = { ...f.ports, allowedUnitIds: ['fighter-a', 'fighter-b'], interruptedUnitIds: ['fighter-b'],
      resolveCohort: (refs: Parameters<typeof f.ports.resolveCohort>[0]) => {
        const result = f.ports.resolveCohort(refs); return result.state === 'met' ? { ...result,
          candidates: result.candidates.map(member => ({ ...member, assessment: { ...member.assessment, hp: 9999, attackDamage: 9999 } })) } : result;
      } };
    const option = rows(strict(() => createGoalLandCombatGrounding(f.context, ports).combatOptions!(f.effect)))[0]!;
    expect(option.cohort).toEqual([ref('fighter-a')]);
    const target = f.context.snapshot.buildings.find(unit => unit.id === 'enemy-site')!, raw = f.context.snapshot.units.find(unit => unit.id === 'fighter-a')!;
    expect(option.duration).toMatchObject({ state: 'met', value: 20 + landCombatWorkTicks([target], [raw]) });
  });

  it('declares persistent holding and exact-cohort interception instead of substituting camp or defense actions', () => {
    const f = fixture({ counter: true }), hold = goalFact({ kind: 'route-controlled', at: f.at, throughTick: 900 });
    const holding = strict(() => goalLandActionProvider.actionsFor(hold, f.context));
    expect(holding.length).toBeGreaterThan(0); expect(holding.every(action => action.kind === 'hold-position' && action.effects[0]!.at === 'start')).toBe(true);
    expect(holding.every(action => action.duration.state === 'met' && action.duration.value === 900 - f.context.tick)).toBe(true);
    const site = { ...f.at, entityId: 'harasser', point: { x: 1450, y: 1200 } }, effect = goalFact({ kind: 'harassment-ended', site, throughTick: 900 });
    const actions = strict(() => goalLandActionProvider.actionsFor(effect, f.context));
    expect(actions.every(action => action.kind === 'engage-units')).toBe(true);
    const weak = actions.find(action => JSON.stringify(action.executor.parameters.cohort) === JSON.stringify([ref('fighter-a')]))!;
    const counter = actions.find(action => JSON.stringify(action.executor.parameters.cohort) === JSON.stringify([ref('counter')]))!;
    const capability = (action: typeof weak) => action.preconditions.find(fact => fact.predicate.kind === 'interception-capability')!;
    expect(readGoalLandCapabilityFact(capability(weak), f.context, { regionAt: point => landIdAt(f.context.snapshot.map, point) ?? null })?.state).toBe('unmet');
    expect(readGoalLandCapabilityFact(capability(counter), f.context, { regionAt: point => landIdAt(f.context.snapshot.map, point) ?? null })?.state).toBe('met');
  });

  it('retains unsupported multi-target, response support and future pool gaps rather than inventing successful estimates', () => {
    const f = fixture(), option = full(f), cohort = f.context.snapshot.units.filter(unit => unit.owner === 'us').map(assessment => ({ reference: ref(assessment.id), assessment }));
    const request = { effect: f.effect, cohort, target: f.at, from: f.at, routes: [], arrivalTicks: known(0), throughTick: 2400 };
    const symbolic = strict(() => assessGoalLandEngagement({ context: f.context,
      request: { ...request, cohort: [{ reference: { kind: 'binding', name: 'source-owned-pool-slot' }, assessment: cohort[0]!.assessment }] },
      opponents: known([]), movementRisk: known({ expectedLossGold: 0, survivalProbability: 1 }) }));
    expect(symbolic).toMatchObject({ state: 'pending', reason: { code: 'land-future-pool-projection-required' } });
    const oversized = { ...request, arrivalTicks: known(2399) };
    const delayed = rows(assessGoalLandEngagement({ context: f.context, request: oversized, opponents: known([]), movementRisk: known({ expectedLossGold: 0, survivalProbability: 1 }) }))[0]!;
    expect(delayed.duration).toMatchObject({ state: 'pending', reason: { code: 'land-combat-response-window-uncovered' } });
    expect(option.duration.state).toBe('met');
    expect(f.read(f.effect)).toMatchObject({ state: 'met', deferred: [{ reason: { code: 'land-future-pool-projection-required' } }] });
    const foreign = strict(() => assessGoalLandEngagement({ context: f.context,
      request: { ...request, cohort: [{ reference: ref('ally-fighter'), assessment: cohort[0]!.assessment }] }, opponents: known([]),
      movementRisk: known({ expectedLossGold: 0, survivalProbability: 1 }) }));
    expect(foreign.state).toBe('unmet');
  });

  it('preserves IDs and estimates across JSON and repeated queries without mutating input', () => {
    const f = fixture({ responder: true }), before = JSON.stringify(f.context.snapshot), first = strict(() => f.read(f.effect));
    expect(strict(() => f.read(JSON.parse(JSON.stringify(f.effect))))).toEqual(first);
    const forkContext = { ...f.context, snapshot: JSON.parse(before), situation: JSON.parse(JSON.stringify(f.context.situation)) };
    expect(strict(() => createGoalLandCombatGrounding(forkContext, f.ports).combatOptions!(f.effect))).toEqual(first);
    expect(JSON.stringify(f.context.snapshot)).toBe(before);
  });

  it('consumes shared origin prerequisites and preserves future pool/deferred dependencies without parsing binding names', () => {
    const f = fixture(), actor = f.context.snapshot.units.find(unit => unit.id === 'fighter-a')!;
    const prerequisite = goalFact({ kind: 'unit-available', unitKind: actor.kind, count: 1, at: f.at, byTick: 200 });
    const factory = createGoalLandCombatGrounding(f.context, { ...f.ports, cohortOptions: () => ({ state: 'met', factIds: ['source-origins'],
      candidates: [
        { id: 'source-actual', from: f.at, members: [{ reference: ref(actor.id), assessment: actor }], preconditions: [prerequisite],
          availableTick: f.context.tick, factIds: ['source-actual-fact'] },
        { id: 'source-future', from: f.at, members: [{ reference: { kind: 'binding', name: 'opaque-central-registry-key' }, assessment: actor }],
          preconditions: [prerequisite], availableTick: null, factIds: ['source-future-fact'] },
      ], deferred: [{ id: 'unpublished-alternative', requestIds: ['original-source-request'],
        reason: { code: 'source-origin-pending', factIds: [], values: {} } }],
    }) });
    const result = strict(() => factory.combatOptions!(f.effect)), option = rows(result)[0]!;
    expect(option.preconditions).toContainEqual(prerequisite); expect(option.factIds).toContain('source-actual-fact');
    expect(result).toMatchObject({ state: 'met', deferred: [
      { requestIds: ['original-source-request'] }, { id: 'source-future', reason: { code: 'land-future-pool-projection-required' } },
    ] });
    expect(JSON.stringify(option)).not.toContain('opaque-central-registry-key');
  });

  it('keeps named multi-target harassment pending instead of charging the same one-target damage twice', () => {
    const f = fixture({ counter: true, responder: true });
    const effect = goalFact({ kind: 'harassment-ended', site: f.at, throughTick: 900, unitIds: ['harasser', 'responder'] });
    const options = rows(strict(() => f.read(effect)));
    expect(options.length).toBeGreaterThan(0);
    expect(options.every(option => option.duration.state === 'pending' && option.duration.reason.code === 'land-multi-target-engagement-unpublished')).toBe(true);
    expect(options.every(option => option.cost.state === 'pending' && option.successProbability.state === 'pending')).toBe(true);
    const named = goalFact({ kind: 'harassment-ended', site: { ...f.at, entityId: 'harasser', point: { x: 1450, y: 1200 } },
      throughTick: 900, unitIds: ['harasser'] });
    const actions = goalLandActionProvider.actionsFor(named, f.context);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every(action => action.effects.some(effect => effect.fact.id === named.id)
      && JSON.stringify(action.executor.parameters.threatUnitIds) === '["harasser"]')).toBe(true);
  });

  it('uses the same Arrival port for real 4180 remote/aboard opposition, distinguishing known unreachable from pending', () => {
    const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
      new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
    const before = JSON.stringify(snapshot), situation = evaluateSituation(snapshot, owner, createAiPolicyMemory());
    const unit = snapshot.units.find(unit => unit.id === 'unit-p4-emberRavager-1207')!;
    const at = { landId: landIdAt(snapshot.map, unit)!, point: { x: unit.x, y: unit.y } };
    const context: GoalPlanningContext = { snapshot, owner, situation, tick: snapshot.tick, version: 'v9_knight',
      readFact: fact => observed(fact, snapshot.tick) };
    let remoteCalls = 0;
    const ports: GoalLandCombatGroundingPorts = { allowedUnitIds: [unit.id],
      landRoute: (from, to) => ({ status: 'known', distance: 100, points: [from, to] }),
      resolveCohort: refs => ({ state: 'met', factIds: [], candidates: refs.flatMap(reference => {
        const assessment = reference.kind === 'existing' ? snapshot.units.find(unit => unit.id === reference.entityId) : undefined;
        return assessment ? [{ reference, assessment }] : [];
      }) }),
      movementRisk: () => known({ expectedLossGold: 0, survivalProbability: 1 }),
      arrival: actor => actor.owner === owner ? { status: 'reachable', ticks: 20, landTicks: 20, crossings: [] }
        : (remoteCalls++, { status: 'unreachable', reason: { code: 'published-no-response-route', factIds: [actor.id] } }),
    };
    const effect = goalFact({ kind: 'route-controlled', at, throughTick: snapshot.tick + 600 });
    const result = strict(() => createGoalLandCombatGrounding(context, ports).combatOptions!(effect));
    expect(rows(result)[0]!.cost.state).toBe('met'); expect(remoteCalls).toBeGreaterThan(0);
    const missing = strict(() => createGoalLandCombatGrounding(context, { ...ports,
      arrival: actor => actor.owner === owner ? { status: 'reachable', ticks: 20, landTicks: 20, crossings: [] }
        : { status: 'unknown', reason: { code: 'shared-crossing-unpublished', factIds: ['original-response-request'] } },
    }).combatOptions!(effect));
    expect(rows(missing)[0]!.cost).toMatchObject({ state: 'pending', reason: { code: 'land-combat-opponent-arrival-pending' } });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('binds assembly to its own post and preserves the hostile executor/effect target without a safety cycle', () => {
    const f = fixture(), option = full(f), action = strict(() => goalLandActionProvider.actionsFor(f.effect, f.context))
      .find(action => Array.isArray(action.executor.parameters.cohort) && action.executor.parameters.cohort.length === 2)!;
    expect(option.post).toEqual({ landId: f.at.landId, point: { x: 1000, y: 1200 } });
    expect(option.post?.point).not.toEqual(f.at.point);
    expect(action.preconditions.find(fact => fact.predicate.kind === 'force-at')?.predicate).toMatchObject({ at: option.post });
    expect(action.executor.parameters.target).toEqual(f.at); expect(action.effects[0]!.fact).toEqual(f.effect);
  });

  it('does not bill current-to-post movement inside hold or an already in-range attack', () => {
    const f = fixture(), forbidden = () => { throw Error('stationary primitive priced assembly movement'); };
    const hold = goalFact({ kind: 'route-controlled', at: f.at, throughTick: 900 });
    const options = rows(strict(() => createGoalLandCombatGrounding(f.context, { ...f.ports, arrival: forbidden, movementRisk: forbidden }).combatOptions!(hold)));
    expect(options.every(option => option.duration.state === 'met' && option.duration.value === 900 - f.context.tick)).toBe(true);
    expect(options.every(option => option.cost.state === 'met' && option.cost.value.find(term => term.code === 'combat-movement-loss')?.gold === 0)).toBe(true);
    const near = fixture({ targetX: 1100 }), attacked = rows(strict(() => createGoalLandCombatGrounding(near.context,
      { ...near.ports, arrival: forbidden, movementRisk: forbidden }).combatOptions!(near.effect)))[0]!;
    const units = near.context.snapshot.units.filter(unit => unit.owner === 'us'), body = near.context.snapshot.buildings.find(building => building.id === 'enemy-site')!;
    expect(attacked.duration).toMatchObject({ state: 'met', value: landCombatWorkTicks([body], units) });
  });

  it('keeps the future post-to-contact quote pending for a scattered group instead of double-charging its current assembly march', () => {
    const f = fixture({ spread: true }), option = full(f);
    expect(option.duration).toMatchObject({ state: 'pending', reason: { code: 'land-primitive-from-post-geometry-pending' } });
    expect(option.cost.state).toBe('pending'); expect(option.post?.point).toEqual({ x: 1000, y: 1200 });
    expect(rows(f.read(f.effect)).some(option => option.cohort.length === 1 && option.duration.state === 'met')).toBe(true);
  });
});
