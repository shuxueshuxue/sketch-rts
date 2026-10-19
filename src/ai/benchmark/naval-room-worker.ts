import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBenchmarkMatch } from '../../sdk/benchmark/core';
import type { SdkGameCommandPlanner } from '../../sdk/game-runner';
import type { AiGameAgent } from '../game-runner';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import type { AiPolicyMemory } from '../memory';
import { createNavalMetricsTracker } from './naval-metrics';
import { createMetricTrackers } from './metrics';
import type { NavalRoomMatch } from './naval-room';

// The same request/backend as createAiGameCommandPlanner, with the memory provider
// retained by the observer. Policy executes exactly once per think.
export function navalObservedPlanner(memories: Record<string, AiPolicyMemory>): SdkGameCommandPlanner<AiGameAgent> {
  const memoryProvider = createAiMemoryProvider(memories);
  return ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot, {
    playerId: owner, source, version: agent.policyVersion ?? agent.version,
    ...(agent.scripts ? { scripts: agent.scripts } : {}),
    ...(agent.policyMode ? { policyMode: agent.policyMode } : {}),
    ...(agent.disabledBehaviors ? { disabledBehaviors: agent.disabledBehaviors } : {}),
  }, { teams, memoryProvider });
}

export function runBenchmarkParallelMatch(match: NavalRoomMatch) {
  const memories: Record<string, AiPolicyMemory> = {};
  const report = runBenchmarkMatch({ ...match, commandPlanner: navalObservedPlanner(memories) }, [
    createNavalMetricsTracker({ memory: owner => memories[owner], sampleSeconds: match.naval.sampleSeconds }) as never,
    ...createMetricTrackers(match.metrics ?? []),
  ]);
  if (match.naval.outDir) {
    mkdirSync(match.naval.outDir, { recursive: true });
    writeFileSync(join(match.naval.outDir, `${match.name.replaceAll(' ', '_')}.json`), `${JSON.stringify({ naval: match.naval, ...report })}\n`);
  }
  return report;
}
