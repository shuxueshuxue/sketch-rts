import { describe, expect, it } from "vitest";
import { createBuilding } from "../map";
import { createGame, snapshotGame } from "../sim";
import { commandValidationError } from "./command-validation";

describe("command admission validation", () => {
  it("rejects rally commands for buildings that do not train units", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const farm = createBuilding("player-rallyless-farm", "player", "farm", 900, 900, true);
    game.buildings.push(farm);

    expect(commandValidationError(snapshotGame(game), "player", { type: "setRally", buildingIds: [farm.id], x: 960, y: 900, target: { type: "point" } })).toBe("farm has no training rally point");
  });
});
