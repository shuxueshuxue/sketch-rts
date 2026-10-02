import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { buildPlacementCommand } from "./build-placement-controls";

const workerOf = (game: ReturnType<typeof createGame>, owner: string) => game.units.find((unit) => unit.owner === owner && unit.kind === "worker")!;
const hallOf = (game: ReturnType<typeof createGame>, owner: string) => game.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;

describe("build placement controls", () => {
  it("creates a build command for a clear worker placement", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = workerOf(game, "player");
    expect(buildPlacementCommand(snapshotGame(game), { workerId: worker.id, buildingKind: "farm" }, { x: 900, y: 900 }, "player")).toEqual({
      command: { type: "build", unitId: worker.id, buildingKind: "farm", x: 900, y: 900 },
    });
  });

  it("checks the placement as the local player, whatever the seat (the second seat plays as enemy)", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = workerOf(game, "enemy");
    const hall = hallOf(game, "enemy");
    const point = { x: hall.x - 300, y: hall.y };
    expect(buildPlacementCommand(snapshotGame(game), { workerId: worker.id, buildingKind: "farm" }, point, "enemy")).toEqual({
      command: { type: "build", unitId: worker.id, buildingKind: "farm", ...point },
    });
  });

  it("says why a placement is refused: a building in the way, gold short, or the worker gone", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = workerOf(game, "player");
    const hall = hallOf(game, "player");
    const farm = { workerId: worker.id, buildingKind: "farm" as const };
    expect(buildPlacementCommand(snapshotGame(game), farm, { x: hall.x + 10, y: hall.y }, "player")).toEqual({ refusal: { reason: "tooClose", blocker: "townHall" } });

    game.players.player!.gold = 10;
    expect(buildPlacementCommand(snapshotGame(game), farm, { x: 900, y: 900 }, "player")).toEqual({ refusal: { reason: "gold", cost: 120 } });

    expect(buildPlacementCommand(snapshotGame(game), { ...farm, workerId: "gone" }, { x: 900, y: 900 }, "player")).toEqual({ refusal: { reason: "worker" } });
  });

  it("names the ground: no building on a forest, and a shipyard only on a shore", () => {
    const game = createGame("greystonePass", { players: ["player", "enemy"], aiPlayers: [] });
    const snapshot = snapshotGame(game);
    const terrain = snapshot.map.terrain!;
    const worker = workerOf(game, "player");
    // A forest cell well inside the map, away from every building.
    const index = [...terrain.cells].findIndex((char, i) => char === "T" && i % terrain.cols > 4 && Math.floor(i / terrain.cols) > 4 && i % terrain.cols < terrain.cols - 5);
    const forest = { x: ((index % terrain.cols) + 0.5) * terrain.cell, y: (Math.floor(index / terrain.cols) + 0.5) * terrain.cell };
    expect(buildPlacementCommand(snapshot, { workerId: worker.id, buildingKind: "farm" }, forest, "player")).toEqual({ refusal: { reason: "ground" } });
    expect(buildPlacementCommand(snapshot, { workerId: worker.id, buildingKind: "shipyard" }, forest, "player")).toEqual({ refusal: { reason: "shore" } });
  });
});
