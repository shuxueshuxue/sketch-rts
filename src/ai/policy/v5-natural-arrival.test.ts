import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory, planPresetAiCommandEntries } from "../policy";

function naturalScene(mercenaries: { x: number; y: number }) {
  let scene = sketchScene(`v5-natural-arrival-${mercenaries.x}-${mercenaries.y}`)
    .map("openClaims")
    .replaceDefaults()
    .player("v5", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v4", { team: "south", race: "grove" })
    .townHall("v5", 500, 500, { id: "v5-main" })
    .building("v5", "barracks", 620, 620)
    .building("v5", "archeryRange", 440, 640)
    .building("v5", "stables", 380, 760)
    .worker("v5", 520, 540)
    .unit("v5", "footman", 760, 640)
    .unit("v5", "footman", 790, 670)
    .unit("v5", "footman", 730, 660)
    .unit("v5", "lancer", 740, 610)
    .unit("v5", "archer", 730, 690)
    .unit("neutral", "mossGnawer", 1130, 655)
    .unit("neutral", "wildling", 1170, 690)
    .townHall("v3", 3_300, 3_300)
    .townHall("v4", 3_300, 3_800)
    .goldMine("v5-main-mine", 560, 540, 4000)
    .goldMine("v5-guarded-natural", 1120, 650, 4000)
    .goldMine("v3-main-mine", 3_340, 3_300, 4000)
    .goldMine("v4-main-mine", 3_340, 3_800, 4000);
  for (let index = 0; index < 4; index += 1) scene = scene.unit("v4", "mercenary", mercenaries.x + index * 30, mercenaries.y);
  const game = scene.build().createGame();
  // A broke economy keeps farm, tower and well builds from taking this think, so the expansion job is the one deciding.
  game.players.v5!.gold = 0;
  return game;
}

function naturalClear(game: ReturnType<typeof naturalScene>) {
  return planPresetAiCommandEntries(snapshotGame(game), "v5", { version: "v5", teams: game.teams, memory: createAiPolicyMemory() }).find(
    (entry) => entry.scriptId === "expansion" && entry.command.type === "attackMove",
  );
}

describe("v5 guarded natural against incoming armies", () => {
  it("clears its natural while a stronger mercenary ball is too far away to reach it before the clear is done", () => {
    // About 2100 from the main, as V4-TR's mercenaries idling at their own camp are, but half a minute from the natural.
    expect(naturalClear(naturalScene({ x: 500, y: 2_600 }))).toBeDefined();
  });

  it("does not start the clear when that ball would arrive in the middle of it", () => {
    expect(naturalClear(naturalScene({ x: 1_500, y: 1_300 }))).toBeUndefined();
  });
});
