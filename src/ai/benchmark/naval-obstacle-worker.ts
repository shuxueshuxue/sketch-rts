import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBenchmarkMatch } from '../../sdk/benchmark/core';
import type { AiPolicyMemory } from '../memory';
import { navalObservedPlanner } from './naval-room-worker';
import { createNavalMetricsTracker } from './naval-metrics';
import { createNavalObstacleTracker } from './naval-obstacle-metrics';
import type { NavalRoomMatch } from './naval-room';

export function runBenchmarkParallelMatch(match: NavalRoomMatch) {
  const memories: Record<string, AiPolicyMemory> = {};
  const report = runBenchmarkMatch({ ...match, commandPlanner: navalObservedPlanner(memories) }, [
    createNavalMetricsTracker({ memory: owner => memories[owner], sampleSeconds: match.naval.sampleSeconds }) as never,
    createNavalObstacleTracker() as never,
  ]);
  if (match.naval.outDir) {
    mkdirSync(match.naval.outDir, { recursive: true });
    writeFileSync(join(match.naval.outDir, `${match.name.replaceAll(' ', '_')}.json`), JSON.stringify({ naval: match.naval, ...report }));
  }
  return report;
}
