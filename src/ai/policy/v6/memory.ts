import type { V6PolicyMemory } from "../../memory";
import type { AiPolicyContext } from "../types";

export function v6Memory(options: AiPolicyContext): V6PolicyMemory {
  return (options.memory.v6 ??= {});
}

// Plays are counted once per start, so a game's record reads like a replay summary: "raid:creepPunish x2, towerRush x1".
export function recordPlay(memory: V6PolicyMemory, play: string) {
  const plays = (memory.plays ??= {});
  plays[play] = (plays[play] ?? 0) + 1;
}
