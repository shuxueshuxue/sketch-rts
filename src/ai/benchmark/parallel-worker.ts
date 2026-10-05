import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { AI_SCRIPT_LIBRARY } from "../policy";
import { runBenchmarkMatch, type BenchmarkMatchInput, type BenchmarkMatchReport, type BenchmarkTracker } from "../../sdk/benchmark/core";
import type { PlayerId } from "../../shared/types";
import { createArmyBalanceStatsTracker } from "./army-balance-stats";
import { createAiCommandStatsTracker } from "./command-stats";
import { createExpansionClaimTimelineTracker } from "./expansion-claim-timeline";
import { createUnitRosterStatsTracker } from "./unit-roster-stats";
import { nudgedPlanner, type GauntletNudge } from "./nudge";
import { createV6DoctrineTracker, createV7DoctrineTracker, createV8DoctrineTracker, createV9DoctrineTracker } from "./v6-doctrine-stats";
import { createWoundedMoonWellStatsTracker } from "./wounded-moonwell-stats";

type SerializedAiGameAgent = Omit<AiGameAgent, "scripts"> & {
  scriptIds?: string[];
};

const SCRIPT_BY_ID = Object.fromEntries(Object.values(AI_SCRIPT_LIBRARY).map((script) => [script.id, script]));

// A gauntlet's nudged replay carries its nudge (see @@@gauntlet-nudge); the planner made here applies it.
export function runBenchmarkParallelMatch(match: BenchmarkMatchInput<SerializedAiGameAgent> & { nudge?: GauntletNudge }): BenchmarkMatchReport {
  const trackers = [
    createAiCommandStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createWoundedMoonWellStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createArmyBalanceStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createExpansionClaimTimelineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createUnitRosterStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createV6DoctrineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createV7DoctrineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createV8DoctrineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createV9DoctrineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
  ];
  const agents = reviveAgents(match.agents);
  const planner = createAiGameCommandPlanner();
  return runBenchmarkMatch({ ...match, agents, commandPlanner: match.nudge ? nudgedPlanner(planner, agents, match.nudge) : planner }, trackers);
}

function reviveAgents(agents: Record<PlayerId, SerializedAiGameAgent>): Record<PlayerId, AiGameAgent> {
  return Object.fromEntries(
    Object.entries(agents).map(([owner, agent]) => {
      const { scriptIds, ...rest } = agent;
      if (!scriptIds) return [owner, rest];
      return [
        owner,
        {
          ...rest,
          scripts: scriptIds.map((id) => {
            const script = SCRIPT_BY_ID[id];
            if (!script) throw new Error(`Unknown AI script id ${id}`);
            return script;
          }),
        },
      ];
    }),
  ) as Record<PlayerId, AiGameAgent>;
}
