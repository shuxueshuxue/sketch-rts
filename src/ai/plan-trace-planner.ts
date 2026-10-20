import { DEFAULT_AI_PLANNER_VERSION, planAiOwnerCommandEntries, type AiMemoryProvider, type AiOwnerPlannerOptions, type AiOwnerPlannerRequest } from './planner-context';
import { createAiPolicyMemory } from './memory';
import { buildAiPlanTrace, type AiPlanTrace } from './plan-trace';
import type { GameSnapshot } from '../shared/types';
import type { AiDeathLedger } from './death-ledger';
import { buildStrategyPlanTrace, type ObjectiveFamily } from './strategy/plan';
import type { StrategyPlanTrace } from './strategy/types';

export type AiPlanTraceOptions = AiOwnerPlannerOptions & { deathLedger?: AiDeathLedger };

/** Opt-in observation at the existing think boundary; executes the ordinary planner exactly once.
 * Only deterministic publication/history writes memory.strategy.observation.
 * Previous traces are display history, not required to restore strategy facts.
 */
export function planAiOwnerCommandEntriesWithTrace<Source extends string = string>(snapshot: GameSnapshot,
  request: AiOwnerPlannerRequest<Source>, options: AiPlanTraceOptions = {}, previous?: AiPlanTrace,
  families?: readonly ObjectiveFamily[]) {
  const { deathLedger, ...plannerOptions } = options;
  let memory = request.memory ?? options.memory;
  let strategy: StrategyPlanTrace | undefined;
  const provider = options.memoryProvider;
  // Observe the existing get/set boundary, including a read-only provider that
  // has no memory yet. Do not reread it after think or create a second policy memory.
  const memoryProvider: AiMemoryProvider = {
    get: owner => provider?.get(owner),
    set(owner, value) {
      if (owner === request.playerId) memory = value;
      provider?.set?.(owner, value);
    },
  };
  const commands = planAiOwnerCommandEntries(snapshot, request, { ...plannerOptions, memoryProvider, observeBootstrapPlan(context, entries) {
    options.observeBootstrapPlan?.(context, entries);
    memory = context.memory;
    const healing = entries.flatMap(entry => ['mobileCare', 'frontRecovery'].includes(entry.scriptId ?? '') && 'unitIds' in entry.command
      ? entry.command.unitIds.map(unitId => ({ unitId, executor: entry.scriptId! })) : []);
    strategy = buildStrategyPlanTrace(snapshot, request.playerId, context, previous?.strategy, families, { healing });
  } });
  const observedMemory = memory ?? createAiPolicyMemory();
  deathLedger?.recordThink(snapshot, request.playerId, observedMemory);
  const baseTrace = buildAiPlanTrace(snapshot, request.playerId, observedMemory,
    request.version ?? options.version ?? DEFAULT_AI_PLANNER_VERSION, previous);
  const trace = strategy ? { ...baseTrace, strategy } : baseTrace;
  return { commands, trace: deathLedger ? deathLedger.withPlanTrace(trace, trace.previousTick ?? -1) : trace };
}
