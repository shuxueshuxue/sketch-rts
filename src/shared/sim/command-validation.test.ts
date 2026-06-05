import { describe, expect, it } from "vitest";
import { createBuilding } from "../map";
import { createGame, snapshotGame } from "../sim";
import { commandValidationError } from "./command-validation";

describe("command admission validation", () => {
  it("rejects heal on enemies and curse on allies at admission", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const priest = game.spawnUnit("player", "priest", 900, 900);
    const witch = game.spawnUnit("player", "witch", 930, 900);
    const ally = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const enemy = game.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    expect(ally).toBeDefined();
    expect(enemy).toBeDefined();

    expect(commandValidationError(snapshotGame(game), "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: enemy!.id })).toBe("Heal requires an allied unit target");
    expect(commandValidationError(snapshotGame(game), "player", { type: "cast", unitId: witch.id, ability: "curse", targetId: ally!.id })).toBe("Curse requires an enemy unit target");
  });

  it("allows heal on a different owner when room teams mark that owner as allied", () => {
    const game = createGame("bareDuel", { aiPlayers: [], teams: { player: "north", enemy: "north" } });
    const priest = game.spawnUnit("player", "priest", 900, 900);
    const alliedWorker = game.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    expect(alliedWorker).toBeDefined();

    expect(commandValidationError(snapshotGame(game), "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: alliedWorker!.id })).toBeUndefined();
  });

  it("rejects rally commands for buildings that do not train units", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const farm = createBuilding("player-rallyless-farm", "player", "farm", 900, 900, true);
    game.buildings.push(farm);

    expect(commandValidationError(snapshotGame(game), "player", { type: "setRally", buildingIds: [farm.id], x: 960, y: 900, target: { type: "point" } })).toBe("farm has no training rally point");
  });
});
