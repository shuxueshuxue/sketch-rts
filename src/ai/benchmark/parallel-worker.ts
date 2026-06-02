import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { AI_SCRIPT_LIBRARY } from "../policy";
import { runBenchmarkMatch, type BenchmarkMatchInput, type BenchmarkMatchReport } from "../../sdk/benchmark/core";
import type { PlayerId } from "../../shared/types";

type SerializedAiGameAgent = Omit<AiGameAgent, "scripts"> & {
  scriptIds?: string[];
};

const SCRIPT_BY_ID = Object.fromEntries(Object.values(AI_SCRIPT_LIBRARY).map((script) => [script.id, script]));

export function runBenchmarkParallelMatch(match: BenchmarkMatchInput<SerializedAiGameAgent>): BenchmarkMatchReport {
  return runBenchmarkMatch({ ...match, agents: reviveAgents(match.agents), commandPlanner: createAiGameCommandPlanner() });
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
