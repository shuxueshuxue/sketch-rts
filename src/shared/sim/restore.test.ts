import { describe, expect, it } from "vitest";
import { resolveVariant } from "../catalog";
import { createShop } from "../shop";
import { createObstacle } from "../obstacle";
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame, GAME_SNAPSHOT_RESTORE_KEYS } from "../sim";

describe("game snapshot restoration", () => {
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
    campaign.variants = { "test/champion": resolveVariant({ base: "footman" }) };
    campaign.shops = [createShop("shop", 400, 400)];
    campaign.obstacles = [createObstacle("obstacle-test", "rocks", 400, 400, { x: 1, y: 0 })];
    const snapshot = snapshotGame(campaign);

    expect([...GAME_SNAPSHOT_RESTORE_KEYS].sort()).toEqual(Object.keys(snapshot).sort());
    expect(Object.keys(snapshotGame(createGame("bareDuel", { aiPlayers: [] }))).sort()).toEqual(GAME_SNAPSHOT_RESTORE_KEYS.filter((key) => key !== "variants" && key !== "shops" && key !== "obstacles").sort());
  });
});
