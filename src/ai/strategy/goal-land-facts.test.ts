import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { resolveVariant } from '../../shared/catalog';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame, spawnVariantUnit, stepGame, tryPlayerCommand } from '../../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { withAllocationArrivalQuery, type AllocationLandRouteReader } from './allocation-arrival-query';
import { buildObservedStrategyDecision, projectStrategyTrace } from './decision';
import { FactWorkQueue, withFactWork } from './fact-work';
import { goalFact } from './goal-facts';
import { readGoalLandCapabilityFact, type GoalLandCapabilityFactPorts } from './goal-land-facts';
import type { GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import { landIdAt, regionIndex } from './regions';

function nativeGame() {
  const game = sketchScene('land-capability-native-facts').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'blue' }).player('ally', { team: 'blue' }).player('foe', { team: 'red' })
    .townHall('us', 300, 300, { id: 'home' }).townHall('foe', 4000, 4000)
    .unit('us', 'footman', 600, 600, { id: 'slow' })
    .unit('us', 'horseArcher', 650, 600, { id: 'counter-a' })
    .unit('us', 'horseArcher', 650, 650, { id: 'counter-b' })
    .unit('us', 'horseArcher', 650, 700, { id: 'counter-c' })
    .unit('us', 'horseArcher', 600, 700, { id: 'counter-d' })
    .unit('ally', 'horseArcher', 700, 700, { id: 'allied-counter' })
    .unit('foe', 'horseArcher', 1800, 600, { id: 'harasser', hp: 40 })
    .unit('foe', 'footman', 650, 800, { id: 'sentry', hp: 1 }).build().createGame();
  game.scriptedVictory = true;
  return game;
}
const ref = (entityId: string) => ({ kind: 'existing' as const, entityId });
const counters = ['counter-a', 'counter-b', 'counter-c', 'counter-d'];
function world(snapshot: GameSnapshot, route?: (fact: GoalFact) => GoalFactObservation) {
  regionIndex(snapshot.map);
  const situation = projectStrategyTrace(buildObservedStrategyDecision(snapshot, 'us',
    { memory: createAiPolicyMemory() }, undefined, undefined, Infinity)).situation;
  const context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_summoner',
    readFact: route ?? (() => { throw Error('No route port installed'); }) };
  const ports: GoalLandCapabilityFactPorts = { regionAt: point => landIdAt(snapshot.map, point) ?? null };
  const target = snapshot.units.find(unit => unit.id === 'harasser')!;
  const fact = (ids = counters) => goalFact({ kind: 'interception-capability', site: {
    entityId: target.id, landId: ports.regionAt(target)!, point: { x: target.x, y: target.y } }, throughTick: snapshot.tick + 1000,
  cohort: ids.map(ref) });
  return { context, ports, fact };
}
function knownRoute(fact: GoalFact, tick: number, ticks: number | null = 0): GoalFactObservation {
  return { fact, state: 'met', observedTick: tick, revision: 'published-test-route', evidence: [],
    route: { distance: 200, ticks, points: [] }, reason: { code: 'published-test-route', factIds: [fact.id], values: {} } };
}
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(`Unbudgeted native ${event.operation}`);
}, () => withNavigationPhase('strategy-planning', run));

describe('land capability facts from exact native entities', () => {
  it('checks the requested cohort, preserving known zero, actual native stats and symbolic outputs', () => {
    const snapshot = snapshotGame(nativeGame()), { context: base, ports, fact } = world(snapshot);
    const requested: string[] = [];
    // Published route facts isolate the membership/counter gate contract; they
    // do not claim full navigation or public-puzzle execution acceptance.
    const context = { ...base, readFact: (route: GoalFact) => { requested.push(route.id); return knownRoute(route, snapshot.tick); } };
    const before = JSON.stringify(snapshot);
    const weak = strict(() => readGoalLandCapabilityFact(fact(['slow']), context, ports))!;
    expect(weak.state).toBe('unmet'); expect(weak.quantity).toBe(0); expect(requested).toEqual([]);
    const empty = readGoalLandCapabilityFact(fact([]), context, ports)!;
    expect(empty).toMatchObject({ state: 'unmet', quantity: 0, interception: { capableUnitIds: [] } });
    const strong = strict(() => readGoalLandCapabilityFact(fact(), context, ports))!;
    expect(strong.state).toBe('met'); expect(strong.interception!.capableUnitIds).toEqual(counters);
    expect(strong.entityIds).not.toContain('allied-counter');
    expect(readGoalLandCapabilityFact(fact(['allied-counter']), context, ports)!.state).toBe('unmet');
    const p = fact().predicate;
    if (p.kind !== 'interception-capability') throw Error('wrong fact');
    expect(readGoalLandCapabilityFact(goalFact({ ...p, cohort: [{ kind: 'output', actionId: 'train', output: 'unit-0' }] }), context, ports))
      .toMatchObject({ state: 'unmet', entityIds: [], reason: { code: 'land-cohort-output-not-born' } });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('uses the same shared route service under the strict navigation gate, including JSON continuation', () => {
    const game = nativeGame(), memory = createAiPolicyMemory();
    let result: GoalFactObservation | null = null;
    for (let iteration = 0; iteration < 50 && result?.state !== 'met'; iteration++) {
      const snapshot = snapshotGame(game), { context: base, ports, fact } = world(snapshot);
      const work = new FactWorkQueue(snapshot.tick, iteration === 0 ? 0 : 6144);
      let landRoute: AllocationLandRouteReader | undefined;
      const context = { ...base, readFact: (request: GoalFact): GoalFactObservation => {
        if (request.predicate.kind !== 'route' || !landRoute) throw Error('shared route required');
        const route = landRoute(request.predicate.from.point, request.predicate.to.point);
        if (route.status === 'known') {
          const actor = request.predicate.actor;
          const unit = snapshot.units.find(unit => actor?.kind === 'existing' && unit.id === actor.entityId)!;
          return { ...knownRoute(request, snapshot.tick), revision: JSON.stringify(route),
            route: { distance: route.distance, ticks: route.distance / unit.speed * SIM_TICKS_PER_SECOND, points: route.points } };
        }
        return { fact: request, state: route.status === 'unreachable' ? 'unmet' : 'pending', observedTick: snapshot.tick,
          revision: JSON.stringify(route), reason: { code: route.reasonCode, factIds: [request.id], values: {} }, evidence: [],
          ...(route.status === 'unknown' ? { requestId: request.id, requestedTick: 0 } : {}) } as GoalFactObservation;
      } };
      result = strict(() => withFactWork(work, () => withAllocationArrivalQuery(snapshot, 'us', memory,
        (_a, _b, _c, road) => {
          landRoute = road;
          const observed = readGoalLandCapabilityFact(fact(), context, ports);
          work.flush();
          return observed;
        }, Infinity)));
      if (!iteration) expect(result!.state).toBe('pending');
      expect(work.receipt.used).toBeLessThanOrEqual(work.receipt.limit);
      Object.assign(memory, JSON.parse(JSON.stringify(memory)));
      for (let tick = 0; tick < 15; tick++) stepGame(game);
    }
    expect(result!.state).toBe('met');
  });

  it('does not turn pending, missing ETA or future route availability into a known failure or a present capability', () => {
    const snapshot = snapshotGame(nativeGame()), { context: base, ports, fact } = world(snapshot);
    const pending = (request: GoalFact): GoalFactObservation => ({ fact: request, state: 'pending', observedTick: snapshot.tick,
      revision: 'route-rev', requestId: `road:${request.id}`, requestedTick: -15, evidence: [],
      reason: { code: 'shared-route-pending', factIds: [request.id], values: {} } });
    const result = readGoalLandCapabilityFact(fact(), { ...base, readFact: pending }, ports)!;
    expect(result).toMatchObject({ state: 'pending', requestedTick: -15 });
    for (const readFact of [(f: GoalFact) => knownRoute(f, snapshot.tick, null),
      (f: GoalFact) => ({ ...knownRoute(f, snapshot.tick), availableTick: snapshot.tick + 100 })])
      expect(readGoalLandCapabilityFact(fact(), { ...base, readFact }, ports)!.state).toBe('pending');
    expect(readGoalLandCapabilityFact(fact(), { ...base, readFact: f => ({ ...knownRoute(f, snapshot.tick), state: 'unmet' }) }, ports)!.state).toBe('unmet');
  });

  it('uses the actual native variant weapon clock, and requires two shots within the declared window', () => {
    const game = nativeGame();
    game.variants = { quickCounter: resolveVariant({ base: 'horseArcher', attackDamage: 60, attackRange: 400, attackCooldown: 13 }) };
    const counter = spawnVariantUnit(game, 'us', 'quickCounter', 650, 900);
    // The saved field is not the wielded/variant weapon's firing interval;
    // native combatCapability has the same distinction.
    counter.attackCooldown = 91;
    const snapshot = snapshotGame(game), { context: base, ports, fact } = world(snapshot);
    const context = { ...base, readFact: (request: GoalFact) => knownRoute(request, snapshot.tick) };
    const p = fact([counter.id]).predicate;
    if (p.kind !== 'interception-capability') throw Error('wrong fact');
    expect(readGoalLandCapabilityFact(goalFact({ ...p, throughTick: snapshot.tick + 20 }), context, ports)!.state).toBe('met');
    expect(readGoalLandCapabilityFact(goalFact({ ...p, throughTick: snapshot.tick + 12 }), context, ports)!.state).toBe('unmet');
  });

  it('requires a bound formal window proof instead of treating a quiet present as future control', () => {
    const snapshot = snapshotGame(nativeGame()), { context, ports } = world(snapshot);
    const at = { entityId: 'home', landId: landIdAt(snapshot.map, { x: 300, y: 300 })!, point: { x: 300, y: 300 } };
    for (const fact of [goalFact({ kind: 'route-controlled', at, throughTick: 2000 }),
      goalFact({ kind: 'harassment-ended', site: at, throughTick: 2000 })]) {
      expect(strict(() => readGoalLandCapabilityFact(fact, context, ports))!.state).toBe('pending');
      expect(readGoalLandCapabilityFact(fact, context, { ...ports, readWindowProof: () => knownRoute(fact, context.tick) })!.state).toBe('met');
      expect(readGoalLandCapabilityFact(fact, context, { ...ports, readWindowProof: () => ({ ...knownRoute(fact, context.tick), observedTick: -1 }) })!.state).toBe('pending');
    }
    expect(readGoalLandCapabilityFact(goalFact({ kind: 'gold', minimum: 1, byTick: 2000 }), context, ports)).toBeNull();
  });

  it('recognizes a real native death only with lifecycle provenance and never treats allies or unknown IDs as destroyed enemies', () => {
    const game = nativeGame(), before = snapshotGame(game), original = before.units.find(unit => unit.id === 'sentry')!;
    expect(tryPlayerCommand(game, 'us', { type: 'attack', unitIds: ['counter-a'], targetId: 'sentry' }).ok).toBe(true);
    for (let tick = 0; tick < 400 && game.units.some(unit => unit.id === 'sentry' && unit.hp > 0); tick++) stepGame(game);
    const snapshot = snapshotGame(game), { context, ports } = world(snapshot);
    expect(snapshot.units.some(unit => unit.id === 'sentry' && unit.hp > 0)).toBe(false);
    const destroyed = goalFact({ kind: 'enemy-site-destroyed', site: { entityId: 'sentry', point: { x: original.x, y: original.y } } });
    if (!snapshot.units.some(unit => unit.id === 'sentry')) expect(readGoalLandCapabilityFact(destroyed, context, ports)!.state).toBe('pending');
    expect(readGoalLandCapabilityFact(destroyed, context, { ...ports,
      destroyedEntity: id => id === original.id ? { owner: original.owner, destroyedTick: snapshot.tick, revision: 'actual-native-death' } : null })!.state).toBe('met');
    for (const id of ['allied-counter', 'not-a-real-entity']) {
      const fact = goalFact({ kind: 'enemy-site-destroyed', site: { entityId: id, point: { x: 0, y: 0 } } });
      expect(readGoalLandCapabilityFact(fact, context, ports)!.state).not.toBe('met');
    }
  });
});
