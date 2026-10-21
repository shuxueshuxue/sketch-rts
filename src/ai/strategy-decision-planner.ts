import { planAiOwnerCommandEntries, type AiOwnerPlannerOptions, type AiOwnerPlannerRequest } from './planner-context';
import type { GameSnapshot } from '../shared/types';
import { buildStrategyDecision, type StrategyDecision } from './strategy/decision';
import type { ObjectiveFamily } from './strategy/plan';
import type { AiPolicyContext } from './policy/types';
import type { SituationObservation } from './strategy/types';

/** The same accepted-plan observation boundary without constructing AiPlanTrace.
 * This is opt-in measurement/API plumbing; the room's command path is unchanged. */
export function planAiOwnerCommandEntriesWithDecision<Source extends string = string>(snapshot: GameSnapshot,
  request: AiOwnerPlannerRequest<Source>, options: AiOwnerPlannerOptions = {}, families?: readonly ObjectiveFamily[]) {
  let decision: StrategyDecision | undefined;
  let observed: { context: AiPolicyContext; observation: SituationObservation } | undefined;
  const commands = planAiOwnerCommandEntries(snapshot, request, { ...options, strategyObservation: 'facts', observeBootstrapPlan(context, entries, actual) {
    options.observeBootstrapPlan?.(context, entries, actual);
    if (actual) decision = actual.decision;
    const healing = entries.flatMap(entry => ['mobileCare', 'frontRecovery'].includes(entry.scriptId ?? '') && 'unitIds' in entry.command
      ? entry.command.unitIds.map(unitId => ({ unitId, executor: entry.scriptId! })) : []);
    observed = { context, observation: { healing } };
  } });
  // The command planner's temporary road/shore scopes have now been released.
  // Its final context and accepted healing membership are the same input facts.
  if (!decision && observed) decision = buildStrategyDecision(snapshot, request.playerId, observed.context, families, observed.observation);
  return { commands, decision };
}
