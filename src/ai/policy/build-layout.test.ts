import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { defensiveRallyPoint, healingWellPointFor, towerPointFor } from "./build-layout";

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
