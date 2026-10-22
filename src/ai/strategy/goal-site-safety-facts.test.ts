import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { effectiveCombatRating } from '../policy/v6/strength';
import { withAllocationArrivalQuery } from './allocation-arrival-query';
import { buildStrategyDecision } from './decision';
import { FactWorkQueue, withFactWork } from './fact-work';
import { goalCampId, goalFact } from './goal-facts';
import type { GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import { readGoalSiteSafetyFact, type GoalSafetyWindowProof, type GoalSiteSafetyFactPorts } from './goal-site-safety-facts';
import { landIdAt, regionIndex, seaIdAt } from './regions';

function scene(options: { camp?: boolean; foe?: boolean; tower?: boolean } = {}) {
  const builder = sketchScene('goal-site-safety-domain').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'home' }).player('ally', { team: 'home' }).player('foe', { team: 'away' })
    .townHall('us', 300, 300).townHall('foe', 4000, 4000)
    .worker('us', 600, 600, { id: 'worker' }).unit('us', 'footman', 700, 600, { id: 'escort' })
    .unit('ally', 'knight', 1200, 1200, { id: 'allied-fighter' });
  if (options.foe) builder.unit('foe', 'footman', 1400, 1200, { id: 'enemy' });
  if (options.camp) builder.unit('neutral', 'ogreWarrior', 1170, 1200, { id: 'guard' });
  if (options.tower) builder.building('foe', 'defenseTower', 1250, 1300, { id: 'tower' });
  const game = builder.build().createGame(); game.scriptedVictory = true; return game;
}
function world(snapshot: GameSnapshot, readFact?: GoalPlanningContext['readFact']) {
  regionIndex(snapshot.map);
  const situation = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity).situation;
  const context: GoalPlanningContext = { snapshot, situation, tick: snapshot.tick, owner: 'us', version: 'v9_summoner',
    readFact: readFact ?? (fact => known(fact, snapshot.tick)) };
  const ports: GoalSiteSafetyFactPorts = { regionAt: (point, mover) => mover === 'land'
    ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point) };
  const at = { point: { x: 1200, y: 1200 }, landId: landIdAt(snapshot.map, { x: 1200, y: 1200 })! };
  return { context, ports, at, safe: goalFact({ kind: 'site-safe', site: at, throughTick: snapshot.tick + 600 }) };
}
function known(fact: GoalFact, tick: number, ticks = 50): GoalFactObservation {
  return { fact, state: 'met', observedTick: tick, revision: 'published-domain-route', evidence: [],
    reason: { code: 'published-domain-route', factIds: [fact.id], values: {} }, route: { ticks, distance: 200, points: [] } };
}
function pending(fact: GoalFact, tick: number): GoalFactObservation {
  return { fact, state: 'pending', observedTick: tick, revision: 'queued-domain-route', evidence: [],
    requestId: `road:${fact.id}`, requestedTick: -15, reason: { code: 'shared-route-pending', factIds: [fact.id], values: {} } };
}
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(`Unbudgeted native ${event.operation}`);
}, () => withNavigationPhase('strategy-planning', run));

describe('site safety as same-world observations and explicit threat dependencies', () => {
  it('limits the resolver to safety facts and states the observed-forecast assumptions within the supported window', () => {
    const snapshot = snapshotGame(scene()), { context, ports, at, safe } = world(snapshot), before = JSON.stringify(snapshot);
    const result = strict(() => readGoalSiteSafetyFact(safe, context, ports))!;
    expect(result).toMatchObject({ state: 'met', threats: { unitIds: [], campIds: [], requiredForce: 0 },
      reason: { values: { observedForecast: true, assumesObservedMembership: true, assumesNoNewOrdersOrThreats: true } } });
    expect(readGoalSiteSafetyFact(goalFact({ kind: 'shore-safe', landId: at.landId, landing: at, throughTick: 600 }), context, ports)!.state).toBe('met');
    expect(readGoalSiteSafetyFact(goalFact({ kind: 'gold', minimum: 1, byTick: 600 }), context, ports)).toBeNull();
    expect(readGoalSiteSafetyFact(safe, { ...context, tick: 15 }, ports)).toMatchObject({ state: 'pending', reason: { code: 'safety-fact-epoch-pending' } });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('keeps native camp requirements, additive ordinary force and enemy-tower identities in separate fields', () => {
    const snapshot = snapshotGame(scene({ camp: true, foe: true, tower: true })), { context, ports, safe } = world(snapshot);
    const before = JSON.stringify(snapshot), result = strict(() => readGoalSiteSafetyFact(safe, context, ports))!;
    expect(result.state).toBe('unmet'); expect(result.threats!.unitIds).toEqual(['enemy']);
    expect(result.threats!.campIds).toEqual([goalCampId(['guard'])]);
    expect(result.threats!.requiredForce).toBe(effectiveCombatRating(snapshot, snapshot.units.find(unit => unit.id === 'enemy')!));
    expect(result.derived!.allOf.map(fact => fact.predicate)).toEqual(expect.arrayContaining([
      { kind: 'camp-cleared', campId: goalCampId(['guard']) },
      expect.objectContaining({ kind: 'enemy-site-destroyed', site: expect.objectContaining({ entityId: 'tower' }) }),
      expect.objectContaining({ kind: 'enemy-site-destroyed', site: expect.objectContaining({ entityId: 'enemy' }) }),
    ]));
    expect(result.threats!.unitIds).not.toContain('tower'); expect(result.threats!.unitIds).not.toContain('guard');
    expect(result.threats!.unitIds).not.toContain('allied-fighter'); expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('retains pending route identities across JSON and never interprets an unavailable enemy-actor reader as safety', () => {
    const snapshot = snapshotGame(scene({ foe: true })), base = world(snapshot);
    const context = { ...base.context, readFact: (fact: GoalFact) => pending(fact, snapshot.tick) };
    const a = strict(() => readGoalSiteSafetyFact(base.safe, context, base.ports))!;
    const restored = JSON.parse(JSON.stringify(snapshot)), b = world(restored, fact => pending(fact, restored.tick));
    const other = readGoalSiteSafetyFact(b.safe, b.context, b.ports)!;
    expect(a).toMatchObject({ state: 'pending', requestedTick: -15, threats: { unitIds: ['enemy'] } });
    expect(a.state === 'pending' && other.state === 'pending' && a.requestId).toBe(other.state === 'pending' && other.requestId);
    expect(readGoalSiteSafetyFact(base.safe, { ...base.context, readFact: fact => ({ ...known(fact, snapshot.tick), state: 'unmet',
      reason: { code: 'route-actor-not-available', factIds: [fact.id], values: {} } }) }, base.ports)!.state).toBe('pending');
    expect(readGoalSiteSafetyFact(base.safe, { ...base.context, readFact: fact => ({ ...known(fact, snapshot.tick), state: 'unmet',
      reason: { code: 'native-route-unreachable', factIds: [fact.id], values: {} } }) }, base.ports)).toMatchObject({ state: 'met' });
    expect(readGoalSiteSafetyFact(base.safe, { ...base.context, readFact: fact => known(fact, snapshot.tick, 900) }, base.ports)!.state).toBe('pending');
  });

  it('requires precise same-epoch window proof beyond support and rejects a command acknowledgement as a proof basis', () => {
    const snapshot = snapshotGame(scene()), { context, ports, at } = world(snapshot);
    const safe = goalFact({ kind: 'site-safe', site: at, throughTick: snapshot.tick + context.situation.horizonTicks + 1 });
    expect(readGoalSiteSafetyFact(safe, context, ports)).toMatchObject({ state: 'pending', reason: { code: 'safety-window-support-pending' } });
    const proof: GoalSafetyWindowProof = { observation: known(safe, snapshot.tick), basis: 'verified-execution', supportedThroughTick: 99999 };
    expect(strict(() => readGoalSiteSafetyFact(safe, context, { ...ports, readWindowProof: () => proof }))!.state).toBe('met');
    for (const bad of [{ ...proof, supportedThroughTick: 10 }, { ...proof, observation: { ...proof.observation, observedTick: -1 } },
      { ...proof, observation: { ...proof.observation, availableTick: snapshot.tick + 10 } },
      { ...proof, observation: known(goalFact({ kind: 'site-safe', site: at, throughTick: 1 }), snapshot.tick) },
      { ...proof, basis: 'command-ack' } as unknown as GoalSafetyWindowProof])
      expect(readGoalSiteSafetyFact(safe, context, { ...ports, readWindowProof: () => bad })!.state).toBe('pending');
  });

  it('requires every actual asset in the destination pool and the exact window safety fact, rather than any accepted order', () => {
    const snapshot = snapshotGame(scene()), { context, ports, at } = world(snapshot);
    const fact = goalFact({ kind: 'assets-safe', at, unitIds: ['worker', 'escort'], throughTick: 600 });
    expect(readGoalSiteSafetyFact(fact, context, ports)).toMatchObject({ state: 'met', entityIds: ['escort', 'worker'],
      derived: { allOf: [goalFact({ kind: 'site-safe', site: at, throughTick: 600 })] } });
    expect(readGoalSiteSafetyFact(fact, { ...context, readFact: request => pending(request, snapshot.tick) }, ports)!.state).toBe('pending');
    expect(readGoalSiteSafetyFact(fact, { ...context, readFact: request => ({ ...known(request, snapshot.tick), availableTick: 100 }) }, ports)!.state).toBe('pending');
    expect(readGoalSiteSafetyFact(goalFact({ kind: 'assets-safe', at, unitIds: ['allied-fighter'], throughTick: 600 }), context, ports)!.state).toBe('unmet');
    const worker = snapshot.units.find(unit => unit.id === 'worker')!; worker.deck = { shipId: 'unloaded-by-ack-only', x: 0, y: 0 };
    expect(readGoalSiteSafetyFact(fact, context, { ...ports, readWindowProof: () => ({ observation: known(fact, snapshot.tick),
      supportedThroughTick: 600, basis: 'verified-execution' }) })).toMatchObject({ state: 'unmet', reason: { code: 'assets-not-in-target-pool' } });
    delete worker.deck;
    const otherLand: GoalSiteSafetyFactPorts = { ...ports, regionAt: (point, mover) => point === worker ? 'land:999' : ports.regionAt(point, mover) };
    expect(readGoalSiteSafetyFact(fact, context, otherLand)!.state).toBe('unmet');
  });

  it('leaves an enemy aboard or a conditional unloading forecast pending until its own published arrival exists', () => {
    const snapshot = snapshotGame(scene({ foe: true })), enemy = snapshot.units.find(unit => unit.id === 'enemy')!;
    enemy.deck = { shipId: 'observed-enemy-hull', x: 0, y: 0 };
    const { context, ports, safe } = world(snapshot);
    expect(strict(() => readGoalSiteSafetyFact(safe, context, ports))!.state).toBe('pending');
    expect(readGoalSiteSafetyFact(safe, context, { ...ports, readThreatArrival: () => ({ status: 'reachable',
      ticks: 50, landTicks: 0, crossings: [], evidence: [] }) })).toMatchObject({ state: 'unmet', threats: { unitIds: ['enemy'] } });
    expect(readGoalSiteSafetyFact(safe, context, { ...ports, readThreatArrival: () => ({ status: 'conditional',
      ticks: 50, landTicks: 0, crossings: [], unmet: [], evidence: [] }) })!.state).toBe('pending');
  });

  it('retains a returning camp whose native home alert area covers the site', () => {
    const snapshot = snapshotGame(scene({ camp: true })), guard = snapshot.units.find(unit => unit.id === 'guard')!;
    guard.x = 900; guard.order = { type: 'move', x: guard.homeX!, y: guard.homeY! };
    const { context, ports, safe } = world(snapshot);
    expect(strict(() => readGoalSiteSafetyFact(safe, context, ports))).toMatchObject({ state: 'unmet',
      threats: { campIds: [goalCampId(['guard'])], requiredForce: 0 } });
  });

  it('does not certify a currently unfinished enemy battery as harmless for the whole future window', () => {
    const snapshot = snapshotGame(scene({ tower: true })); snapshot.buildings.find(building => building.id === 'tower')!.complete = false;
    const { context, ports, safe } = world(snapshot);
    expect(strict(() => readGoalSiteSafetyFact(safe, context, ports))).toMatchObject({ state: 'pending',
      reason: { code: 'safety-enemy-construction-pending' }, derived: { allOf: [expect.objectContaining({ predicate:
        expect.objectContaining({ kind: 'enemy-site-destroyed', site: expect.objectContaining({ entityId: 'tower' }) }) })] } });
  });

  it('consumes the same budgeted native route for a foreign actor, with zero-work pending and JSON publication', () => {
    const snapshot = snapshotGame(scene({ foe: true })), { context: base, ports, safe } = world(snapshot), before = JSON.stringify(snapshot);
    let memory = createAiPolicyMemory(), result: GoalFactObservation | null = null;
    for (let sequence = 1; sequence <= 15 && result?.state !== 'unmet'; sequence++) {
      const work = new FactWorkQueue(snapshot.tick, sequence === 1 ? 0 : 6144, undefined, sequence);
      result = strict(() => withFactWork(work, () => withAllocationArrivalQuery(snapshot, 'us', memory, (_a, _b, _c, road) => {
        const context = { ...base, readFact: (fact: GoalFact): GoalFactObservation => {
          if (fact.predicate.kind !== 'route') throw Error('Only a shared route expected');
          const route = road(fact.predicate.from.point, fact.predicate.to.point);
          if (route.status !== 'known') return route.status === 'unknown' ? pending(fact, snapshot.tick)
            : { ...known(fact, snapshot.tick), state: 'unmet' };
          const enemy = snapshot.units.find(unit => unit.id === 'enemy')!;
          return { ...known(fact, snapshot.tick), revision: JSON.stringify(route),
            route: { distance: route.distance, ticks: Math.ceil(route.distance / enemy.speed * SIM_TICKS_PER_SECOND), points: route.points } };
        } };
        const value = readGoalSiteSafetyFact(safe, context, ports); work.flush(); return value;
      })));
      if (sequence === 1) expect(result!.state).toBe('pending');
      expect(work.receipt.used).toBeLessThanOrEqual(sequence === 1 ? 0 : 6144);
      memory = JSON.parse(JSON.stringify(memory));
    }
    expect(result).toMatchObject({ state: 'unmet', threats: { unitIds: ['enemy'] } });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
