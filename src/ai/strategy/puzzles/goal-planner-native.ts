import { withNavigationAudit, withNavigationPhase } from '../../../shared/navigation-audit';
import type { GameSnapshot, PlayerId } from '../../../shared/types';
import type { AiPolicyMemory } from '../../memory';
import { withGoalPlannerInput } from '../goal-planner-input';
import type { GoalPlannerInput } from '../goal-planner-types';

/** One native room-policy think. The caller retains memory across thinks on
 * the same frozen snapshot. Omitted goals select the shared
 * Objective collector and its existing benefit terms. No puzzle identity,
 * requested chain, valuation override or extra work allowance enters here. */
export function withInput<T>(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  run: (input: GoalPlannerInput) => T): T {
  return withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw new Error(event.operation);
  }, () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({
    snapshot, owner, version: 'v9_knight', memory,
  }, run)));
}
