import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { snapshotGame } from "../../shared/sim";
import type { AiGameAgent } from "../game-runner";
import { createAiPolicyMemory } from "../memory";
import { v6Doctrine } from "../policy/v6/select";

export type V6DoctrineStats = { profileId: string; strategyId: string } | null;

// Which personality and strategy V6 (or V7, which draws from the same tables) drew this game. The draw depends only on the
// opening board, so the tracker makes the same draw from the first snapshot rather than reaching into the planner's memory.
export function createV6DoctrineTracker(): BenchmarkTracker<AiGameAgent, V6DoctrineStats, V6DoctrineStats> {
  return doctrineTracker("v6Doctrine", "v6");
}

export function createV7DoctrineTracker(): BenchmarkTracker<AiGameAgent, V6DoctrineStats, V6DoctrineStats> {
  return doctrineTracker("v7Doctrine", "v7");
}

function doctrineTracker(id: string, version: "v6" | "v7"): BenchmarkTracker<AiGameAgent, V6DoctrineStats, V6DoctrineStats> {
  return {
    id,
    create: ({ game, match }) => {
      const agent = match.agents[version];
      if (!agent || (agent.policyVersion ?? agent.version) !== version) return null;
      const teams = Object.fromEntries(Object.entries(match.agents).map(([owner, candidate]) => [owner, candidate.team ?? owner]));
      const { profile, strategy } = v6Doctrine(snapshotGame(game), version, { version: "v2", requestedVersion: version, teams, memory: createAiPolicyMemory() });
      return { profileId: profile.id, strategyId: strategy.id };
    },
    finish: (state) => state,
  };
}
