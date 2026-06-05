import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { buildPlacementCommand } from "./build-placement-controls";

describe("build placement controls", () => {
  it("creates a build command for a clear worker placement", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();

    expect(buildPlacementCommand(snapshotGame(game), { workerId: worker!.id, buildingKind: "farm" }, { x: 900, y: 900 })).toEqual({
      command: { type: "build", unitId: worker!.id, buildingKind: "farm", x: 900, y: 900 },
    });
  });

  it("returns a placement error instead of a command for blocked building locations", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(worker).toBeDefined();
    expect(townHall).toBeDefined();

    expect(buildPlacementCommand(snapshotGame(game), { workerId: worker!.id, buildingKind: "farm" }, { x: townHall!.x + 10, y: townHall!.y })).toEqual({
      error: "farm placement is too close to townHall",
    });
  });
});
