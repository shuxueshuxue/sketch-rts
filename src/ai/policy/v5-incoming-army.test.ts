import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory, planPresetAiCommandEntries } from "../policy";

function guardedNaturalScene(withIncomingArmy: boolean) {
  let scene = sketchScene(`v5-guarded-natural-incoming-${withIncomingArmy}`)
    .map("openClaims")
    .replaceDefaults()
    .player("v5", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v4", { team: "south", race: "grove" })
    .townHall("v5", 500, 500, { id: "v5-main" })
    .building("v5", "barracks", 620, 620)
    .building("v5", "archeryRange", 700, 560)
    .building("v5", "farm", 560, 700)
    .building("v5", "farm", 610, 735)
    .worker("v5", 520, 540)
    .worker("v5", 540, 560)
    .worker("v5", 560, 540)
    .worker("v5", 580, 560)
    .worker("v5", 600, 540)
    .unit("v5", "footman", 760, 640)
    .unit("v5", "footman", 790, 670)
    .unit("v5", "lancer", 740, 610)
    .unit("v5", "archer", 730, 690)
    .unit("neutral", "mossGnawer", 1130, 655)
    .unit("neutral", "wildling", 1170, 690)
    .townHall("v3", 3300, 3300)
    .townHall("v4", 3300, 3800)
    .goldMine("v5-main-mine", 560, 540, 4000)
    .goldMine("v5-guarded-natural", 1120, 650, 4000)
    .goldMine("v3-main-mine", 3340, 3300, 4000)
    .goldMine("v4-main-mine", 3340, 3800, 4000);
  if (withIncomingArmy) {
    for (let index = 0; index < 4; index += 1) scene = scene.unit("v3", "footman", 1900 + index * 40, 1500).unit("v4", "archer", 1900 + index * 40, 1560);
  }
  return scene.build().createGame();
}

function expansionClearCommand(game: ReturnType<typeof guardedNaturalScene>) {
  return planPresetAiCommandEntries(snapshotGame(game), "v5", { version: "v5", teams: game.teams, memory: createAiPolicyMemory() }).find(
    (entry) => entry.scriptId === "expansion" && entry.command.type === "attackMove",
  );
}

describe("v5 incoming army discipline", () => {
  it("clears a guarded natural when no enemy army is closing on the main", () => {
    expect(expansionClearCommand(guardedNaturalScene(false))).toBeDefined();
  });

  it("does not spend its army on a guarded natural while an outweighing enemy army closes on the main", () => {
    expect(expansionClearCommand(guardedNaturalScene(true))).toBeUndefined();
  });
});
