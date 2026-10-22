import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { sketchScene } from '../../sdk/scene';
import { unitRules } from '../../shared/catalog';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { bodyMass } from '../../shared/physical-body';
import type { GameSnapshot } from '../../shared/types';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { effectiveCombatRating } from '../policy/v6/strength';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { goalCampId, goalFact } from './goal-facts';
import { projectGoalResources } from './goal-resource-ledger';
import type { GoalActionDeclaration, GoalEstimate, GoalTransportOption } from './goal-planner-types';
import { declareGoalAssembly, declareGoalCampClearing, declareGoalDefense, declareGoalEvacuation, declareGoalForceTransport, declareGoalWorkerTransport,
  declareGoalShoreClearing, declareGoalTransportPosition, type GoalNavalEstimates } from './goal-naval-actions';

const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['measured-grounding'] });
const estimates: GoalNavalEstimates = { duration: known(100), cost: known([{ code: 'measured-loss', gold: 7, factIds: ['loss'] }]),
  successProbability: known(.8) };
function frame() {
  const game = sketchScene('declarative-naval-atoms').map('bareDuel').replaceDefaults()
    .player('us', { team: 'home' }).player('ally', { team: 'home' }).player('foe', { team: 'enemy' })
    .unit('us', 'footman', 1000, 1000, { id: 'fighter-a' }).unit('us', 'archer', 1020, 1000, { id: 'fighter-b' })
    .worker('us', 1000, 1040, { id: 'worker' }).unit('ally', 'footman', 1020, 1040, { id: 'ally' })
    .unit('foe', 'footman', 2000, 1000, { id: 'foe' })
    .unit('neutral', 'ogreWarrior', 2000, 2000, { id: 'guard-a' })
    .unit('neutral', 'ogreMage', 2040, 2000, { id: 'guard-b' }).build().createGame();
  const snapshot = snapshotGame(game), at = { point: { x: 1700, y: 1700 }, landId: 'land:1' as const };
  const from = { point: { x: 1000, y: 1000 }, landId: 'land:1' as const };
  const campId = goalCampId(neutralCampExposure(snapshot).camps[0]!.memberIds);
  const route = goalFact({ kind: 'route', mover: 'land', from, to: at });
  return { game, snapshot, at, from, campId, route, owner: 'us', unitIds: ['fighter-a', 'fighter-b'], byTick: 1000, estimates };
}
function strict<T>(run: () => T): T {
  return withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw new Error(event.operation);
  }, () => withNavigationPhase('strategy-planning', run));
}

describe('grounded naval world-effect declarations', () => {
  it('declares remaining native bounties as separate finish event contributors, without adding a recipe', () => {
    const input = frame(), before = JSON.stringify(input.snapshot);
    const action = strict(() => declareGoalCampClearing({ ...input, routes: [input.route] }))!;
    expect(action.kind).toBe('clear-camp');
    expect(action.effects).toEqual([{ fact: goalFact({ kind: 'camp-cleared', campId: input.campId }), operation: 'establish', at: 'finish' }]);
    expect(action.preconditions.find(fact => fact.predicate.kind === 'force-at')?.predicate).toMatchObject({
      metric: 'camp-force', campId: input.campId, cohort: [{ kind: 'existing', entityId: 'fighter-a' }, { kind: 'existing', entityId: 'fighter-b' }],
    });
    const guards = input.snapshot.units.filter(unit => unit.owner === 'neutral');
    expect(action.flows.map(flow => flow.delta)).toEqual(guards.map(unit => unitRules(input.snapshot, unit).goldBounty));
    expect(action.flows.every(flow => flow.at === 'finish')).toBe(true);
    expect(new Set(action.flows.map(flow => flow.source?.id)).size).toBe(guards.length);
    expect(action.outputs).toEqual([]);
    expect(Object.keys(action)).not.toContain('dependsOn');
    input.snapshot.units.find(unit => unit.id === 'guard-a')!.hp = 0;
    const remaining = declareGoalCampClearing({ ...input, routes: [input.route] })!;
    expect(remaining.flows.map(flow => flow.source?.id)).toEqual(['neutral-kill-bounty:guard-b']);
    const restored = JSON.parse(before);
    expect(declareGoalCampClearing({ ...input, snapshot: restored, routes: [input.route] })).toEqual(action);
  });

  it('matches the declared bounty to native kill gold rather than an invented clearing reward', () => {
    const input = frame(), guard = input.game.units.find(unit => unit.id === 'guard-a')!;
    const other = input.game.units.find(unit => unit.id === 'guard-b')!;
    other.hp = 0; guard.hp = 1;
    const fighter = input.game.units.find(unit => unit.id === 'fighter-a')!;
    fighter.x = guard.x - 40; fighter.y = guard.y;
    const snapshot = snapshotGame(input.game), action = declareGoalCampClearing({ ...input, snapshot, routes: [] })!;
    const before = input.game.players.us!.gold;
    issuePlayerCommand(input.game, 'us', { type: 'attack', unitIds: [fighter.id], targetId: guard.id });
    for (let ticks = 0; ticks < 200 && guard.hp > 0; ticks++) stepGame(input.game);
    expect(guard.hp).toBeLessThanOrEqual(0);
    expect(input.game.players.us!.gold - before).toBe(action.flows.reduce((sum, flow) => sum + flow.delta, 0));
  });

  it('moves only the chosen cohort and contributes a partial additive force without adding camp-force flows', () => {
    const input = frame(), safePost = goalFact({ kind: 'site-safe', site: input.at, throughTick: 1100 });
    const before = JSON.stringify(input.snapshot);
    const action = strict(() => declareGoalAssembly({ ...input, routes: [input.route], safePost }))!;
    const actual = input.snapshot.units.filter(unit => input.unitIds.includes(unit.id))
      .reduce((sum, unit) => sum + effectiveCombatRating(input.snapshot, unit), 0);
    expect(action.flows.filter(flow => flow.resource.kind === 'force').map(flow => flow.delta)).toEqual([-actual, actual]);
    expect(action.flows.every(flow => flow.resource.kind !== 'force' || flow.resource.metric === 'combat-rating')).toBe(true);
    expect(action.demands.map(demand => demand.resource)).toEqual([
      { kind: 'entity-control', entity: { kind: 'existing', entityId: 'fighter-a' } },
      { kind: 'entity-control', entity: { kind: 'existing', entityId: 'fighter-b' } },
    ]);
    expect(action.effects.some(effect => effect.fact.predicate.kind === 'camp-cleared')).toBe(false);
    expect(JSON.stringify(input.snapshot)).toBe(before);
    expect(declareGoalAssembly({ ...input, unitIds: ['fighter-b', 'fighter-a', 'fighter-a'], routes: [input.route], safePost })).toEqual(action);
    expect(declareGoalAssembly({ ...input, unitIds: ['ally'], routes: [input.route], safePost })).toBeNull();
    expect(declareGoalAssembly({ ...input, at: { ...input.at, landId: 'land:2' }, routes: [input.route], safePost })).toBeNull();
  });

  it('preserves pending measured costs and routes rather than substituting a free certain action', () => {
    const input = frame(), pending = { state: 'pending' as const, requestIds: ['risk:stable'],
      reason: { code: 'risk-pending', factIds: [input.route.id], values: {} } };
    const action = declareGoalCampClearing({ ...input, routes: [input.route], estimates: {
      duration: pending, cost: pending, successProbability: pending,
    } })!;
    expect(action.duration).toEqual(pending); expect(action.cost).toEqual(pending); expect(action.successProbability).toEqual(pending);
    expect(action.preconditions).toContainEqual(input.route);
  });

  it('moves a proved exact cohort from post to post without spending its pool force twice', () => {
    const input = frame(), next = { ...input.at, point: { x: 1900, y: 1700 } };
    const first = declareGoalAssembly({ ...input, routes: [input.route],
      safePost: goalFact({ kind: 'assembly-post', at: input.at }) })!;
    const source = first.effects.find(effect => effect.fact.predicate.kind === 'force-at'
      && effect.fact.predicate.metric === 'combat-rating')!.fact;
    const secondInput = { ...input, from: input.at, at: next,
      safePost: goalFact({ kind: 'assembly-post', at: next }) };
    const second = strict(() => declareGoalAssembly({ ...secondInput, routes: [source] }))!;
    const force = first.flows.find(flow => flow.resource.kind === 'force' && flow.delta > 0)!.delta;
    const initial = [{ resource: { kind: 'force' as const, at: input.from, scope: 'pool' as const,
      metric: 'combat-rating' as const }, quantity: force, asOfTick: 0, factIds: [] }];
    const project = (action: GoalActionDeclaration) => projectGoalResources({ epoch: 0, initial, actions: [
      { action: first, startTick: 0, finishTick: 100 }, { action, startTick: 100, finishTick: 200 },
    ] });
    const result = project(second);
    expect(result.state).toBe('met');
    if (result.state === 'pending') throw Error(result.reason.code);
    expect(result.balances.filter(balance => balance.quantity !== 0)).toEqual([
      expect.objectContaining({ resource: { kind: 'force', at: next, scope: 'post', metric: 'combat-rating' }, quantity: force }),
    ]);
    expect(second.preconditions).toContainEqual(source);
    expect(second.preconditions.some(fact => fact.predicate.kind === 'force-available')).toBe(false);
    expect(second.flows.filter(flow => flow.resource.kind === 'force').map(flow => [flow.resource.kind === 'force' && flow.resource.scope, flow.delta]))
      .toEqual([['post', -force], ['post', force]]);
    const fallback = declareGoalAssembly({ ...secondInput, routes: [] })!;
    expect(project(fallback).state).toBe('unmet'); expect(second.id).not.toBe(fallback.id);
    expect(JSON.parse(JSON.stringify(second))).toEqual(second);
    if (source.predicate.kind !== 'force-at') throw Error('source');
    for (const invalid of [
      goalFact({ ...source.predicate, metric: 'field-strength' }),
      goalFact({ ...source.predicate, at: { ...input.at, point: { x: 1701, y: 1700 } } }),
      goalFact({ ...source.predicate, cohort: [{ kind: 'existing', entityId: 'fighter-a' }] }),
      goalFact({ ...source.predicate, minimum: force / 2 }),
    ]) expect(project(declareGoalAssembly({ ...secondInput, routes: [invalid] })!).state).toBe('unmet');
  });

  it('establishes only the cleared landing, while defense and evacuation express different world effects', () => {
    const input = frame(), landing = { ...input.at, point: { x: 1800, y: 1100 } };
    const shore = strict(() => declareGoalShoreClearing({ ...input, landing, threatIds: ['foe'], requiredForce: 1,
      throughTick: 1200, routes: [input.route] }))!;
    expect(shore.effects.map(effect => effect.fact.predicate)).toEqual([
      { kind: 'shore-safe', landId: landing.landId, landing, throughTick: 1200 },
    ]);
    expect(declareGoalShoreClearing({ ...input, landing, threatIds: ['ally'], requiredForce: 1,
      throughTick: 1200, routes: [input.route] })).toBeNull();
    const defend = declareGoalDefense({ ...input, estimates: { ...input.estimates, duration: known(1200) },
      effectDelayTicks: known(13), site: input.at, requiredForce: 1, throughTick: 1200, routes: [input.route] })!;
    expect(defend.effects[0]!.fact.predicate.kind).toBe('site-safe');
    expect(defend.effects[0]!.at).toEqual({ offsetTicks: 13 });
    expect(defend.demands.every(demand => demand.until === 'finish')).toBe(true);
    expect(defend.preconditions.some(fact => fact.predicate.kind === 'force-available')).toBe(true);
    const escape = declareGoalEvacuation({ ...input, unitIds: ['worker'], shelter: input.at, throughTick: 1200, routes: [input.route] })!;
    expect(escape.effects[0]!.fact.predicate).toMatchObject({ kind: 'assets-safe', unitIds: ['worker'], at: input.at });
    expect(escape.preconditions).toContainEqual(goalFact({ kind: 'site-safe', site: input.at, throughTick: input.snapshot.tick + 100 }));
    expect(escape.effects[0]!.fact.predicate).toMatchObject({ throughTick: 1200 });
    const safety = escape.preconditions.find(fact => fact.predicate.kind === 'site-safe')!;
    expect(escape.preconditionWindows).toContainEqual({ factId: safety.id, through: 'finish' });
    expect(escape.flows.filter(flow => flow.resource.kind === 'unit-pool')).toEqual([]);
  });

  it('keeps defense arrival uncertainty and the protection activation separate from its control window', () => {
    const input = frame(), base = { ...input, site: input.at, requiredForce: 1, throughTick: 1200, routes: [input.route],
      estimates: { ...input.estimates, duration: known(1200) } };
    expect(declareGoalDefense({ ...base, effectDelayTicks: known(0) })!.effects[0]!.at).toBe('start');
    expect(declareGoalDefense({ ...base, effectDelayTicks: known(1201) })).toBeNull();
    const unknown = { state: 'pending' as const, requestIds: ['arrival'], reason: { code: 'arrival-pending', factIds: [], values: {} } };
    expect(declareGoalDefense({ ...base, effectDelayTicks: unknown })!.duration).toEqual(unknown);
    expect(declareGoalDefense(base)!.duration).toMatchObject({ state: 'pending', reason: { code: 'defense-arrival-time-unquoted' } });
  });

  it('keeps a future hull as an output reference without manufacturing an available world entity', () => {
    const input = frame(), hull = { kind: 'output' as const, actionId: 'train-a-transport', output: 'unit-0' };
    const option: GoalTransportOption = { id: 'shared-berth-option', seaId: 'sea:1', from: input.from, to: input.at,
      transport: hull, capacity: 1000, origin: 'land', loadedUnitIds: [], departure: { water: { x: 1000, y: 1200 }, ground: input.from.point, heading: null },
      landing: { water: { x: 1700, y: 1500 }, ground: input.at.point, heading: null }, approach: input.route,
      crossing: goalFact({ kind: 'route', mover: 'sea', from: input.from, to: input.at, actor: hull }),
      shoreSafe: goalFact({ kind: 'shore-safe', landId: 'land:1', landing: input.at, throughTick: 1200 }),
      duration: known(200), factIds: ['shared-berth-fact'] };
    const action: GoalActionDeclaration = strict(() => declareGoalTransportPosition({ option, tick: input.snapshot.tick, byTick: 1000,
      tolerance: 36, estimates }))!;
    expect(action.preconditions[0]!.predicate).not.toHaveProperty('unitId');
    expect(action.effects[0]!.fact.predicate).toMatchObject({ kind: 'transport-at', transport: hull });
    expect(action.outputs).toEqual([]);
    expect(JSON.parse(JSON.stringify(action))).toEqual(action);
  });

  it('credits one native guard bounty once across different clearing declarations', () => {
    const input = frame(), camp = declareGoalCampClearing({ ...input, routes: [] })!;
    const shore = declareGoalShoreClearing({ ...input, landing: input.at, threatIds: ['guard-a', 'guard-b'],
      requiredForce: 1, throughTick: 1200, routes: [] })!;
    const projection = projectGoalResources({ epoch: 0, initial: [], actions: [
      { action: camp, startTick: 0, finishTick: 100 }, { action: shore, startTick: 100, finishTick: 200 },
    ] });
    expect(projection.state).toBe('met');
    if (projection.state === 'pending') throw new Error(projection.reason.code);
    expect(projection.balances.find(balance => balance.resource.kind === 'gold')!.quantity)
      .toBe(camp.flows.reduce((sum, flow) => sum + flow.delta, 0));
    expect(projection.duplicateCredits).toHaveLength(2);
  });

  it('uses the real 4180 passenger binding and reserves dependencies without turning them into selected force', () => {
    const input: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
      new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
    const snapshot = input.snapshot, hull = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
    const loaded = snapshot.units.filter(unit => (unit.deck?.shipId ?? unit.cabin?.shipId) === hull.id);
    const soldier = loaded.find(unit => unit.kind !== 'worker')!, worker = loaded.find(unit => unit.kind === 'worker')!;
    const from = { seaId: 'sea:1' as const, point: { x: hull.x, y: hull.y } };
    const to = { landId: 'land:3' as const, point: { x: 2864, y: 4208 } };
    const transport = { kind: 'existing' as const, entityId: hull.id };
    // Fixed published endpoint facts isolate the declaration from route work;
    // this is not a measurement of the injected route's ETA or executability.
    const crossing = goalFact({ kind: 'route', mover: 'sea', from, to, actor: transport });
    const option: GoalTransportOption = { id: 'published-aboard-option', seaId: 'sea:1', from, to, transport, capacity: 10000,
      origin: 'aboard', loadedUnitIds: loaded.map(unit => unit.id),
      departure: { water: from.point, heading: null },
      landing: { water: { x: 2800, y: 4208 }, ground: to.point, heading: null },
      approach: crossing, crossing, shoreSafe: goalFact({ kind: 'shore-safe', landId: to.landId, landing: to, throughTick: 6000 }),
      duration: known(400), factIds: ['published-aboard-route'] };
    const before = JSON.stringify(snapshot), args = { ...input, option, byTick: 6000, estimates, berthTolerance: hull.radius, pickupRoutes: [] };
    const action = strict(() => declareGoalForceTransport({ ...args, unitIds: [soldier.id] }))!;
    expect(action.preconditions.some(fact => fact.predicate.kind === 'transport-at')).toBe(false);
    expect(action.preconditions.find(fact => fact.predicate.kind === 'cargo-aboard')?.predicate).toEqual({
      kind: 'cargo-aboard', transport, units: [{ kind: 'existing', entityId: soldier.id }],
    });
    const destination = action.effects.find(effect => effect.fact.predicate.kind === 'force-available')!.fact.predicate;
    expect(destination).toMatchObject({ cohort: [{ kind: 'existing', entityId: soldier.id }],
      minimum: effectiveCombatRating(snapshot, soldier) });
    expect(action.demands.filter(demand => demand.resource.kind === 'entity-control').map(demand => demand.resource)).toContainEqual({
      kind: 'entity-control', entity: { kind: 'existing', entityId: worker.id },
    });
    expect(action.flows.some(flow => flow.delta < 0 && flow.resource.kind === 'unit-pool')).toBe(false);
    expect(action.flows.find(flow => flow.resource.kind === 'transport-capacity')?.delta).toBe(loaded.reduce((sum, unit) => sum + bodyMass(unit), 0));
    expect(action.effects.some(effect => effect.fact.predicate.kind === 'force-at')).toBe(false);
    expect(declareGoalWorkerTransport({ ...args, unitIds: [worker.id] })!.effects.some(effect =>
      effect.fact.predicate.kind === 'worker-at' && effect.fact.predicate.worker?.kind === 'existing')).toBe(true);
    const wrong = { ...option, transport: { kind: 'existing' as const, entityId: 'another-hull' } };
    expect(declareGoalForceTransport({ ...args, option: wrong, unitIds: [soldier.id] })).toBeNull();
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('reserves native payload mass for land pickup separately from exclusive hull control', () => {
    const input: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
      new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
    const snapshot = input.snapshot, hull = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
    const worker = snapshot.units.find(unit => unit.id === 'unit-p4-worker-2')!;
    const loaded = snapshot.units.filter(unit => (unit.deck?.shipId ?? unit.cabin?.shipId) === hull.id);
    const from = { landId: 'land:2' as const, point: { x: 1584, y: 2448 } };
    const to = { landId: 'land:3' as const, point: { x: 2864, y: 4208 } };
    const transport = { kind: 'existing' as const, entityId: hull.id };
    const route = goalFact({ kind: 'route', mover: 'sea', from, to, actor: transport });
    const option: GoalTransportOption = { id: 'published-pickup-option', seaId: 'sea:1', from, to, transport,
      capacity: 10000, origin: 'land', loadedUnitIds: loaded.map(unit => unit.id),
      departure: { water: from.point, ground: from.point, heading: null },
      landing: { water: { x: 2800, y: 4208 }, ground: to.point, heading: null }, approach: route, crossing: route,
      shoreSafe: goalFact({ kind: 'shore-safe', landId: to.landId, landing: to, throughTick: 6000 }),
      duration: known(400), factIds: ['published-pickup-route'] };
    const action = strict(() => declareGoalWorkerTransport({ ...input, unitIds: [worker.id], option, byTick: 6000,
      estimates, berthTolerance: hull.radius, pickupRoutes: [] }))!;
    expect(action.demands.find(demand => demand.resource.kind === 'transport-capacity')?.quantity).toBe(bodyMass(worker));
    expect(bodyMass(worker)).toBeGreaterThan(1);
    expect(action.demands).toContainEqual({ resource: { kind: 'entity-control', entity: transport }, quantity: 1, from: 'start', until: 'finish' });
    expect(action.preconditions.find(fact => fact.predicate.kind === 'transport-at')?.predicate).toMatchObject({
      at: { seaId: 'sea:1', point: from.point }, tolerance: hull.radius,
    });
    expect(action.flows.filter(flow => flow.resource.kind === 'unit-pool').map(flow => flow.delta)).toEqual([-1, 1]);
  });

  it('boards fighters from the actual shore post and requires safe handoff for unprotected cargo', () => {
    const input = frame(), post = { ...input.from, point: { x: 1400, y: 1100 } },
      to = { ...input.at, landId: 'land:2' as const };
    const transport = { kind: 'output' as const, actionId: 'native-hull-production', output: 'hull' };
    const crossing = goalFact({ kind: 'route', mover: 'sea', from: input.from, to, actor: transport });
    const shoreSafe = goalFact({ kind: 'shore-safe', landId: to.landId,
      landing: { landId: to.landId, point: { x: 1700, y: 1500 } }, throughTick: input.byTick });
    const option: GoalTransportOption = { id: 'precise-shore-post', seaId: 'sea:1', from: input.from, to,
      transport, capacity: 10000, origin: 'land', loadedUnitIds: [],
      departure: { water: { x: 1450, y: 1100 }, ground: post.point, heading: null },
      landing: { water: { x: 1700, y: 1480 }, ground: { x: 1700, y: 1500 }, heading: null },
      crossing, approach: crossing, shoreSafe, duration: known(100), factIds: ['published-coast'] };
    const carried = strict(() => declareGoalForceTransport({ ...input, option, berthTolerance: 36, pickupRoutes: [] }))!;
    const origin = carried.preconditions.find(fact => fact.predicate.kind === 'force-at')!;
    expect(origin.predicate).toMatchObject({ at: post, metric: 'combat-rating' });
    const forceFlow = carried.flows.find(flow => flow.resource.kind === 'force' && flow.delta < 0)!;
    expect(forceFlow.resource).toEqual({ kind: 'force', at: post, scope: 'post', metric: 'combat-rating' });
    const initial = [
      { resource: { kind: 'force' as const, at: input.from, scope: 'pool' as const, metric: 'combat-rating' as const }, quantity: -forceFlow.delta, asOfTick: 0, factIds: [] },
      ...input.unitIds.map(id => ({ resource: { kind: 'unit-pool' as const, at: input.from,
        unitKind: input.snapshot.units.find(unit => unit.id === id)!.kind }, quantity: 1, asOfTick: 0, factIds: [] })),
    ];
    const assemble = declareGoalAssembly({ ...input, at: post, routes: [], safePost: goalFact({ kind: 'assembly-post', at: post }) })!;
    const without = projectGoalResources({ epoch: 0, initial, actions: [{ action: carried, startTick: 100, finishTick: 200 }] });
    expect(without).toMatchObject({ state: 'unmet', deficits: [expect.objectContaining({ resource: forceFlow.resource, available: 0 })] });
    const withAssembly = projectGoalResources({ epoch: 0, initial, actions: [
      { action: assemble, startTick: 0, finishTick: 100 }, { action: carried, startTick: 100, finishTick: 200 },
    ] });
    expect(withAssembly.state).toBe('met');
    const worker = strict(() => declareGoalWorkerTransport({ ...input, unitIds: ['worker'], option, berthTolerance: 36, pickupRoutes: [] }))!;
    expect(worker.preconditions).toContainEqual(goalFact({ ...shoreSafe.predicate,
      kind: 'shore-safe', landId: to.landId, landing: { landId: to.landId, point: { x: 1700, y: 1500 } },
      throughTick: input.snapshot.tick + 100 }));
    expect(worker.preconditions).toContainEqual(goalFact({ kind: 'site-safe', site: to, throughTick: input.snapshot.tick + 100 }));
    expect(worker.preconditions.some(fact => fact.predicate.kind === 'camp-cleared')).toBe(false);
    expect(carried.preconditions.some(fact => fact.predicate.kind === 'site-safe')).toBe(false);
  });

  it.each(['fighters', 'worker', 'mixed'] as const)('binds the %s landing safety obligation to transport completion rather than the goal deadline', cargo => {
    const input = frame(), to = { ...input.at, landId: 'land:2' as const }, byTick = input.snapshot.tick + 12000;
    const transport = { kind: 'binding' as const, name: 'native-transport' };
    const crossing = goalFact({ kind: 'route', mover: 'sea', from: input.from, to, actor: transport });
    const shoreSafe = goalFact({ kind: 'shore-safe', landId: to.landId, landing: to, throughTick: byTick });
    const oldHandoff = goalFact({ kind: 'site-safe', site: to, throughTick: byTick });
    const hasWorker = cargo !== 'fighters', originalIds = hasWorker ? [shoreSafe.id, oldHandoff.id] : [shoreSafe.id];
    const option: GoalTransportOption = { id: `finish-window:${cargo}`, seaId: 'sea:1', transport, from: input.from, to,
      capacity: 10000, origin: 'land', loadedUnitIds: [],
      departure: { water: input.from.point, ground: input.from.point, heading: null },
      landing: { water: to.point, ground: to.point, heading: null }, crossing, approach: crossing, shoreSafe,
      preconditions: hasWorker ? [shoreSafe, oldHandoff] : [shoreSafe],
      duration: { state: 'met', value: 1063, factIds: originalIds }, factIds: originalIds };
    const estimates: GoalNavalEstimates = { duration: known(1),
      cost: { state: 'met', value: [{ code: 'voyage-risk', gold: 7, factIds: originalIds }], factIds: originalIds },
      successProbability: { state: 'met', value: .8, factIds: originalIds } };
    const before = JSON.stringify({ snapshot: input.snapshot, option, estimates });
    const unitIds = cargo === 'worker' ? ['worker'] : cargo === 'mixed' ? [...input.unitIds, 'worker'] : input.unitIds;
    const action = strict(() => (cargo === 'worker' ? declareGoalWorkerTransport : declareGoalForceTransport)({
      ...input, unitIds, option, estimates, byTick, berthTolerance: 36, pickupRoutes: [] }))!;
    const safety = action.preconditions.filter(fact => fact.predicate.kind === 'shore-safe' || fact.predicate.kind === 'site-safe');
    expect(safety).toHaveLength(hasWorker ? 2 : 1);
    expect(safety.every(fact => (fact.predicate as { throughTick: number }).throughTick === input.snapshot.tick + 1063)).toBe(true);
    expect(action.duration).toMatchObject({ state: 'met', value: 1063 });
    expect(action.preconditionWindows).toEqual(expect.arrayContaining(safety.map(fact => ({ factId: fact.id, through: 'finish' }))));
    expect(action.preconditionWindows).toHaveLength(safety.length);
    expect(action.executor.parameters.byTick).toBe(byTick);
    // Old IDs in proofs, price terms and pool-flow dependencies must not keep
    // the entire goal window alive beside the replacement safety facts.
    for (const old of originalIds) expect(JSON.stringify(action)).not.toContain(old.replaceAll('"', '\\"'));
    const safetyIds = safety.map(fact => fact.id).sort();
    expect(action.duration.state === 'met' && action.duration.factIds).toEqual(safetyIds);
    expect(action.cost.state === 'met' && action.cost.value[0]!.factIds).toEqual(safetyIds);
    expect(action.successProbability.state === 'met' && action.successProbability.factIds).toEqual(safetyIds);
    expect(JSON.stringify({ snapshot: input.snapshot, option, estimates })).toBe(before);
    expect(JSON.parse(JSON.stringify(action))).toEqual(action);
  });

  it('keeps unknown voyage duration pending with unbound current-time window prototypes', () => {
    const input = frame(), to = { ...input.at, landId: 'land:2' as const }, byTick = input.snapshot.tick + 12000;
    const transport = { kind: 'binding' as const, name: 'native-transport' };
    const crossing = goalFact({ kind: 'route', mover: 'sea', from: input.from, to, actor: transport });
    const option: GoalTransportOption = { id: 'unquoted-voyage-window', seaId: 'sea:1', transport, from: input.from, to,
      capacity: 10000, origin: 'land', loadedUnitIds: [],
      departure: { water: input.from.point, ground: input.from.point, heading: null },
      landing: { water: to.point, ground: to.point, heading: null }, crossing, approach: crossing,
      shoreSafe: goalFact({ kind: 'shore-safe', landId: to.landId, landing: to, throughTick: byTick }),
      duration: { state: 'pending', requestIds: ['actual-sea-time'],
        reason: { code: 'actual-sea-time-pending', factIds: ['actual-sea-time'], values: {} } }, factIds: [] };
    const args = { ...input, unitIds: ['worker'], option, byTick, berthTolerance: 36, pickupRoutes: [] };
    const action = strict(() => declareGoalWorkerTransport(args))!;
    expect(action.duration).toEqual(option.duration);
    const prototypes = action.preconditions.filter(fact => fact.predicate.kind === 'shore-safe' || fact.predicate.kind === 'site-safe');
    expect(prototypes.every(fact => (fact.predicate as { throughTick: number }).throughTick === input.snapshot.tick)).toBe(true);
    expect(action.preconditionWindows).toHaveLength(2);
    const quoted = strict(() => declareGoalWorkerTransport({ ...args, option: { ...option, duration: known(719) } }))!;
    const windows = quoted.preconditions.filter(fact => fact.predicate.kind === 'shore-safe' || fact.predicate.kind === 'site-safe');
    expect(windows.every(fact => (fact.predicate as { throughTick: number }).throughTick === input.snapshot.tick + 719)).toBe(true);
    expect(quoted.preconditionWindows?.every(window => windows.some(fact => fact.id === window.factId))).toBe(true);
    expect(quoted.preconditionWindows?.some(window => prototypes.some(fact => fact.id === window.factId))).toBe(false);
  });

  it('keeps future troops symbolic through assembly, camp checks and transport without deduplicating identical prototypes', () => {
    const input = frame(), prototype = { ...input.snapshot.units.find(unit => unit.id === 'fighter-a')!, id: 'must-not-be-a-world-identity' };
    const cohort = [0, 1].map(index => ({ reference: { kind: 'output' as const, actionId: 'train-pair', output: `unit-${index}` }, assessment: prototype }));
    const base = { snapshot: input.snapshot, owner: input.owner, byTick: input.byTick, estimates: input.estimates,
      from: input.from, at: input.at, campId: input.campId, cohort };
    const safePost = goalFact({ kind: 'site-safe', site: input.at, throughTick: 2000 });
    const assembled = strict(() => declareGoalAssembly({ ...base, safePost, routes: [input.route], campId: input.campId }))!;
    const refs = cohort.map(member => member.reference);
    expect(assembled.demands.map(demand => demand.resource)).toEqual(refs.map(entity => ({ kind: 'entity-control', entity })));
    const force = assembled.effects.find(effect => effect.fact.predicate.kind === 'force-at'
      && effect.fact.predicate.metric === 'combat-rating')!.fact.predicate;
    expect(force).toMatchObject({ cohort: refs, minimum: effectiveCombatRating(input.snapshot, prototype) * 2 });
    expect(declareGoalCampClearing({ ...base, routes: [] })!.preconditions.find(fact => fact.predicate.kind === 'force-at')?.predicate)
      .toMatchObject({ cohort: refs, metric: 'camp-force' });
    const hull = { kind: 'output' as const, actionId: 'train-boat', output: 'unit-0' };
    const prerequisite = goalFact({ kind: 'production', unitKind: 'transport', byTick: input.byTick });
    const option: GoalTransportOption = { id: 'future-cohort-and-hull', transport: hull, seaId: 'sea:1', from: input.from,
      to: { ...input.at, landId: 'land:2' }, capacity: 1000, origin: 'land', loadedUnitIds: [],
      departure: { water: input.from.point, ground: input.from.point, heading: null },
      landing: { water: input.at.point, ground: input.at.point, heading: null }, approach: input.route, crossing: input.route,
      shoreSafe: goalFact({ kind: 'shore-safe', landId: input.at.landId, landing: input.at, throughTick: 2000 }),
      duration: known(300), factIds: ['future-shape'], preconditions: [prerequisite] };
    const carried = strict(() => declareGoalForceTransport({ ...base, option, berthTolerance: 36, pickupRoutes: [] }))!;
    expect(carried.preconditions).toContainEqual(prerequisite);
    expect(carried.effects.find(effect => effect.fact.predicate.kind === 'force-available')?.fact.predicate).toMatchObject({ cohort: refs });
    expect(carried.demands).toContainEqual({ resource: { kind: 'entity-control', entity: hull }, quantity: 1, from: 'start', until: 'finish' });
    expect(carried.executor.parameters.cohort).toEqual(refs);
    for (const declaration of [assembled, carried, declareGoalCampClearing({ ...base, routes: [] })!]) {
      expect(JSON.stringify(declaration)).not.toContain(prototype.id);
      expect(JSON.stringify(declaration)).not.toContain('assessment:');
    }
    expect(JSON.parse(JSON.stringify(carried))).toEqual(carried);
    const engineer = { reference: { kind: 'output' as const, actionId: 'train-engineer', output: 'unit-0' },
      assessment: { ...input.snapshot.units.find(unit => unit.id === 'worker')!, id: prototype.id } };
    const escorted = declareGoalForceTransport({ ...base, cohort: [cohort[0]!, engineer], option,
      berthTolerance: 36, pickupRoutes: [] })!;
    expect(escorted.effects.find(effect => effect.fact.predicate.kind === 'force-available')?.fact.predicate)
      .toMatchObject({ cohort: [cohort[0]!.reference], minimum: effectiveCombatRating(input.snapshot, prototype) });
    expect(escorted.effects.find(effect => effect.fact.predicate.kind === 'worker-at')?.fact.predicate)
      .toMatchObject({ worker: engineer.reference });
    expect(escorted.demands.find(demand => demand.resource.kind === 'transport-capacity')?.quantity)
      .toBe(bodyMass(prototype) + bodyMass(engineer.assessment));
  });
});
