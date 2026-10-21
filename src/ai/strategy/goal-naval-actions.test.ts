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

  it('establishes only the cleared landing, while defense and evacuation express different world effects', () => {
    const input = frame(), landing = { ...input.at, point: { x: 1800, y: 1100 } };
    const shore = strict(() => declareGoalShoreClearing({ ...input, landing, threatIds: ['foe'], requiredForce: 1,
      throughTick: 1200, routes: [input.route] }))!;
    expect(shore.effects.map(effect => effect.fact.predicate)).toEqual([
      { kind: 'shore-safe', landId: landing.landId, landing, throughTick: 1200 },
    ]);
    expect(declareGoalShoreClearing({ ...input, landing, threatIds: ['ally'], requiredForce: 1,
      throughTick: 1200, routes: [input.route] })).toBeNull();
    const defend = declareGoalDefense({ ...input, site: input.at, requiredForce: 1, throughTick: 1200, routes: [input.route] })!;
    expect(defend.effects[0]!.fact.predicate.kind).toBe('site-safe');
    expect(defend.preconditions.some(fact => fact.predicate.kind === 'force-available')).toBe(true);
    const escape = declareGoalEvacuation({ ...input, unitIds: ['worker'], shelter: input.at, throughTick: 1200, routes: [input.route] })!;
    expect(escape.effects[0]!.fact.predicate).toMatchObject({ kind: 'assets-safe', unitIds: ['worker'], at: input.at });
    expect(escape.preconditions).toContainEqual(goalFact({ kind: 'site-safe', site: input.at, throughTick: 1200 }));
    expect(escape.flows.filter(flow => flow.resource.kind === 'unit-pool')).toEqual([]);
  });

  it('keeps a future hull as an output reference without manufacturing an available world entity', () => {
    const input = frame(), hull = { kind: 'output' as const, actionId: 'train-a-transport', output: 'unit-0' };
    const option: GoalTransportOption = { id: 'shared-berth-option', seaId: 'sea:1', from: input.from, to: input.at,
      transport: hull, capacity: 1000, origin: 'land', loadedUnitIds: [], departure: { water: { x: 1000, y: 1200 }, ground: input.from.point, heading: null },
      landing: { water: { x: 1700, y: 1500 }, ground: input.at.point, heading: null }, approach: input.route,
      crossing: goalFact({ kind: 'route', mover: 'sea', from: input.from, to: input.at, actor: hull }),
      shoreSafe: goalFact({ kind: 'shore-safe', landId: 'land:1', landing: input.at, throughTick: 1200 }),
      duration: known(200), factIds: ['shared-berth-fact'] };
    const action: GoalActionDeclaration = strict(() => declareGoalTransportPosition({ option, byTick: 1000,
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
    const destination = action.effects.find(effect => effect.fact.predicate.kind === 'force-at')!.fact.predicate;
    expect(destination).toMatchObject({ cohort: [{ kind: 'existing', entityId: soldier.id }],
      minimum: effectiveCombatRating(snapshot, soldier) });
    expect(action.demands.filter(demand => demand.resource.kind === 'entity-control').map(demand => demand.resource)).toContainEqual({
      kind: 'entity-control', entity: { kind: 'existing', entityId: worker.id },
    });
    expect(action.flows.some(flow => flow.delta < 0 && flow.resource.kind === 'unit-pool')).toBe(false);
    expect(action.flows.find(flow => flow.resource.kind === 'transport-capacity')?.delta).toBe(bodyMass(soldier));
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
});
