import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import { snapshotGame } from '../../../shared/sim';
import type { GameSnapshot } from '../../../shared/types';
import { setBuildingBodies } from '../../../shared/terrain';
import { standingBodies } from '../../../shared/structure-bodies';
import { withNavigationAudit, withNavigationPhase } from '../../../shared/navigation-audit';
import type { AllocationLandRouteReader } from '../allocation-arrival-query';
import { withAllocationLandRoutes } from '../allocation-arrival-query';
import type { ExecutorInput, StrategyExecutor, ActionIntent } from '../allocation-types';
import { clearCampExecutor } from './clear-camp';
import { assembleExecutor } from './assemble';
import { startMiningExecutor } from './start-mining';
import { evacuateExecutor } from './evacuate';
import { observeWorkerSafetyInterruption } from './worker-safety';
import { safeLandTravelTicks, withLandRoadReuse } from '../../bootstrap_1/safe-land-route';

const known: AllocationLandRouteReader = (from, goal) => ({ status: 'known', points: [goal], distance: Math.hypot(goal.x - from.x, goal.y - from.y) });
const pending: AllocationLandRouteReader = () => ({ status: 'unknown', reasonCode: 'shared-route-pending' });
const unreachable: AllocationLandRouteReader = () => ({ status: 'unreachable', reasonCode: 'shared-route-unreachable' });
function guarded<T>(read: AllocationLandRouteReader, run: () => T): T {
  return withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw new Error(`Unbudgeted native route: ${event.operation}`);
  }, () => withNavigationPhase('strategy-planning', () => withAllocationLandRoutes(read, run)));
}
function grant(snapshot: GameSnapshot, executor: string, intent: ActionIntent, target: ExecutorInput['execution']['target'], ids: string[]): ExecutorInput {
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const objectiveId = 'goal', methodId = 'method', token = { actionId: 'action', generation: 1 };
  return { snapshot, owner: 'us', objective: { id: objectiveId, owner: 'us', kind: 'ConquerIsland', target, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'active', sinceTick: 0, rank: 1, reasons: [], methodIds: [methodId],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } },
    method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [], estimatedTicks: null, status: 'selected', reasons: [] },
    execution: { token, objectiveId, methodId, executor, intent, target, dependsOn: [], completionEffects: [], status: 'active',
      phase: 'gather', sinceTick: 0, lastProgressTick: 0, state: {} },
    grant: { revision: 1, action: token, objectiveId, methodId, assignments: [], budgets: [], voyages: [], orders: [], commands: [], orderOverrides: [],
      leases: ids.map(id => ({ id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId, methodId, action: token,
        sinceTick: 0, minimumStayUntilTick: 0, origin: 'allocator', incumbentTask: null })) }, events: [] };
}
function clearing(): ExecutorInput {
  const scene = sketchScene('granted-clearing-route-port').map('bareDuel').replaceDefaults().player('us').player('foe')
    .goldMine('mine', 1400, 1400, 10000).unit('neutral', 'ogreWarrior', 1400, 1400, { id: 'guard' });
  for (let i = 0; i < 8; i++) scene.unit('us', 'emberRavager', 1000 + i * 3, 1400, { id: `fighter-${i}` });
  const snapshot = snapshotGame(scene.build().createGame());
  return grant(snapshot, clearCampExecutor.id, { kind: 'clear-camp', memberIds: ['guard'] },
    { entityId: 'mine', point: { x: 1400, y: 1400 } }, snapshot.units.filter(unit => unit.owner === 'us').map(unit => unit.id));
}
function mining(): ExecutorInput {
  const snapshot = snapshotGame(sketchScene('granted-mining-route-port').map('bareDuel').replaceDefaults().player('us').player('foe')
    .goldMine('mine', 1400, 1400, 10000).townHall('us', 1616, 1400).worker('us', 1552, 1400, { id: 'worker' }).build().createGame());
  return grant(snapshot, startMiningExecutor.id, { kind: 'start-mining' }, { entityId: 'mine', point: { x: 1400, y: 1400 } }, ['worker']);
}
function evacuating(): ExecutorInput {
  const snapshot = snapshotGame(sketchScene('granted-evacuation-route-port').map('bareDuel').replaceDefaults().player('us').player('foe')
    .building('us', 'townHall', 600, 1000, { id: 'hall' }).worker('us', 1000, 1000, { id: 'worker' }).build().createGame());
  return grant(snapshot, evacuateExecutor.id, { kind: 'evacuate' }, { entityId: 'hall', point: { x: 600, y: 1000 } }, ['worker']);
}
function assembling(): ExecutorInput {
  const input = clearing();
  return { ...input, execution: { ...input.execution, executor: assembleExecutor.id,
    intent: { kind: 'borrow-force' }, target: { point: { x: 900, y: 1200 } } } };
}

describe('granted executors use the same audited land route boundary', () => {
  it('rechecks a published road instead of reusing a native safe-road answer for different geometry', () => {
    const snapshot = snapshotGame(sketchScene('route-proof-cache').map('bareDuel').replaceDefaults().player('us').player('foe')
      .worker('us', 200, 200, { id: 'worker' }).building('foe', 'defenseTower', 400, 700).build().createGame());
    const worker = snapshot.units[0]!, tower = snapshot.buildings[0]!, goal = { x: 600, y: 200 };
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    withLandRoadReuse(() => {
      expect(safeLandTravelTicks(snapshot, worker, goal, [tower])).toBeDefined();
      expect(safeLandTravelTicks(snapshot, worker, goal, [tower], undefined,
        () => ({ ticks: 100, points: [worker, { x: tower.x, y: tower.y }, goal] }))).toBeUndefined();
    });
  });
  it.each<{ name: string; create: () => ExecutorInput; executor: StrategyExecutor; pendingReason: string; blockedReason: string }>([
    { name: 'assemble', create: assembling, executor: assembleExecutor, pendingReason: 'assembly-route-pending', blockedReason: 'assembly-route-unreachable' },
    { name: 'clear camp', create: clearing, executor: clearCampExecutor, pendingReason: 'clearing-route-pending', blockedReason: 'clearing-geometry-blocked' },
    { name: 'start mining', create: mining, executor: startMiningExecutor, pendingReason: 'mining-entrance-route-pending', blockedReason: 'mining-entrance-unreachable' },
    { name: 'evacuate', create: evacuating, executor: evacuateExecutor, pendingReason: 'evacuation-route-pending', blockedReason: 'evacuation-route-blocked' },
  ])('$name keeps pending distinct, consumes known facts and retains the native default', ({ create, executor, pendingReason, blockedReason }) => {
    const input = create(), saved = JSON.stringify(input);
    const waiting = guarded(pending, () => executor.execute(input));
    expect(waiting.commands).toEqual([]); expect(waiting.reasons.some(item => item.reason === pendingReason)).toBe(true);
    const blocked = guarded(unreachable, () => executor.execute(input));
    expect(blocked.commands).toEqual([]); expect(blocked.reasons.some(item => item.reason === blockedReason)).toBe(true);
    const ready = guarded(known, () => executor.execute(input));
    expect(['active', 'complete']).toContain(ready.status); expect(ready.commands.length).toBeGreaterThan(0);
    const cold: ExecutorInput = JSON.parse(saved); setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(guarded(known, () => executor.execute(cold))).toEqual(ready); expect(JSON.stringify(input)).toBe(saved);
    let nativeCalls = 0;
    withNavigationAudit(event => { if (!event.authorization) nativeCalls++; }, () => executor.execute(input));
    expect(nativeCalls).toBeGreaterThan(0);
  });

  it('keeps the clearing retreat pending rather than proving there is no safe road', () => {
    const input = clearing();
    const reduced: ExecutorInput = { ...input, execution: { ...input.execution, phase: 'engage', state: { staging: { x: 800, y: 1400 } } },
      grant: { ...input.grant, leases: input.grant.leases.slice(0, 1) } };
    const waiting = guarded(pending, () => clearCampExecutor.execute(reduced));
    expect(waiting.commands).toEqual([]); expect(waiting.reasons.some(reason => reason.reason === 'clearing-retreat-route-pending')).toBe(true);
    expect(guarded(known, () => clearCampExecutor.execute(reduced)).commands.every(command => command.purpose === 'life-saving')).toBe(true);
  });

  it('checks the no-neutral-guard clearing road against the same route reader', () => {
    const input = clearing(); input.snapshot.units.find(unit => unit.id === 'guard')!.owner = 'foe';
    const waiting = guarded(pending, () => clearCampExecutor.execute(input));
    expect(waiting.reasons[0]?.reason).toBe('clearing-route-pending');
  });

  it('does not invent an escape or a steering segment when the real worker route facts are pending', () => {
    const game = sketchScene('granted-worker-safety-route-port').map('bareDuel').replaceDefaults().player('us').player('foe')
      .building('us', 'townHall', 600, 1000, { id: 'hall' }).building('foe', 'defenseTower', 1180, 1000)
      .worker('us', 1000, 1000, { id: 'worker' }).build().createGame();
    const command = { type: 'move' as const, unitIds: ['worker'], x: 900, y: 1000 };
    issueCommandFrame(game, [{ command, playerId: 'us', scriptId: 'strategy.build-hall' }]);
    const input = grant(snapshotGame(game), 'strategy.build-hall', { kind: 'build-hall' }, { point: { x: 600, y: 1000 } }, ['worker']);
    const token = input.execution.token, worker = input.snapshot.units.find(unit => unit.id === 'worker')!;
    const request: ExecutorInput = { ...input, grant: { ...input.grant,
      commands: [{ id: 'accepted', action: token, executor: input.execution.executor, purpose: 'task', acceptedTick: input.snapshot.tick, command }],
      orders: [{ commandId: 'accepted', action: token, executor: input.execution.executor, purpose: 'task', unitId: worker.id,
        acceptedTick: input.snapshot.tick, observedTick: input.snapshot.tick, observedOrder: structuredClone(worker.order) }] } };
    const saved = JSON.stringify(request), waiting = guarded(pending, () => observeWorkerSafetyInterruption(request));
    expect(waiting).not.toBeNull(); expect(waiting!.commands).toEqual([]);
    expect(waiting!.blocked[0]!.reason.reason).toBe('worker-safety-escape-route-pending');
    expect(waiting!.blocked[0]!.missingPreconditions.some(condition => condition.status === 'unknown')).toBe(true);
    expect(waiting!.blocked[0]!.obstacles.some(obstacle => obstacle.kind === 'route-segment')).toBe(false);
    const noRoad = guarded(unreachable, () => observeWorkerSafetyInterruption(request));
    expect(noRoad!.blocked[0]!.reason.reason).toBe('worker-safety-has-no-safe-escape');
    const escaped = guarded(known, () => observeWorkerSafetyInterruption(request));
    expect(escaped!.commands.length).toBeGreaterThan(0); expect(escaped!.commands.every(command => command.purpose === 'life-saving')).toBe(true);
    expect(JSON.stringify(request)).toBe(saved);
    const cold: ExecutorInput = JSON.parse(saved); setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(guarded(known, () => observeWorkerSafetyInterruption(cold))).toEqual(escaped);
    let nativeCalls = 0; withNavigationAudit(event => { if (!event.authorization) nativeCalls++; }, () => observeWorkerSafetyInterruption(request));
    expect(nativeCalls).toBeGreaterThan(0);
  });
});
