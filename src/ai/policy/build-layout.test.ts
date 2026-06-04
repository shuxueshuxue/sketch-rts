import { describe, expect, it } from "vitest";
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
