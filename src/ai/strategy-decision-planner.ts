import { planAiOwnerCommandEntries, type AiOwnerPlannerOptions, type AiOwnerPlannerRequest } from './planner-context';
import type { GameSnapshot } from '../shared/types';
import { buildStrategyDecision, type StrategyDecision } from './strategy/decision';
import type { ObjectiveFamily } from './strategy/plan';

/** The same accepted-plan observation boundary without constructing AiPlanTrace.
 * This is opt-in measurement/API plumbing; the room's command path is unchanged. */
export function planAiOwnerCommandEntriesWithDecision<Source extends string = string>(snapshot: GameSnapshot,
  request: AiOwnerPlannerRequest<Source>, options: AiOwnerPlannerOptions = {}, families?: readonly ObjectiveFamily[]) {
  let decision: StrategyDecision | undefined;
  const commands = planAiOwnerCommandEntries(snapshot, request, { ...options, observeBootstrapPlan(context, entries) {
    options.observeBootstrapPlan?.(context, entries);
    const healing = entries.flatMap(entry => ['mobileCare', 'frontRecovery'].includes(entry.scriptId ?? '') && 'unitIds' in entry.command
      ? entry.command.unitIds.map(unitId => ({ unitId, executor: entry.scriptId! })) : []);
    decision = buildStrategyDecision(snapshot, request.playerId, context, families, { healing });
  } });
  return { commands, decision };
}
