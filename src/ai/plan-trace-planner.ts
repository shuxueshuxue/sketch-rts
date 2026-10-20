import { DEFAULT_AI_PLANNER_VERSION, planAiOwnerCommandEntries, type AiMemoryProvider, type AiOwnerPlannerOptions, type AiOwnerPlannerRequest } from './planner-context';
import { createAiPolicyMemory } from './memory';
import { buildAiPlanTrace, type AiPlanTrace } from './plan-trace';
import type { GameSnapshot } from '../shared/types';

/** Opt-in observation at the existing think boundary; executes the ordinary planner exactly once.
 * The caller retains previous traces outside AI memory. No runtime/network/UI integration yet.
 */
export function planAiOwnerCommandEntriesWithTrace<Source extends string = string>(snapshot: GameSnapshot,
  request: AiOwnerPlannerRequest<Source>, options: AiOwnerPlannerOptions = {}, previous?: AiPlanTrace) {
  let memory = request.memory ?? options.memory;
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
  const commands = planAiOwnerCommandEntries(snapshot, request, { ...options, memoryProvider });
  const trace = buildAiPlanTrace(snapshot, request.playerId, memory ?? createAiPolicyMemory(),
    request.version ?? options.version ?? DEFAULT_AI_PLANNER_VERSION, previous);
  return { commands, trace };
}
