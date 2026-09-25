import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { snapshotGame } from "../../shared/sim";
import type { AiGameAgent } from "../game-runner";
import { createAiPolicyMemory } from "../memory";
import { v6Doctrine } from "../policy/v6/select";

export type V6DoctrineStats = { profileId: string; strategyId: string } | null;

// Which personality and strategy V6 drew this game. The draw depends only on the opening board, so the tracker makes the
// same draw from the first snapshot rather than reaching into the planner's memory.
export function createV6DoctrineTracker(): BenchmarkTracker<AiGameAgent, V6DoctrineStats, V6DoctrineStats> {
  return {
    id: "v6Doctrine",
    create: ({ game, match }) => {
      const agent = match.agents.v6;
      if (!agent || (agent.policyVersion ?? agent.version) !== "v6") return null;
      const teams = Object.fromEntries(Object.entries(match.agents).map(([owner, candidate]) => [owner, candidate.team ?? owner]));
      const { profile, strategy } = v6Doctrine(snapshotGame(game), "v6", { version: "v2", requestedVersion: "v6", teams, memory: createAiPolicyMemory() });
      return { profileId: profile.id, strategyId: strategy.id };
    },
    finish: (state) => state,
  };
}
