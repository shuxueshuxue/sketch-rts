import { runBenchmarkMatch } from '../../sdk/benchmark/core';
import { createAiGameCommandPlanner } from '../game-runner';
import { bootstrapGame, type BootstrapMatch } from './benchmark';
import { createUnitRosterStatsTracker } from '../benchmark/unit-roster-stats';
import type { BenchmarkTracker } from '../../sdk/benchmark/core';
import type { AiGameAgent } from '../game-runner';

export function runBenchmarkParallelMatch(match: BootstrapMatch) {
  return runBenchmarkMatch({...match,game:bootstrapGame(match),commandPlanner:createAiGameCommandPlanner()},[createUnitRosterStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>]);
}
