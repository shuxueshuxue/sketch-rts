import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../../shared/sim';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import { setBuildingBodies } from '../../../shared/terrain';
import { standingBodies } from '../../../shared/structure-bodies';
import type { GameCommand, GameSnapshot } from '../../../shared/types';
import type { ExecutorInput } from '../allocation-types';
import { armedFoes } from '../../bootstrap_1/safe-land-route';
import { workerThreatAt } from '../../bootstrap_1/worker-safety';
import { observeWorkerSafetyInterruption } from './worker-safety';

function threatenedRepair() {
  const frame: { snapshot: GameSnapshot; owner: string; nextId: number; activePlayers: string[] } = JSON.parse(gunzipSync(readFileSync(
    new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['gullIsland-p0-17505'];
  const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(frame.snapshot), frame.nextId);
  game.activePlayers = [...frame.activePlayers];
  const workerId = 'unit-p0-worker-1', hallId = 'building-p0-townHall-9337';
  const command: GameCommand = { type: 'repair', unitIds: [workerId], buildingId: hallId };
  issueCommandFrame(game, [{ command, playerId: frame.owner, scriptId: 'strategy.build-hall' }]);
  let snapshot = snapshotGame(game), exposed = false;
  while (game.tick < 17870) {
    stepGame(game); snapshot = snapshotGame(game);
    const worker = snapshot.units.find(unit => unit.id === workerId);
    if (!worker) break;
    if (armedFoes(snapshot, frame.owner, {}).some(foe => workerThreatAt(snapshot, worker, worker, foe))) { exposed = true; break; }
  }
  expect(exposed).toBe(true);
  const worker = snapshot.units.find(unit => unit.id === workerId)!, hall = snapshot.buildings.find(building => building.id === hallId)!;
  expect(worker.order.type).toBe('repair');
  const action = { actionId: 'ConquerIsland:p0:gold-gen-4/build', generation: 1 }, methodId = 'island:build', objectiveId = 'ConquerIsland:p0:gold-gen-4';
  const target = { entityId: hallId, point: { x: hall.x, y: hall.y } };
  const request: ExecutorInput = { snapshot, owner: frame.owner,
    objective: { id: objectiveId, kind: 'ConquerIsland', owner: frame.owner, target, effects: [], utility: {
      horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
      status: 'active', sinceTick: frame.snapshot.tick, rank: 1, reasons: [], methodIds: [methodId],
      stability: { minimumStayUntilTick: frame.snapshot.tick, challengerId: null, challengerThinks: 0 } },
    method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [],
      estimatedTicks: null, status: 'selected', reasons: [] },
    execution: { token: action, objectiveId, methodId, executor: 'strategy.build-hall', intent: { kind: 'build-hall' }, target,
      dependsOn: [], completionEffects: [], status: 'active', phase: 'constructing', sinceTick: frame.snapshot.tick,
      lastProgressTick: frame.snapshot.tick, state: { hallId } },
    grant: { revision: 2, action, objectiveId, methodId,
      leases: [{ id: 'worker-lease', resourceKey: `unit:${workerId}`, objectiveId, methodId, action,
        sinceTick: frame.snapshot.tick, minimumStayUntilTick: frame.snapshot.tick, origin: 'allocator', incumbentTask: null }],
      assignments: [], voyages: [], orderOverrides: [],
      budgets: [{ id: 'hall-budget', spendId: 'hall:gold-gen-4', objectiveId, methodId, action, amountGold: 400, paidGold: 0,
        state: 'reserved', sinceTick: frame.snapshot.tick, releasedTick: null, includedUtilityTermCodes: [], externalReservationIds: [] }],
      commands: [{ id: 'repair-accepted', action, executor: 'strategy.build-hall', purpose: 'task', acceptedTick: frame.snapshot.tick, command }],
      orders: [{ commandId: 'repair-accepted', action, executor: 'strategy.build-hall', purpose: 'task', unitId: workerId,
        acceptedTick: frame.snapshot.tick, observedTick: snapshot.tick, observedOrder: structuredClone(worker.order) }] }, events: [] };
  return { game, request, workerId };
}

describe('blocked safety quotes from a real island construction worker', () => {
  it('retains the actual parent order, issuer, worker and unpaid capital without inventing an escape', () => {
    const { request } = threatenedRepair(), before = JSON.stringify(request);
    const result = observeWorkerSafetyInterruption(request)!;
    expect(result).not.toBeNull();
    const quote = result.blocked[0]!;
    expect(quote.parent).toEqual(request.execution.token);
    expect(quote.actualInterruptedOrder).toEqual(request.grant.orders[0]!.observedOrder);
    expect(quote.interruptedCommandId).toBe('repair-accepted');
    expect(quote.interruptedExecutor).toBe('strategy.build-hall');
    expect(quote.heldLeaseIds).toEqual(['worker-lease']);
    expect(quote.unpaidBudgetIds).toEqual(['hall-budget']);
    expect(quote.obstacles.some(obstacle => obstacle.kind === 'route-segment')).toBe(true);
    expect(quote.alternatives.every(alternative => alternative.estimatedTicks === null && alternative.estimatedGold === null)).toBe(true);
    expect(result.state).toEqual(request.execution.state);
    expect(JSON.stringify(request)).toBe(before);
    const cold: ExecutorInput = JSON.parse(JSON.stringify(request));
    // The public planner prepares standing bodies before providers/executors.
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(observeWorkerSafetyInterruption(cold)).toEqual(result);
  });

  it('does not resurrect a parent after a real new command replaces its order', () => {
    const { game, request, workerId } = threatenedRepair();
    const worker = game.units.find(unit => unit.id === workerId)!;
    issueCommandFrame(game, [{ command: { type: 'move', unitIds: [workerId], x: worker.x + 200, y: worker.y },
      playerId: request.owner, scriptId: 'new-strategic-action' }]);
    stepGame(game);
    const snapshot = snapshotGame(game);
    expect(snapshot.units.find(unit => unit.id === workerId)!.order.type).toBe('move');
    expect(observeWorkerSafetyInterruption({ ...request, snapshot, grant: { ...request.grant,
      orders: request.grant.orders.map(order => ({ ...order, observedTick: snapshot.tick })) } })).toBeNull();
  });
});
