import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory, planPresetAiCommandEntries } from "../policy";

function towerCreepScene(options: { towerComplete: boolean; builder: boolean }) {
  let scene = sketchScene(`v5-tower-breaker-${options.towerComplete}-${options.builder}`)
    .map("openClaims")
    .replaceDefaults()
    .player("v5", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v4", { team: "south", race: "grove" })
    .townHall("v5", 500, 500, { id: "v5-main" })
    .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
    .worker("v5", 520, 540)
    .unit("v5", "footman", 700, 700)
    .unit("v5", "footman", 730, 690)
    .unit("v5", "lancer", 690, 740)
    .unit("v5", "archer", 660, 720)
    .building("v4", "defenseTower", 1_150, 800, { id: "v4-creep-tower", complete: options.towerComplete })
    .townHall("v3", 3_300, 3_300)
    .townHall("v4", 3_300, 3_800)
    .goldMine("v5-main-mine", 560, 540, 4000)
    .goldMine("v3-main-mine", 3_340, 3_300, 4000)
    .goldMine("v4-main-mine", 3_340, 3_800, 4000);
  if (options.builder) scene = scene.worker("v4", 1_150, 850);
  return scene.build().createGame();
}

function towerBreakerCommand(game: ReturnType<typeof towerCreepScene>) {
  return planPresetAiCommandEntries(snapshotGame(game), "v5", { version: "v5", teams: game.teams, memory: createAiPolicyMemory() }).find((entry) => entry.scriptId === "towerBreaker")?.command;
}

describe("v5 tower breaker", () => {
  it("sends a local group to kill an enemy tower creeping next to its base", () => {
    const command = towerBreakerCommand(towerCreepScene({ towerComplete: true, builder: false }));
    expect(command).toMatchObject({ type: "attack", targetId: "v4-creep-tower" });
  });

  it("kills the worker raising a tower site next to its base before the tower can shoot", () => {
    const game = towerCreepScene({ towerComplete: false, builder: true });
    const builder = game.units.find((unit) => unit.owner === "v4" && unit.kind === "worker")!;
    const command = towerBreakerCommand(game);
    expect(command).toMatchObject({ type: "attack", targetId: builder.id });
  });
});
