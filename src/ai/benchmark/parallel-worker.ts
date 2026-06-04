import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { AI_SCRIPT_LIBRARY } from "../policy";
import { runBenchmarkMatch, type BenchmarkMatchInput, type BenchmarkMatchReport, type BenchmarkTracker } from "../../sdk/benchmark/core";
import type { PlayerId } from "../../shared/types";
import { createArmyBalanceStatsTracker } from "./army-balance-stats";
import { createAiCommandStatsTracker } from "./command-stats";
import { createExpansionClaimTimelineTracker } from "./expansion-claim-timeline";
import { createWoundedMoonWellStatsTracker } from "./wounded-moonwell-stats";

type SerializedAiGameAgent = Omit<AiGameAgent, "scripts"> & {
  scriptIds?: string[];
};

const SCRIPT_BY_ID = Object.fromEntries(Object.values(AI_SCRIPT_LIBRARY).map((script) => [script.id, script]));

export function runBenchmarkParallelMatch(match: BenchmarkMatchInput<SerializedAiGameAgent>): BenchmarkMatchReport {
  const trackers = [
    createAiCommandStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createWoundedMoonWellStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createArmyBalanceStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createExpansionClaimTimelineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
  ];
  return runBenchmarkMatch({ ...match, agents: reviveAgents(match.agents), commandPlanner: createAiGameCommandPlanner() }, trackers);
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
