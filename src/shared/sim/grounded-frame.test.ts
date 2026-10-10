import { describe, expect, it } from "vitest";
import { createBuilding, createUnit } from "../map";
import { beginShipMotionFrame, advanceShip } from "../ship-motion";
import { groundShipFrameEmpty, shipCollisionImpactCount } from "../ship-collisions";
import { shipProfile } from "../ship-geometry";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from "../sim";
import { perTick } from "../time";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.mercenaryCamps = []; game.projectiles = []; game.effects = [];
  delete game.shops;
  delete game.map.terrain;
  game.scriptedVictory = true;
  return game;
}

describe("grounded simulation frames", () => {
  it("matches the complete frame through movement, combat, summons, expiry and snapshot restore", () => {
    const game = scene();
    const walker = game.spawnUnit("player", "worker", 700, 800);
    walker.order = { type: "move", x: 1200, y: 850 };
    const caster = game.spawnUnit("player", "summoner", 1000, 1000);
    caster.order = { type: "hold", x: caster.x, y: caster.y };
    const foe = game.spawnUnit("enemy", "worker", 1250, 1000);
    foe.order = { type: "hold", x: foe.x, y: foe.y };
    const front = game.spawnUnit("player", "footman", 1500, 1500);
    const enemy = game.spawnUnit("enemy", "footman", 1540, 1500);
    front.order = { type: "attack", targetId: enemy.id };
    enemy.order = { type: "hold", x: enemy.x, y: enemy.y };
    const expiring = game.spawnUnit("player", "spirit", 2100, 2100);
    expiring.expiresTick = 3;
    game.tick = 1;

    const complete = scene();
    restoreSnapshotIntoGame(complete, snapshotGame(game), game.nextId);
    // A public custom factory retains every naval pass. Its native delegate
    // lets this independently exercise both paths against the same real state.
    complete.spawnUnit = complete.spawnUnit.bind(complete);
    const initialWalkerX = walker.x, initialEnemyHp = enemy.hp;
    for (let tick = 0; tick < 12; tick++) {
      stepGame(game); stepGame(complete);
      expect(snapshotGame(game)).toStrictEqual(snapshotGame(complete));
      if (tick === 5) {
        restoreSnapshotIntoGame(game, snapshotGame(game), game.nextId);
        restoreSnapshotIntoGame(complete, snapshotGame(complete), complete.nextId);
      }
    }
    expect(game.units.find(unit => unit.id === walker.id)!.x).toBeGreaterThan(initialWalkerX);
    expect(game.units.find(unit => unit.id === enemy.id)!.hp).toBeLessThan(initialEnemyHp);
    expect(game.units.some(unit => unit.kind === "spirit" && unit.id !== expiring.id)).toBe(true);
    expect(game.units.some(unit => unit.id === expiring.id)).toBe(false);
    expect(game.shipReachPadding).toBe(0);
    expect(game.boardingHolds?.size).toBe(0);
  });

  it("clears actual hull impacts after the last ship leaves the same unit array", () => {
    const game = scene();
    const ship = game.spawnUnit("player", "transport", 1000, 1000);
    const bow = Math.max(...shipProfile(ship)!.hull.map(point => point.x));
    const walker = game.spawnUnit("enemy", "footman", ship.x + bow + 16 + .4, ship.y);
    walker.radius = 16;
    walker.order = { type: "hold", x: walker.x, y: walker.y };
    ship.sailing!.speed = 64; ship.sailing!.velocityX = 64;
    beginShipMotionFrame(game.units, game.map, [], [ship]);
    expect(advanceShip(ship, game.map, game.units, { surge: perTick(64) })).toBe(false);
    expect(shipCollisionImpactCount(game.units)).toBe(1);
    const units = game.units, hp = walker.hp;
    units.splice(0, 1);
    game.shipReachPadding = 500;

    stepGame(game);
    expect(game.units).toBe(units);
    expect(walker.hp).toBe(hp);
    expect(groundShipFrameEmpty(units)).toBe(true);
    expect(shipCollisionImpactCount(units)).toBe(0);
    expect(game.shipReachPadding).toBe(0);
  });

  it("preserves the existing nonempty vessel view after equal-length direct replacement", () => {
    const game = scene();
    const ship = game.spawnUnit("player", "transport", 1000, 1000);
    stepGame(game);
    const units = game.units;
    units[0] = createUnit("replacement", "player", "worker", 2000, 2000);
    ship.sailing!.speed = 20;
    stepGame(game);
    expect(game.units).toBe(units);
    expect(game.units[0]!.kind).toBe("worker");
    // Complete naval frames already stop the stationary cached hull. The
    // grounded shortcut must preserve this existing array-mutation contract.
    expect(ship.sailing!.speed).toBe(0);
    expect(game.shipReachPadding).toBeGreaterThan(0);
  });

  it("still migrates an empty cargo array without hulls", () => {
    const game = scene();
    const worker = game.spawnUnit("player", "worker", 1000, 1000);
    worker.cargo = [];
    stepGame(game);
    expect(worker).not.toHaveProperty("cargo");
  });

  it("cleans a mismatched cabin added to the existing grounded array", () => {
    const game = scene();
    const worker = game.spawnUnit("player", "worker", 1000, 1000);
    stepGame(game);
    const units = game.units;
    worker.cabin = { shipId: "missing-cabin" };
    stepGame(game);
    expect(game.units).toBe(units);
    expect(worker.cabin).toBeUndefined();
  });

  it("cleans orphan rendezvous state without erasing its existing deck attachment", () => {
    const game = scene();
    const worker = game.spawnUnit("player", "worker", 1000, 1000);
    worker.cabin = { shipId: "missing-cabin" };
    worker.deck = { shipId: "missing-deck", x: 0, y: 0 };
    worker.sailing = { heading: 0, speed: 0, load: 0, balance: 0,
      route: { goalX: 1200, goalY: 1000, points: [], end: { x: 1200, y: 1000 } } };
    worker.order = { type: "move", x: 1200, y: 1000, rendezvousFor: "missing-crew" };
    stepGame(game);
    expect(worker.cabin).toBeUndefined();
    expect(worker.deck?.shipId).toBe("missing-deck");
    expect(worker.order).toEqual({ type: "idle" });
    expect(worker.sailing.route).toBeUndefined();
  });

  it("keeps queued unloading completion when the frame began as ordinary land units", () => {
    const game = scene();
    const worker = game.spawnUnit("player", "worker", 1000, 1000);
    worker.orderQueue = [{ type: "unload", x: 1500, y: 1000 }];
    stepGame(game);
    expect(worker.x).toBeGreaterThan(1000);
    expect(worker.order).toEqual({ type: "idle" });
    expect(worker.orderQueue).toEqual([]);
  });

  it("retains cabin cleanup when a custom birth factory mutates an old unit without appending", () => {
    const game = scene();
    const worker = game.spawnUnit("player", "worker", 1000, 1000);
    const hall = createBuilding("hall", "player", "townHall", 500, 500, true);
    game.buildings = [hall]; game.players.player.gold = 10000; game.players.player.supplyCap = 100;
    issuePlayerCommand(game, "player", { type: "train", buildingId: hall.id, unitKind: "worker" });
    hall.queue[0]!.remaining = 1;
    game.spawnUnit = () => {
      worker.cabin = { shipId: "missing-cabin" };
      return worker;
    };
    stepGame(game);
    expect(game.units).toEqual([worker]);
    expect(hall.queue).toHaveLength(0);
    expect(worker.cabin).toBeUndefined();
  });

  it("retains tail cleanup when a hit observer mutates an existing unit", () => {
    const game = scene();
    const fighter = game.spawnUnit("player", "footman", 1000, 1000);
    const enemy = game.spawnUnit("enemy", "footman", 1040, 1000);
    const worker = game.spawnUnit("player", "worker", 1800, 1800);
    fighter.order = { type: "attack", targetId: enemy.id };
    enemy.order = { type: "hold", x: enemy.x, y: enemy.y };
    let hits = 0;
    game.observer = { hit: () => { hits++; worker.cabin = { shipId: "missing-cabin" }; } };
    stepGame(game);
    expect(hits).toBeGreaterThan(0);
    expect(worker.cabin).toBeUndefined();
  });
});
