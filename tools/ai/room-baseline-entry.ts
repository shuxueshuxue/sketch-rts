// This wrapper is bundled with the pinned Git tree, never the working tree's AI.
import { createAiMemoryProvider, planAiOwnerCommandEntries } from './src/ai/planner-context';
import type { AiOwnerPlannerRequest } from './src/ai/planner-context';
import type { AiPolicyMemory } from './src/ai/memory';
import type { GameSnapshot } from './src/shared/types';

export const sourceCommit = '646cf9a0513459d16e6b12007d4945148bb29651';
const families = ['v9_archer', 'v9_summoner', 'v9_knight'];

export function createRoomPlanner(initial: Record<string, AiPolicyMemory> = {}) {
  const memories = structuredClone(initial);
  const memoryProvider = createAiMemoryProvider(memories);
  return {
    plan(snapshot: GameSnapshot, request: AiOwnerPlannerRequest) {
      if (!request.version || !families.includes(request.version) || request.scripts || request.scriptIds)
        throw new Error('Frozen room planner requires an original room family without script overrides');
      return planAiOwnerCommandEntries(snapshot, request, { memoryProvider, ...(snapshot.teams ? { teams: snapshot.teams } : {}) });
    },
    memory(owner: string) { return structuredClone(memories[owner]); },
  };
}
