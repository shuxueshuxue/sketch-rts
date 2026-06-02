import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { enemyPressure, nearestEnemyUnit, nearestOpponentThreat } from "./threats";

describe("AI threat lookup helpers", () => {
  it("detects nearby enemy unit pressure through team ownership", () => {
    const game = sketchScene("threat-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("ally", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("ally", "footman", 540, 500)
      .unit("v1", "footman", 600, 500)
      .build()
      .createGame();

    expect(enemyPressure(snapshotGame(game), "v2", { x: 500, y: 500 }, 140, { teams: game.teams })).toBe(true);
  });

  it("returns the nearest opponent unit or building threat", () => {
    const game = sketchScene("threat-nearest-opponent")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v1", "footman", 700, 500, { id: "enemy-footman" })
      .tower("v1", 620, 500, { id: "enemy-tower" })
      .build()
      .createGame();

    expect(nearestOpponentThreat(snapshotGame(game), "v2", { x: 500, y: 500 }, 260, { teams: game.teams })).toMatchObject({ id: "enemy-tower" });
  });

  it("can select neutral units as immediate attack targets", () => {
    const game = sketchScene("threat-nearest-neutral")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("neutral", "wildling", 560, 500, { id: "near-neutral" })
      .build()
      .createGame();

    expect(nearestEnemyUnit(snapshotGame(game), "v2", { x: 500, y: 500 }, 100, {})).toMatchObject({ id: "near-neutral" });
  });
});
