import { forceFor } from '../../policy/v7/creep';
import { armedFoes, nativeLandRoad } from '../../bootstrap_1/safe-land-route';
import { workerEscapeDestination, workerThreatAt } from '../../bootstrap_1/worker-safety';
import { neutralCampExposure } from '../../situation/neutral-camp-exposure';
import type { ExecutorFeedback, ExecutorInput, SafetyBlockedQuote, SafetyObstacle, AllocationReason } from '../allocation-types';
import { executorFeedback, grantedUnits, sameAction, validExecutorGrant } from '../executor-grants';

const reason = (code: string, factIds: readonly string[] = []): AllocationReason => ({ code, factIds, values: {} });

/** Observe a currently executing parent, never a queued intention or a former
 * build order. The gateway decides whether the proposed interruption took effect. */
export function observeWorkerSafetyInterruption(input: ExecutorInput): ExecutorFeedback | null {
  if (!validExecutorGrant(input)) return null;
  const { snapshot, owner, grant, execution } = input;
  const foes = armedFoes(snapshot, owner, {}).filter(foe => !('order' in foe && (foe.deck || foe.cabin)));
  const commands: ExecutorFeedback['commands'][number][] = [], blocked: SafetyBlockedQuote[] = [];
  for (const worker of grantedUnits(input).filter(unit => unit.kind === 'worker' && !unit.deck && !unit.cabin && !unit.garrison)) {
    const order = grant.orders.find(order => order.unitId === worker.id && order.purpose === 'task'
      && sameAction(order.action, execution.token) && order.observedTick === snapshot.tick
      && order.observedOrder !== null && JSON.stringify(order.observedOrder) === JSON.stringify(worker.order));
    const issued = order && grant.commands.find(command => command.id === order.commandId
      && command.purpose === 'task' && command.executor === order.executor && sameAction(command.action, execution.token));
    if (!order || !issued || ['idle', 'hold', 'board', 'cast'].includes(worker.order.type)) continue;
    const threats = foes.filter(foe => workerThreatAt(snapshot, worker, worker, foe));
    if (!threats.length) continue;
    const exposure = neutralCampExposure(snapshot);
    const camps = exposure.camps.filter(camp => camp.memberIds.some(id => threats.some(foe => foe.id === id)));
    const actualOrder = worker.order;
    const actualGoal = 'x' in actualOrder && 'y' in actualOrder && typeof actualOrder.x === 'number' && typeof actualOrder.y === 'number'
      ? { x: actualOrder.x, y: actualOrder.y }
      : actualOrder.type === 'mine' ? snapshot.resources.find(mine => mine.id === actualOrder.resourceId)
      : actualOrder.type === 'repair' ? snapshot.buildings.find(building => building.id === actualOrder.buildingId) : undefined;
    const road = actualGoal && nativeLandRoad(snapshot, worker, actualGoal);
    const segment = road?.points.slice(0, 2) ?? [worker, worker];
    const obstacles: SafetyObstacle[] = [
      ...camps.map(camp => ({ kind: 'camp' as const, memberIds: camp.memberIds,
        point: { point: camp.camp.center } })),
      ...threats.filter(foe => !('order' in foe)).map(tower => ({ kind: 'enemy-tower' as const,
        towerId: tower.id, point: { entityId: tower.id, point: { x: tower.x, y: tower.y } } })),
      { kind: 'route-segment', from: { point: { x: segment[0]!.x, y: segment[0]!.y } },
        to: { point: { x: segment.at(-1)!.x, y: segment.at(-1)!.y } },
        reason: reason('worker-current-steering-segment-exposed', threats.map(foe => foe.id)) },
    ];
    const escape = workerEscapeDestination(snapshot, owner, worker, foes, {});
    if (escape) commands.push({ command: { type: 'move', unitIds: [worker.id], ...escape.shelter, avoidCombat: true }, purpose: 'life-saving' });
    const why = reason(escape ? 'parent-action-interrupted-by-worker-safety' : 'worker-safety-has-no-safe-escape', threats.map(foe => foe.id));
    blocked.push({ id: `${execution.token.actionId}:${execution.token.generation}:safety:${worker.id}`,
      parent: execution.token, objectiveId: execution.objectiveId, methodId: execution.methodId,
      interruptedCommandId: order.commandId, interruptedExecutor: order.executor, interruptedTick: snapshot.tick,
      interruptedUnitId: worker.id, actualInterruptedOrder: structuredClone(worker.order),
      heldLeaseIds: grant.leases.filter(lease => lease.resourceKey === `unit:${worker.id}`).map(lease => lease.id),
      unpaidBudgetIds: grant.budgets.filter(budget => budget.state === 'reserved' && budget.amountGold > budget.paidGold).map(budget => budget.id),
      obstacles, potentialUtility: null,
      missingPreconditions: camps.length ? camps.map(camp => ({ id: `${execution.token.actionId}/clear:${camp.memberIds.join(',')}`,
        kind: 'force', status: 'unmet', reason: why, subgoalIds: [],
        demand: { kind: 'force', metric: 'camp-force', strength: forceFor(camp.camp), roles: ['frontline', 'ranged'],
          at: { point: camp.camp.center }, neededByTick: null, permanent: true } }))
        : [{ id: `${execution.token.actionId}/safe-worker-route`, kind: 'route', status: 'unmet', reason: why, demand: null, subgoalIds: [] }],
      alternatives: (['continue', 'reassign', 'clear-obstacle', 'abandon'] as const).map(kind => ({ kind, methodId: null,
        estimatedGold: null, estimatedTicks: null, includedSpendIds: [], reason: reason(`${kind}-requires-allocation-quote`, threats.map(foe => foe.id)) })),
      reason: { executor: 'strategy.worker-safety', outcome: 'blocked', reason: why.code,
        taskId: execution.token.actionId, unitIds: [worker.id], targetIds: threats.map(foe => foe.id) } });
  }
  return blocked.length ? { ...executorFeedback(input), status: 'blocked', commands, blocked,
    reasons: blocked.map(quote => quote.reason) } : null;
}
