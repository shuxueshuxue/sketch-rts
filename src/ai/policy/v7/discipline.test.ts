import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import type { AiPolicyMemory } from "../../memory";
import { createAiPolicyMemory } from "../../memory";
import { planV7Skirmish } from "./discipline";

const V7 = { version: "v2", requestedVersion: "v7" } as const;

// A wounded footman and a wounded summoner beside an enemy footman, far from V7's hall: the shared skirmish script pulls
// both home.
function wounded(name: string, mode: NonNullable<NonNullable<AiPolicyMemory["v6"]>["general"]>["mode"]) {
  const game = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v7", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .townHall("v7", 400, 400)
    .townHall("v3", 3_400, 3_300)
    .unit("v7", "footman", 1_500, 1_500, { id: "footman", hp: 30 })
    .unit("v7", "summoner", 1_450, 1_460, { id: "summoner", hp: 20 })
    .unit("v3", "footman", 1_560, 1_520, { id: "enemy" })
    .build()
    .createGame();
  const memory = createAiPolicyMemory();
  memory.v6 = { general: { mode, target: { x: 1_400, y: 1_400 } } };
  const ordered = planV7Skirmish(snapshotGame(game), "v7", { ...V7, teams: game.teams, memory }).flatMap((command) => ("unitIds" in command ? command.unitIds : []));
  return new Set(ordered);
}

describe("V7 discipline", () => {
  it("leaves the front to the general while it holds ground, and the casters to the skirmish script", () => {
    const attacking = wounded("v7-skirmish-attack", "attack");
    expect(attacking.has("footman")).toBe(true);
    const defending = wounded("v7-skirmish-defend", "defend");
    expect(defending.has("footman")).toBe(false);
    expect(defending.has("summoner")).toBe(attacking.has("summoner"));
  });
});
