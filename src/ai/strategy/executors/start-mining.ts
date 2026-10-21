import { GOLD_MINE_RULES, mineEntrance } from '../../../shared/mining';
import { sameGround, walkingDistance } from '../../../shared/terrain';
import { distance } from '../../policy/spatial';
import type { StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, validExecutorGrant } from '../executor-grants';
import { currentAllocationLandRouteReader } from '../allocation-arrival-query';

/** A native work order starts the income chain; an accepted order or a hall
 * icon is not evidence that a worker has started gathering. */
export const startMiningExecutor: StrategyExecutor = {
  id: 'strategy.start-mining',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    if (input.execution.intent.kind !== 'start-mining') return blockedExecutor(input, 'mining-intent-required');
    const { snapshot, owner, execution } = input, base = executorFeedback(input);
    const mine = snapshot.resources.find(resource => resource.id === execution.target.entityId && resource.amount > 0);
    if (!mine) return { ...base, status: 'failed', reasons: [{ executor: this.id, outcome: 'abandoned', reason: 'mining-target-no-longer-valid' }] };
    const hall = snapshot.buildings.find(building => building.kind === 'townHall' && building.owner === owner
      && building.hp > 0 && building.complete && sameGround(snapshot.map, building, mine)
      && distance(building, mine) <= GOLD_MINE_RULES.baseRange);
    if (!hall) return blockedExecutor(input, 'mining-hall-not-yet-complete');
    const granted = grantedUnits(input).filter(unit => unit.kind === 'worker');
    if (!granted.length) return blockedExecutor(input, 'no-granted-mining-worker');
    const interrupted = granted.filter(unit => input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    const workers = granted.filter(unit => !interrupted.includes(unit) && !unit.deck && !unit.cabin && !unit.garrison
      && sameGround(snapshot.map, unit, mine));
    if (workers.length + interrupted.length !== granted.length)
      return blockedExecutor(input, 'granted-mining-worker-not-on-target-land', granted.map(unit => unit.id));
    const working = workers.filter(unit => unit.order.type === 'mine' && unit.order.resourceId === mine.id
      && (unit.order.phase === 'gather' || unit.order.phase === 'return'));
    const read = currentAllocationLandRouteReader(), pending: string[] = [];
    const blocked = workers.filter(unit => {
      if (working.includes(unit)) return false;
      const entrance = mineEntrance(snapshot.map, mine, unit, unit.radius);
      if (!read) return walkingDistance(snapshot.map, unit, entrance) === undefined;
      const route = read(unit, entrance);
      if (route.status === 'unknown') pending.push(unit.id);
      return route.status === 'unreachable';
    });
    if (blocked.length) return blockedExecutor(input, 'mining-entrance-unreachable', blocked.map(unit => unit.id));
    const recorded = new Set(Array.isArray(execution.state.startedWorkerIds)
      ? execution.state.startedWorkerIds.filter((value): value is string => typeof value === 'string') : []);
    const started = working.filter(unit => !recorded.has(unit.id));
    const allWorking = !interrupted.length && !pending.length && workers.every(unit => unit.order.type === 'mine' && unit.order.resourceId === mine.id
      && (working.includes(unit) || recorded.has(unit.id)));
    const allPending = pending.length === workers.length && !working.length;
    return { ...base, status: allWorking ? 'complete' : interrupted.length || allPending ? 'blocked' : 'active',
      phase: allWorking ? 'mining-started' : interrupted.length ? 'mining-interrupted' : allPending ? 'mining-route-pending' : 'approaching-mine',
      state: { ...execution.state, hallId: hall.id, mineId: mine.id,
        startedWorkerIds: [...new Set([...recorded, ...working.map(unit => unit.id)])].sort() },
      commands: workers.filter(unit => !pending.includes(unit.id) && !(unit.order.type === 'mine' && unit.order.resourceId === mine.id))
        .map(unit => ({ command: { type: 'mine', unitIds: [unit.id], resourceId: mine.id }, purpose: 'task' })),
      progress: started.length ? [{ kind: 'mining-started', unitIds: started.map(unit => unit.id).sort(),
        entityIds: [mine.id, hall.id], basis: 'observed-world' }] : [],
      reasons: [...(interrupted.length ? [{ executor: this.id, outcome: 'blocked' as const, reason: 'mining-workers-interrupted',
        unitIds: interrupted.map(unit => unit.id) }] : []), ...(pending.length ? [{ executor: this.id, outcome: 'paused' as const,
        reason: 'mining-entrance-route-pending', unitIds: pending }] : [])] };
  },
};
