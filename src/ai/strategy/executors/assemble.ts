import { unitMover } from '../../../shared/catalog';
import { distance } from '../../policy/spatial';
import { sameGround, walkingDistance } from '../../../shared/terrain';
import type { ExecutorFeedback, StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, validExecutorGrant } from '../executor-grants';
import { ASSEMBLY_RANGE } from '../assembly-posts';
import { currentAllocationLandRouteReader } from '../allocation-arrival-query';

/** Explicitly moves this granted manifest while another action obtains its
 * transport. Completion means actual arrival, not a remembered move order. */
export const assembleExecutor: StrategyExecutor = {
  id: 'strategy.assemble',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { snapshot, execution } = input, base = executorFeedback(input), destination = execution.target.point;
    const cohort = grantedUnits(input).filter(unit => unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin
      && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    if (!cohort.length) return blockedExecutor(input, 'no-granted-assembly-members');
    const read = currentAllocationLandRouteReader(), pending: string[] = [], unreachable: string[] = [];
    if (!read && cohort.some(unit => !sameGround(snapshot.map, unit, destination) || walkingDistance(snapshot.map, unit, destination) === undefined))
      return blockedExecutor(input, 'assembly-route-unreachable', cohort.map(unit => unit.id));
    if (read) for (const unit of cohort) {
      if (!sameGround(snapshot.map, unit, destination)) { unreachable.push(unit.id); continue; }
      const route = read(unit, destination);
      if (route.status === 'unknown') pending.push(unit.id);
      if (route.status === 'unreachable') unreachable.push(unit.id);
    }
    if (unreachable.length) return blockedExecutor(input, 'assembly-route-unreachable', unreachable);
    if (pending.length) return blockedExecutor(input, 'assembly-route-pending', pending);
    const arrived = cohort.filter(unit => distance(unit, destination) <= ASSEMBLY_RANGE);
    const complete = arrived.length === cohort.length;
    return { ...base, status: complete ? 'complete' : 'active', phase: complete ? 'assembled' : 'assembling',
      commands: cohort.flatMap<ExecutorFeedback['commands'][number]>(unit => {
        if (unit.order.type === 'cast' || unit.order.type === 'charge') return [];
        if (arrived.includes(unit)) return unit.order.type === 'hold' ? []
          : [{ command: { type: 'holdPosition' as const, unitIds: [unit.id] }, purpose: 'task' as const }];
        return unit.order.type === 'move' && unit.order.avoidCombat && distance(unit.order, destination) < 40 ? []
          : [{ command: { type: 'move' as const, unitIds: [unit.id], ...destination, avoidCombat: true }, purpose: 'task' as const }];
      }) };
  },
};
