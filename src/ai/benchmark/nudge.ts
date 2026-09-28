import type { SdkGameCommandPlanner } from "../../sdk/game-runner";
import type { PlayerId } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";

// @@@gauntlet-nudge - A game's single deterministic trajectory is a noisy and biased reading of how good the AIs are: the
// sim is chaotic, so a nudge as small as one worker stopping once re-rolls about half the games (the 2026-09-29
// perturbation ensemble). A nudged bench plays every game K times; replay k tells one worker to stop, once, at the first
// think of one player at or after the nudge tick. The player cycles through the gauntlet's versions (for V8: v8, v5, v7)
// so the nudge is not always against the subject, and the worker is the (floor(k / 3) mod n)-th of that player's workers
// by id. The stop is appended after the planner's own commands, so no AI memory records it; each replay is a fresh game
// with its own planner. This is the rule of the ensemble's perturb8.ts, which the nudged bench reproduces game for game.

export type GauntletNudge = {
  // The replay's number, 0..K-1.
  k: number;
  // The first tick at which the nudge may land.
  atTick: number;
  // The version label (its first word, as "v5 ember" -> "v5") of the player nudged.
  who: string;
};

// The version nudged in replay k: the versions in order, cycling.
export function nudgedVersion(versions: readonly string[], k: number): string {
  return versions[k % versions.length]!;
}

export function nudgedPlanner(planner: SdkGameCommandPlanner<AiGameAgent>, agents: Record<PlayerId, AiGameAgent>, nudge: GauntletNudge): SdkGameCommandPlanner<AiGameAgent> {
  const target = Object.keys(agents).find((owner) => (agents[owner]!.versionLabel ?? owner).split(" ")[0] === nudge.who);
  let done = false;
  return (context) => {
    const entries = planner(context);
    if (done || context.owner !== target || context.snapshot.tick < nudge.atTick) return entries;
    done = true;
    const workers = context.snapshot.units
      .filter((unit) => unit.owner === target && unit.kind === "worker")
      .map((unit) => unit.id)
      .sort();
    if (workers.length === 0) return entries;
    const unitId = workers[Math.floor(nudge.k / 3) % workers.length]!;
    return [...entries, { playerId: context.owner, source: context.source, scriptId: "nudge", command: { type: "stop", unitIds: [unitId] } }];
  };
}
