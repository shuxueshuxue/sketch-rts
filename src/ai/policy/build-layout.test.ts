import { describe, expect, it } from "vitest";
import { buildingPlacementBlocker } from "../../shared/build-placement";
import { BUILDING_DEFS } from "../../shared/catalog";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { defensiveRallyPoint, healingWellPointFor, towerPointFor } from "./build-layout";
import { distance } from "./spatial";

describe("AI build layout helpers", () => {
  it("places a defensive tower on the protected side of a threatened base", () => {
    const game = sketchScene("build-layout-threat-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500, { id: "main-hall" })
      .build()
      .createGame();
    const base = game.buildings.find((building) => building.id === "main-hall");
    if (!base) throw new Error("missing main hall");

    expect(towerPointFor(snapshotGame(game), "v2", base, { x: 800, y: 500 })).toEqual({ x: 350, y: 500 });
  });

  it("moves a defensive tower point away from occupied building space", () => {
    const game = sketchScene("build-layout-occupied-threat-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500, { id: "main-hall" })
      .building("v2", "farm", 350, 500)
      .build()
      .createGame();
    const base = game.buildings.find((building) => building.id === "main-hall");
    const farm = game.buildings.find((building) => building.kind === "farm");
    if (!base || !farm) throw new Error("missing build layout fixture");

    const point = towerPointFor(snapshotGame(game), "v2", base, { x: 800, y: 500 });
    const distance = Math.hypot(point.x - farm.x, point.y - farm.y);

    expect(distance).toBeGreaterThanOrEqual(BUILDING_DEFS.defenseTower.radius + BUILDING_DEFS.farm.radius + 4);
  });

  it("places moon wells behind the main base by owner side", () => {
    const game = sketchScene("build-layout-healing-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .build()
      .createGame();

    expect(healingWellPointFor(snapshotGame(game), "v2", { x: 500, y: 500 })).toEqual({ x: 414, y: 618 });
  });

  it("spaces extra moon wells instead of stacking them on the first well", () => {
    const game = sketchScene("build-layout-second-healing-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "moonWell", 414, 618)
      .build()
      .createGame();

    expect(healingWellPointFor(snapshotGame(game), "v2", { x: 500, y: 500 })).not.toEqual({ x: 414, y: 618 });
  });

  it("keeps moon well fallback placement legal when the main base ring is crowded", () => {
    const scene = sketchScene("build-layout-crowded-healing-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500);
    const blockerPoints: Array<readonly [number, number]> = [
      [414, 618],
      [350, 676],
      [350, 556],
      [466, 688],
      [466, 536],
      [500, 428],
      [500, 572],
      [428, 500],
      [572, 500],
      [428, 428],
      [572, 428],
      [428, 572],
      [572, 572],
      [500, 360],
      [500, 640],
      [360, 500],
      [640, 500],
      [360, 360],
      [640, 360],
      [360, 640],
      [640, 640],
    ];
    for (const [x, y] of blockerPoints) {
      scene.building("v2", "farm", x, y);
    }
    const game = scene.build().createGame();
    const snapshot = snapshotGame(game);
    const point = healingWellPointFor(snapshot, "v2", { x: 500, y: 500 });

    expect(buildingPlacementBlocker(snapshot, "moonWell", point)).toBeUndefined();
  });

  it("places a moon well where a nearby wounded recovery cluster can actually be healed", () => {
    const game = sketchScene("build-layout-healing-well-wounded-cluster")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 450, 235, { hp: 42, order: { type: "idle" } })
      .unit("v2", "lancer", 500, 250, { hp: 35, order: { type: "move", x: 500, y: 240 } })
      .unit("v2", "footman", 540, 245, { hp: 46, order: { type: "idle" } })
      .build()
      .createGame();

    const point = healingWellPointFor(snapshotGame(game), "v2", { x: 500, y: 500 });

    expect(distance(point, { x: 500, y: 245 })).toBeLessThanOrEqual(BUILDING_DEFS.moonWell.attackRange);
  });

  it("keeps the first moon well near the main instead of following a far forward wounded cluster", () => {
    const game = sketchScene("build-layout-first-healing-well-main-anchor")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 492, 2048)
      .unit("v2", "footman", 1190, 2130, { hp: 42, order: { type: "idle" } })
      .unit("v2", "lancer", 1230, 2170, { hp: 35, order: { type: "move", x: 1230, y: 2170 } })
      .build()
      .createGame();

    const point = healingWellPointFor(snapshotGame(game), "v2", { x: 492, y: 2048 });

    expect(point).toEqual({ x: 406, y: 2166 });
  });

  it("does not treat attack-moving wounded units as a settled moon well recovery cluster", () => {
    const game = sketchScene("build-layout-healing-well-ignores-attack-move-cluster")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 450, 235, { hp: 42, order: { type: "attackMove", x: 500, y: 500 } })
      .unit("v2", "lancer", 500, 250, { hp: 35, order: { type: "attackMove", x: 500, y: 500 } })
      .unit("v2", "footman", 540, 245, { hp: 46, order: { type: "attackMove", x: 500, y: 500 } })
      .build()
      .createGame();

    const point = healingWellPointFor(snapshotGame(game), "v2", { x: 500, y: 500 });

    expect(distance(point, { x: 500, y: 245 })).toBeGreaterThan(BUILDING_DEFS.moonWell.attackRange);
  });

  it("rallies between the main hall and a nearby completed tower", () => {
    const game = sketchScene("build-layout-defensive-rally")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .tower("v2", 650, 500)
      .build()
      .createGame();

    expect(defensiveRallyPoint(snapshotGame(game), "v2")).toEqual({ x: 575, y: 500 });
  });
});
