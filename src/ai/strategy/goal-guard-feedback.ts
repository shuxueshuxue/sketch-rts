import type { GameSnapshot } from '../../shared/types';
import type { ExecutorFeedback, StrategyAllocationMemory } from './allocation-types';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { sameAction } from './control';
import { readGoalIntent } from './goal-authority-references';
import { goalEntityIds, goalTarget } from './goal-executor-parameters';
import { goalValueKey } from './goal-facts';
import { landIdAt } from './regions';

/** The historical receipt requires actual native holds under the same leases.
 * A proposed hold command cannot finish a protection obligation. */
export function validateGoalGuardFeedback(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  feedback: ExecutorFeedback): ExecutorFeedback {
  const execution = memory.executions[feedback.action.actionId];
  if (execution?.intent.kind !== 'goal-action' || execution.intent.actionKind !== 'hold-position') return feedback;
  const parameters = readGoalIntent(memory, execution.intent).parameters;
  if (typeof parameters.protectionWindowTicks !== 'number') return feedback;
  const ids = goalEntityIds(parameters.cohort), at = goalTarget(parameters.target), through = parameters.throughTick;
  const actual = ids?.length && at && typeof through === 'number' && ids.every(id => {
    const unit = snapshot.units.find(unit => unit.id === id), lease = memory.leases[`unit:${id}`], assignment = memory.assignments[`assignment:${id}`];
    return unit && unit.owner === memory.owner && unit.hp > 0 && unit.expiresTick === undefined && !unit.deck && !unit.cabin && unit.order.type === 'hold'
      && at.landId && landIdAt(snapshot.map, unit) === at.landId
      && Math.hypot(unit.x - at.point.x, unit.y - at.point.y) <= ASSEMBLY_RANGE
      && lease?.origin === 'allocator' && sameAction(lease.action, execution.token) && lease.minimumStayUntilTick >= through
      && assignment && sameAction(assignment.action, execution.token) && !assignment.interruption;
  });
  const currentCompletion = typeof through === 'number' && snapshot.tick >= through
    && typeof feedback.state.goalHoldingSince === 'number' && feedback.state.goalHoldingSince < through
    && feedback.state.goalProtectionCheckedTick === snapshot.tick
    && typeof feedback.state.goalProtectionCheckedThrough === 'number' && feedback.state.goalProtectionCheckedThrough >= snapshot.tick
    && typeof feedback.state.goalProtectionLeaseThrough === 'number' && feedback.state.goalProtectionLeaseThrough >= through
    && goalValueKey(feedback.state.goalProtectionMemberIds) === goalValueKey(ids);
  if (actual && (feedback.status !== 'complete' || currentCompletion)) return feedback;
  const state = { ...feedback.state };
  for (const key of ['goalHoldingSince', 'goalProtectionCheckedTick', 'goalProtectionCheckedThrough', 'goalProtectionLeaseThrough', 'goalProtectionMemberIds']) delete state[key];
  return { ...feedback, state, ...(feedback.status === 'complete' ? { status: 'blocked' as const,
    phase: 'await-native-guard-proof' } : {}) };
}
