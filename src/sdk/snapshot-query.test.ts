import { describe, expect, it } from "vitest";
import { snapshotGame } from "../shared/sim";
import { createSnapshotQuery } from "./snapshot-query";
import { sketchScene } from "./scene";

describe("SDK snapshot query", () => {
  it("parses a raw snapshot into player-relative RTS views", () => {
    const scene = sketchScene("sdk-snapshot-query")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("ally", { team: "north", race: "ember" })
      .player("enemy", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .worker("v2", 520, 520, { id: "v2-worker" })
      .unit("v2", "footman", 700, 700, { id: "v2-footman" })
      .unit("ally", "archer", 760, 720, { id: "ally-archer" })
      .townHall("enemy", 3300, 3300, { id: "enemy-main" })
      .unit("enemy", "lancer", 3000, 3000, { id: "enemy-lancer" })
      .unit("neutral", "wildling", 1000, 1000, { id: "neutral-wildling" })
      .goldMine("v2-natural", 1100, 900, 4000)
      .mercenaryCamp("north-mercs", 1250, 980)
      .item("ground-scroll", "guardianScroll", 720, 720)
      .item("carried-rod", "lightningRod", 720, 720, { carrierId: "v2-footman" })
      .build();
    const game = scene.createGame();
    const query = createSnapshotQuery(snapshotGame(game), { teams: game.teams });
    const view = query.forPlayer("v2");

    expect(view.team).toBe("north");
    expect(view.own.units.map((unit) => unit.id).sort()).toEqual(["v2-footman", "v2-worker"]);
    expect(view.own.combatUnits.map((unit) => unit.id)).toEqual(["v2-footman"]);
    expect(view.allied.units.map((unit) => unit.id)).toEqual(["ally-archer"]);
    expect(view.enemy.units.map((unit) => unit.id)).toEqual(["enemy-lancer"]);
    expect(view.neutral.units.map((unit) => unit.id)).toEqual(["neutral-wildling"]);
    expect(view.own.completeBuildings.map((building) => building.id).sort()).toEqual(["v2-barracks", "v2-main"]);
    expect(view.resources.nearestTo({ x: 500, y: 500 })?.id).toBe("v2-natural");
    expect(view.mercenaryCamps.nearestTo({ x: 500, y: 500 })?.id).toBe("north-mercs");
    expect(view.items.ground.map((item) => item.id)).toEqual(["ground-scroll"]);
    expect(view.items.carried.map((item) => item.id)).toEqual(["carried-rod"]);
    expect(query.isOpponent("v2", "enemy")).toBe(true);
    expect(query.isOpponent("v2", "ally")).toBe(false);
  });

  it("exposes common AI selection primitives without ad hoc snapshot scans", () => {
    const scene = sketchScene("sdk-snapshot-ai-primitives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("ally", { team: "north", race: "ember" })
      .player("enemy", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "farm", 560, 540, { id: "v2-farm" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks", complete: false })
      .worker("v2", 520, 520, { id: "v2-worker" })
      .unit("v2", "footman", 700, 700, { id: "v2-footman" })
      .townHall("ally", 700, 500, { id: "ally-main" })
      .unit("ally", "archer", 760, 720, { id: "ally-archer" })
      .townHall("enemy", 3300, 3300, { id: "enemy-main" })
      .unit("enemy", "lancer", 3000, 3000, { id: "enemy-lancer" })
      .worker("enemy", 3015, 3000, { id: "enemy-worker" })
      .unit("neutral", "wildling", 3030, 3000, { id: "neutral-wildling" })
      .goldMine("v2-natural", 1100, 900, 4000)
      .goldMine("empty-mine", 900, 900, 0)
      .item("ground-scroll", "guardianScroll", 720, 720)
      .item("carried-rod", "lightningRod", 720, 720, { carrierId: "v2-footman" })
      .build();
    const game = scene.createGame();
    const query = createSnapshotQuery(snapshotGame(game), { teams: game.teams });

    expect(query.unitsFor("v2").map((unit) => unit.id).sort()).toEqual(["v2-footman", "v2-worker"]);
    expect(query.combatUnitsFor("v2").map((unit) => unit.id)).toEqual(["v2-footman"]);
    expect(query.buildingsFor("v2").map((building) => building.id).sort()).toEqual(["v2-barracks", "v2-farm", "v2-main"]);
    expect(query.completeBuildingsFor("v2").map((building) => building.id).sort()).toEqual(["v2-farm", "v2-main"]);
    expect(query.completeBuildingsFor("v2", "townHall").map((building) => building.id)).toEqual(["v2-main"]);
    expect(query.activePlayerIds().sort()).toEqual(["ally", "enemy", "v2"]);
    expect(query.opponentPlayerIds("v2")).toEqual(["enemy"]);
    expect(query.unitById("enemy-lancer")?.id).toBe("enemy-lancer");
    expect(query.buildingById("v2-main")?.id).toBe("v2-main");
    expect(query.targetById("v2-worker")?.id).toBe("v2-worker");
    expect(query.targetById("v2-main")?.id).toBe("v2-main");
    expect(query.itemById("ground-scroll")?.id).toBe("ground-scroll");
    expect(query.targetById("ground-scroll")?.id).toBe("ground-scroll");
    expect(query.items().map((item) => item.id).sort()).toEqual(["carried-rod", "ground-scroll"]);
    expect(query.groundItems().map((item) => item.id)).toEqual(["ground-scroll"]);
    expect(query.carriedItemsFor("v2").map((item) => item.id)).toEqual(["carried-rod"]);
    expect(query.buildings().map((building) => building.id).sort()).toEqual(["ally-main", "enemy-main", "v2-barracks", "v2-farm", "v2-main"]);
    expect(query.resources().map((resource) => resource.id).sort()).toEqual(["empty-mine", "v2-natural"]);
    expect(query.activeResources().map((resource) => resource.id)).toEqual(["v2-natural"]);
    expect(query.opponentUnitsNear("v2", { x: 3000, y: 3000 }, 80).map((unit) => unit.id).sort()).toEqual(["enemy-lancer", "enemy-worker"]);
    expect(query.hostileUnitsNear("v2", { x: 3000, y: 3000 }, 80).map((unit) => unit.id).sort()).toEqual(["enemy-lancer", "enemy-worker", "neutral-wildling"]);
    expect(query.hostileCombatUnitsFor("v2").map((unit) => unit.id).sort()).toEqual(["enemy-lancer", "neutral-wildling"]);
    expect(query.opponentBuildingsNear("v2", { x: 3300, y: 3300 }, 80).map((building) => building.id)).toEqual(["enemy-main"]);
  });
});
