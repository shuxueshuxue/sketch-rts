import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory, planPresetAiCommandEntries } from "../policy";

function openingScene(enemyArmies: boolean) {
  let scene = sketchScene(`v5-outnumbered-opening-${enemyArmies}`)
    .map("openClaims")
    .replaceDefaults()
    .player("v5", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v4", { team: "south", race: "grove" })
    .townHall("v5", 500, 500, { id: "v5-main" })
    .building("v5", "barracks", 620, 620)
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
    .townHall("v3", 3_300, 3_300)
    .townHall("v4", 3_300, 3_800)
    .goldMine("v5-main-mine", 560, 540, 4000)
    .goldMine("v5-guarded-natural", 1120, 650, 4000)
    .goldMine("v3-main-mine", 3_340, 3_300, 4000)
    .goldMine("v4-main-mine", 3_340, 3_800, 4000);
  if (enemyArmies) {
    for (let index = 0; index < 5; index += 1) scene = scene.unit("v3", "footman", 3_200 + index * 30, 3_150).unit("v4", "footman", 3_200 + index * 30, 3_650);
  }
  return scene.build().createGame();
}

function creepCommand(game: ReturnType<typeof openingScene>) {
  return planPresetAiCommandEntries(snapshotGame(game), "v5", { version: "v5", teams: game.teams, memory: createAiPolicyMemory() }).find(
    (entry) => (entry.scriptId === "expansion" || entry.scriptId === "objectiveControl") && entry.command.type === "attackMove",
  );
}

describe("v5 outnumbered opening", () => {
  it("creeps its guarded natural when the opponents are not massing", () => {
    expect(creepCommand(openingScene(false))).toBeDefined();
  });

  it("keeps its army off creep fights while both opponents together field twice its army", () => {
    expect(creepCommand(openingScene(true))).toBeUndefined();
  });
});
