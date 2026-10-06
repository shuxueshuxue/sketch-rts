import { restoreCargoDecks } from "../decks";
import { describe, expect, it } from "vitest";
import { resolveVariant } from "../catalog";
import { createShop } from "../shop";
import { createObstacle } from "../obstacle";
import { createUnit } from "../map";
import { shove } from "../push";
import type { Unit, UnitOrder } from "../types";
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame, GAME_SNAPSHOT_RESTORE_KEYS } from "../sim";

describe("game snapshot restoration", () => {
  it("finishes a saved cast whose ability has been removed", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const ram = createUnit("ram", "player", "siegeRam", 1000, 1000);
    ram.order = { type: "cast", ability: "ramBreach", targetId: "building-enemy-townHall" } as unknown as UnitOrder;
    game.units = [ram];
    expect(() => stepGame(game)).not.toThrow();
    expect(ram.order).toEqual({ type: "idle" });
  });

  it("migrates older rates once, including passengers and campaign variants", () => {
    const source = createGame("bareDuel", { aiPlayers: [] });
    source.units = [createUnit("fighter", "player", "footman", 1000, 1000), createUnit("ship", "player", "transport", 1000, 1500)];
    source.units[1]!.cargo = [createUnit("passenger", "player", "archer", 1000, 1500)];
    shove(source.units[0]!, 1, 0, 100);
    source.variants = { "test/champion": resolveVariant({ base: "archer", speed: 80 }) };
    restoreCargoDecks(source.units);
    const expected = snapshotGame(source);
    const older = structuredClone(expected);
    const passenger = older.units.find(unit => unit.id === "passenger")!;
    delete passenger.deck;
    older.units = older.units.filter(unit => unit !== passenger);
    older.units[1]!.cargo = [passenger];
    delete older.units[1]!.sailing;
    delete older.rateUnits;
    const oldRates = (unit: Unit) => {
      unit.speed /= 20;
      if (unit.pushX !== undefined) unit.pushX /= 20;
      if (unit.pushY !== undefined) unit.pushY /= 20;
      unit.cargo?.forEach(oldRates);
    };
    older.units.forEach(oldRates);
    older.variants!["test/champion"]!.speed /= 20;
    older.variants!["test/champion"]!.aimSpeed! /= 20;
    const target = createGame("bareDuel", { aiPlayers: [] });
    restoreSnapshotIntoGame(target, older, source.nextId);
    expect(snapshotGame(target)).toEqual(expected);
    expect(older.units[0]!.speed).toBe(3.1);
    restoreSnapshotIntoGame(target, snapshotGame(target), target.nextId);
    expect(snapshotGame(target)).toEqual(expected);
  });

  it("restores every snapshot field and invalidates runtime lookup caches", () => {
    const source = createGame("ladder", { players: ["player", "enemy", "enemy2"], aiPlayers: [], teams: { player: "north", enemy: "south", enemy2: "east" } });
    for (let i = 0; i < 3; i += 1) stepGame(source);
    source.match.winner = "enemy2";
    source.nextId = 9876;
    source.projectiles.push({
      id: "projectile-restore-proof",
      owner: "enemy",
      attackerId: "unit-enemy-archer",
      targetId: "unit-player-worker",
      fromX: 100,
      fromY: 200,
      toX: 300,
      toY: 400,
      damage: 7,
      remaining: 12,
      duration: 24,
    });

    const target = createGame("bareDuel", { aiPlayers: [] });
    target.unitSpatial = { cellSize: 1, buckets: new Map() };
    target.unitSpatialByTeam = new Map();
    target.buildingSpatial = { cellSize: 1, buckets: new Map() };
    target.buildingSpatialByTeam = new Map();
    target.buildingSpatialCount = 1;
    target.entityById = new Map();

    const snapshot = snapshotGame(source);
    restoreSnapshotIntoGame(target, snapshot, source.nextId);

    expect(snapshotGame(target)).toEqual(snapshot);
    expect(target.nextId).toBe(source.nextId);
    expect(target.unitSpatial).toBeUndefined();
    expect(target.unitSpatialByTeam).toBeUndefined();
    expect(target.buildingSpatial).toBeUndefined();
    expect(target.buildingSpatialByTeam).toBeUndefined();
    expect(target.buildingSpatialCount).toBeUndefined();
    expect(target.entityById).toBeUndefined();
  });

  it("tracks the complete GameSnapshot key set", () => {
    // A campaign game's snapshot carries its units' variants, a map's with a shop its shops, a map's with rocks or gates
    // its obstacles; a standard match's on a map with none has no such key at all.
    const campaign = createGame("bareDuel", { aiPlayers: [] });
    campaign.corpses = [];
    campaign.variants = { "test/champion": resolveVariant({ base: "footman" }) };
    campaign.shops = [createShop("shop", 400, 400)];
    campaign.obstacles = [createObstacle("obstacle-test", "rocks", 400, 400, { x: 1, y: 0 })];
    const snapshot = snapshotGame(campaign);

    expect([...GAME_SNAPSHOT_RESTORE_KEYS].sort()).toEqual(Object.keys(snapshot).sort());
    expect(Object.keys(snapshotGame(createGame("bareDuel", { aiPlayers: [] }))).sort()).toEqual(GAME_SNAPSHOT_RESTORE_KEYS.filter((key) => key !== "corpses" && key !== "variants" && key !== "shops" && key !== "obstacles").sort());
  });
});
