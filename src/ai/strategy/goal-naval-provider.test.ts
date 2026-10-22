import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { effectiveCombatRating } from '../policy/v6/strength';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { goalCampId, goalFact, goalValueKey } from './goal-facts';
import { goalNavalActionProvider } from './goal-naval-provider';
import { evaluateSituation } from './situation';
import { landIdAt } from './regions';
import type { GameSnapshot } from '../../shared/types';
import type { GoalNavalMember } from './goal-naval-actions';
import type { GoalCandidates, GoalCombatOption, GoalEntityReference, GoalEstimate, GoalFact, GoalPlanningContext, GoalTransportOption } from './goal-planner-types';

const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['shared-assessment'] });
const choices = <T>(candidates: readonly T[]): GoalCandidates<T> => ({ state: 'met', candidates, factIds: ['published-domain'] });
const pending = { state: 'pending' as const, requestIds: ['stable-work'], reason: { code: 'shared-work-pending', factIds: [], values: {} } };
function fixture() {
  const snapshot = snapshotGame(sketchScene('naval-provider-atoms').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us' }).player('them', { team: 'them' })
    .townHall('us', 400, 400).townHall('them', 4000, 4000)
    .unit('us', 'footman', 500, 500, { id: 'fighter' }).worker('us', 530, 500, { id: 'worker' })
    .unit('us', 'transport', 600, 600, { id: 'hull' }).unit('them', 'footman', 1200, 1000, { id: 'threat' })
    .unit('neutral', 'ogreWarrior', 2000, 2000, { id: 'guard' }).build().createGame());
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory());
  const from = { landId: 'land:1' as const, point: { x: 500, y: 500 } }, at = { landId: 'land:1' as const, point: { x: 1000, y: 1000 } };
  const cohort: GoalEntityReference[] = [{ kind: 'existing', entityId: 'fighter' }];
  const route = goalFact({ kind: 'route', mover: 'land', from, to: at, actor: cohort[0]! });
  const option: GoalCombatOption = { id: 'physical-combat', target: at, from, cohort, requiredForce: 20,
    byTick: 2000, duration: known(50), cost: known([{ code: 'catalog-loss', gold: 9, factIds: ['native-forecast'] }]),
    successProbability: known(.8), preconditions: [route], factIds: [route.id] };
  const prototypes = new Map<string, GoalNavalMember>();
  const context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_summoner',
    readFact: fact => ({ fact, state: 'unmet', observedTick: snapshot.tick, revision: 'actual-threats',
      reason: { code: 'threat-observed', factIds: ['threat'], values: {} }, evidence: [], threats: { unitIds: ['threat'], campIds: [], requiredForce: 20 } }),
    grounding: { buildSites: () => { throw Error('naval provider tried economic grounding'); },
      productionOptions: () => { throw Error('naval provider tried economic grounding'); }, transportOptions: () => choices([]),
      combatOptions: vi.fn(() => choices([option])), resolveCohort: refs => choices(refs.flatMap(reference => {
        const prototype = prototypes.get(goalValueKey(reference)); if (prototype) return [prototype];
        const unit = reference.kind === 'existing' ? snapshot.units.find(unit => unit.id === reference.entityId) : undefined;
        return unit ? [{ reference, assessment: unit }] : [];
      })) } };
  const campId = goalCampId(neutralCampExposure(snapshot).camps[0]!.memberIds);
  return { context, option, from, at, route, campId, prototypes };
}
function strict(effect: GoalFact, context: GoalPlanningContext) {
  return withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
  }, () => withNavigationPhase('strategy-planning', () => goalNavalActionProvider.actionsFor(effect, context)));
}

describe('naval provider consumes shared physical alternatives', () => {
  it('keeps an actual aboard member conditional on its exact landing pool without declaring current arrival', () => {
    const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
      new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
    const situation = evaluateSituation(snapshot, owner, createAiPolicyMemory()), before = JSON.stringify(snapshot);
    const unit = snapshot.units.find(unit => unit.owner === owner && unit.kind !== 'worker' && (unit.deck || unit.cabin))!;
    expect(unit).toBeDefined();
    const reference: GoalEntityReference = { kind: 'existing', entityId: unit.id };
    const mine = snapshot.resources.find(resource => resource.id === 'gold-satellite-4')!;
    const from = { landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
    const camp = neutralCampExposure(snapshot).camps.find(camp => camp.memberIds.includes('satellite-guard-4-0'))!;
    const campId = goalCampId(camp.memberIds), pool = goalFact({ kind: 'force-available', at: from, cohort: [reference],
      metric: 'combat-rating', minimum: 1, byTick: 9000 });
    const option: GoalCombatOption = { id: 'published-conditional-camp', target: from, from, cohort: [reference],
      requiredForce: 2, byTick: 9000, duration: known(50), cost: known([{ code: 'native-camp-loss', gold: 9, factIds: [campId] }]),
      successProbability: known(.8), preconditions: [pool], factIds: ['published-landing'] };
    const context: GoalPlanningContext = { snapshot, owner, situation, tick: snapshot.tick, version: 'v9_knight',
      readFact: fact => ({ fact, state: 'unmet', observedTick: snapshot.tick, revision: 'still-aboard', evidence: [],
        reason: { code: 'current-pool-missing', factIds: [fact.id], values: {} } }),
      grounding: { buildSites: () => choices([]), productionOptions: () => choices([]), transportOptions: () => choices([]),
        combatOptions: () => choices([option]), resolveCohort: () => choices([{ reference, assessment: unit }]) } };
    const effect = goalFact({ kind: 'camp-cleared', campId });
    const actions = strict(effect, context);
    expect(actions).toHaveLength(1); expect(actions[0]!.kind).toBe('clear-camp');
    expect(actions[0]!.preconditions).toContainEqual(pool);
    expect(actions[0]!.executor.parameters.cohort).toEqual([reference]);
    expect(actions[0]!.cost).toEqual(option.cost); expect(actions[0]!.successProbability).toEqual(option.successProbability);
    expect(context.readFact(pool).state).toBe('unmet');
    const plain = { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, preconditions: [] }]) } };
    expect(strict(effect, plain)).toEqual([]);
    const mismatched = goalFact({ kind: 'force-available', at: from, cohort: [{ kind: 'existing', entityId: 'someone-else' }],
      metric: 'combat-rating', minimum: 1, byTick: 9000 });
    expect(strict(effect, { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, preconditions: [mismatched] }]) } })).toEqual([]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('exposes clearing and native bounty contributors without writing an action chain', () => {
    const { context, campId, option } = fixture(), effect = goalFact({ kind: 'camp-cleared', campId });
    const before = JSON.stringify(context.snapshot), actions = strict(effect, context);
    expect(actions).toHaveLength(1); expect(actions[0]!.kind).toBe('clear-camp');
    expect(actions[0]!.preconditions).toContainEqual(option.preconditions[0]);
    expect(actions[0]!.cost).toEqual(option.cost); expect(actions[0]!.successProbability).toEqual(option.successProbability);
    expect(actions[0]!.effects[0]!.fact).toEqual(effect); expect(actions[0]).not.toHaveProperty('dependsOn');
    expect(JSON.stringify(context.snapshot)).toBe(before);
    const gold = strict(goalFact({ kind: 'gold', minimum: 1000, byTick: 2000 }), { ...context,
      grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, campId }]) } });
    expect(gold).toHaveLength(1); expect(gold[0]!.flows[0]!.delta).toBeGreaterThan(0);
    expect(gold[0]!.flows.reduce((sum, flow) => sum + flow.delta, 0)).toBeLessThan(1000);
  });

  it('keeps partial force contributions and future identities bound to source assessments', () => {
    const { context, option, at, prototypes } = fixture();
    const reference: GoalEntityReference = { kind: 'output', actionId: 'train', output: 'unit-0' };
    const assessment = { ...context.snapshot.units.find(unit => unit.id === 'fighter')!, id: 'private-evaluation' };
    prototypes.set(goalValueKey(reference), { reference, assessment });
    const source = { ...option, cohort: [reference], duration: pending, cost: pending, successProbability: pending };
    const actions = strict(goalFact({ kind: 'force-at', at, minimum: 50, metric: 'combat-rating', byTick: 2000 }),
      { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([source]) } });
    expect(actions).toHaveLength(1); expect(actions[0]!.kind).toBe('assemble');
    expect(actions[0]!.duration).toEqual(pending); expect(actions[0]!.cost).toEqual(pending);
    expect(actions[0]!.effects[0]!.fact.predicate).toMatchObject({ cohort: [reference], minimum: effectiveCombatRating(context.snapshot, assessment) });
    expect(JSON.stringify(actions)).not.toContain('private-evaluation');
    expect(actions[0]!.preconditions.some(fact => fact.predicate.kind === 'assembly-post')).toBe(true);
    expect(actions[0]!.preconditions.some(fact => fact.predicate.kind === 'site-safe')).toBe(false);
  });

  it('separates hostile shore removal, defense and exact rescue effects', () => {
    const { context, option, at } = fixture();
    const shore = goalFact({ kind: 'shore-safe', landId: at.landId, landing: at, throughTick: 2000 });
    expect(strict(shore, context)[0]!.kind).toBe('clear-shore');
    expect(strict(shore, context)[0]!.effects[0]!.fact).toEqual(shore);
    expect(strict(goalFact({ kind: 'site-safe', site: at, throughTick: 2000 }), { ...context,
      grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, duration: known(2000) }]) } })[0]!.kind).toBe('defend');
    const rescue = goalFact({ kind: 'assets-safe', unitIds: ['worker'], at, throughTick: 2000 });
    const worker = { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, cohort: [{ kind: 'existing' as const, entityId: 'worker' }] }]) } };
    expect(strict(rescue, worker)[0]!.kind).toBe('evacuate');
    expect(strict(goalFact({ kind: 'assets-safe', unitIds: ['other-worker'], at, throughTick: 2000 }), worker)).toEqual([]);
  });

  it('moves an empty hull without inventing a land departure or a landing shore', () => {
    const { context, option } = fixture(), transport: GoalEntityReference = { kind: 'existing', entityId: 'hull' };
    const at = { seaId: 'sea:1' as const, point: { x: 800, y: 1000 } };
    const effect = goalFact({ kind: 'transport-at', transport, at, tolerance: 36, byTick: 2000 });
    const ctx = { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, cohort: [transport], target: at }]) } };
    const actions = strict(effect, ctx);
    expect(actions).toHaveLength(1); expect(actions[0]!.effects[0]!.fact).toEqual(effect);
    expect(actions[0]!.executor.parameters).not.toHaveProperty('landing');
    expect(actions[0]!.executor.parameters).not.toHaveProperty('departure');
    expect(actions[0]!.demands).toHaveLength(1);
  });

  it('preserves per-hull prices and leaves missing crossing assessments pending', () => {
    const { context, option, from } = fixture(), at = { landId: 'land:2' as const, point: { x: 3000, y: 1000 } };
    const crossing: GoalTransportOption = { id: 'hull-crossing', transport: { kind: 'existing', entityId: 'hull' },
      seaId: 'sea:1', from, to: at, origin: 'land', loadedUnitIds: [], capacity: 1000,
      departure: { ground: from.point, water: { x: 550, y: 550 }, heading: 0 },
      landing: { ground: at.point, water: { x: 2950, y: 1000 }, heading: 1 },
      approach: option.preconditions[0]!, crossing: goalFact({ kind: 'route', mover: 'sea', from, to: at }),
      shoreSafe: goalFact({ kind: 'shore-safe', landId: at.landId, landing: at, throughTick: 2000 }),
      factIds: ['actual-crossing'], duration: known(300) };
    const ctx = { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, target: at }]),
      transportOptions: vi.fn(() => choices([crossing])) } };
    const effect = goalFact({ kind: 'force-available', at, metric: 'combat-rating', minimum: 2, byTick: 2000 });
    const missing = strict(effect, ctx)[0]!;
    expect(missing.kind).toBe('transport-force'); expect(missing.cost).toMatchObject({ state: 'pending', reason: { code: 'transport-option-cost-unquoted' } });
    const precise = { ...crossing, cost: known([{ code: 'hull-specific', gold: 31, factIds: [] }]), successProbability: known(.3) };
    const priced = strict(effect, { ...ctx, grounding: { ...ctx.grounding, transportOptions: () => choices([precise]) } })[0]!;
    expect(priced.cost).toEqual(precise.cost); expect(priced.successProbability).toEqual(precise.successProbability);
    expect(priced.duration).toEqual(precise.duration);
  });

  it('does not silently substitute current neighbors when a selected source identity or origin is unresolved', () => {
    const { context, option, at } = fixture();
    const effect = goalFact({ kind: 'force-at', at, minimum: 1, metric: 'combat-rating', byTick: 2000 });
    expect(strict(effect, { ...context, grounding: { ...context.grounding!, resolveCohort: () => pending } })).toEqual([]);
    const { from: _origin, ...withoutOrigin } = option;
    expect(strict(effect, { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([withoutOrigin]) } })).toEqual([]);
    expect(strict(goalFact({ kind: 'production', unitKind: 'transport', byTick: 2000 }), context)).toEqual([]);
  });

  it('cannot promise a future defense window with a shorter control lease or move a dead hull', () => {
    const { context, at, option } = fixture();
    expect(strict(goalFact({ kind: 'site-safe', site: at, throughTick: 2000 }), context)).toEqual([]);
    context.snapshot.units.find(unit => unit.id === 'hull')!.hp = 0;
    const transport = { kind: 'existing' as const, entityId: 'hull' };
    const staleHull = { reference: transport, assessment: { ...context.snapshot.units.find(unit => unit.id === 'hull')!, hp: 100 } };
    const effect = goalFact({ kind: 'transport-at', transport, at: { seaId: 'sea:1', point: at.point }, tolerance: 36, byTick: 2000 });
    expect(strict(effect, { ...context, grounding: { ...context.grounding!, combatOptions: () => choices([{ ...option, cohort: [transport] }]),
      resolveCohort: () => choices([staleHull]) } })).toEqual([]);
  });
});
