import { runBenchmarkMatch } from '../../sdk/benchmark/core';
import { createBootstrapCommandPlanner } from '../../../scripts/bootstrap_1-planner';
import { bootstrapGame, type BootstrapMatch } from './benchmark';
import { createUnitRosterStatsTracker } from '../benchmark/unit-roster-stats';
import type { BenchmarkTracker } from '../../sdk/benchmark/core';
import type { AiGameAgent } from '../game-runner';

export async function runBenchmarkParallelMatch(match: BootstrapMatch) {
  return runBenchmarkMatch({...match,game:bootstrapGame(match),commandPlanner:await createBootstrapCommandPlanner()},[createUnitRosterStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>]);
}
