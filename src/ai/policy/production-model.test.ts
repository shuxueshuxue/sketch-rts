import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { duplicateCoreProductionReserveKind, productionBuildingNeedKind, shouldFinishCoreArmyBeforeMoreProduction } from "./production-model";

describe("AI production model", () => {
  it("names the next missing production building from the playbook", () => {
    const game = sketchScene("production-model-missing-chain")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .build()
      .createGame();

    expect(productionBuildingNeedKind(snapshotGame(game), "v2", { version: "v2" })).toBe("barracks");
  });

  it("reserves a duplicate core production building after the combat chain is complete", () => {
    const scene = sketchScene("production-model-duplicate-core")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .player("v1b", { team: "south" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1400, 650)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 620)
      .building("v2", "stables", 780, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800);
    for (let i = 0; i < 10; i += 1) scene.worker("v2", 520 + i * 10, 540);
    for (let i = 0; i < 6; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 700 + i * 20, 760);
    const game = scene.build().createGame();

    expect(duplicateCoreProductionReserveKind(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe("barracks");
  });

  it("keeps v2 on two production buildings at five one-base combat units", () => {
    const scene = sketchScene("production-model-v2-third-production")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 620);
    for (let i = 0; i < 5; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 700 + i * 20, 760);
    const game = scene.build().createGame();

    expect(productionBuildingNeedKind(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBeUndefined();
  });

  it("lets v2 commit to the third production building at seven combat units", () => {
    const scene = sketchScene("production-model-v2-third-production-seven")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 620);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 700 + i * 20, 760);
    const game = scene.build().createGame();

    expect(productionBuildingNeedKind(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe("stables");
  });

  it("pauses more production shells until the first core army exists under 1v2 pressure", () => {
    const scene = sketchScene("production-model-core-army-first")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1a", { team: "south" })
      .player("v1b", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 10, 540);
    const game = scene.build().createGame();

    expect(shouldFinishCoreArmyBeforeMoreProduction(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBe(true);
  });
});
