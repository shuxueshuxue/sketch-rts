import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "../catalog";
import { createBuilding, createUnit } from "../map";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from "../sim";
import { checksumGame } from "./checksum";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.mercenaryCamps = []; game.projectiles = []; game.effects = [];
  delete game.shops; delete game.map.terrain;
  game.scriptedVictory = true;
  return game;
}

function company(game: ReturnType<typeof scene>) {
  const leader = game.spawnUnit("player", "raider", 1000, 1000);
  const follower = game.spawnUnit("player", "footman", 1060, 1000);
  for (const unit of [leader, follower]) unit.order = { type: "hold", x: unit.x, y: unit.y };
  return { leader, follower };
}

describe("veteran projection across native and callback frames", () => {
  it("keeps a fresh empty projection after a native birth, then reads a skill added before the next tick", () => {
    const game = scene();
    const { leader, follower } = company(game);
    const hall = createBuilding("hall", "player", "townHall", 1600, 1600, true);
    game.buildings.push(hall); game.players.player.gold = 10000; game.players.player.supplyCap = 100;
    issuePlayerCommand(game, "player", { type: "train", buildingId: hall.id, unitKind: "worker" });
    hall.queue[0]!.remaining = 1;
    const old = game.veteranFrame;
    stepGame(game);
    expect(game.units).toHaveLength(3);
    expect(game.units.find(unit => unit.kind === "worker")?.veteranSkill).toBeUndefined();
    expect(game.veteranFrame?.size).toBe(0);
    expect(game.veteranFrame).not.toBe(old);
    const firstEmpty = game.veteranFrame;
    stepGame(game);
    expect(game.veteranFrame?.size).toBe(0);
    expect(game.veteranFrame).not.toBe(firstEmpty);
    leader.level = 3; leader.veteranSkill = "veteranMarch";
    stepGame(game);
    expect(follower.speed).toBe(UNIT_DEFS.footman.speed * 1.25);
    expect(game.veteranFrame?.get(follower.id)?.moveSpeedMultiplier).toBe(1.25);
  });

  it("revokes a departed aura when every remaining raw skill is undefined, preserving fractional health", () => {
    const game = scene();
    const { leader, follower } = company(game);
    leader.level = 3; leader.veteranSkill = "veteranMarch";
    follower.hp = .2;
    stepGame(game);
    expect(follower.speed).toBe(UNIT_DEFS.footman.speed * 1.25);
    const projected = game.veteranFrame;
    delete leader.veteranSkill;
    stepGame(game);
    expect(game.veteranFrame?.size).toBe(0);
    expect(game.veteranFrame).not.toBe(projected);
    expect(follower.speed).toBe(UNIT_DEFS.footman.speed);
    expect(follower.hp).toBe(.2);
  });

  it("includes an aura assigned by a hit callback after the entry projection", () => {
    const game = scene();
    const { leader, follower } = company(game);
    const bait = game.spawnUnit("player", "worker", 1800, 1800);
    game.projectiles.push({ id: "callback-shot", owner: "enemy", attackerId: "departed-attacker", targetId: bait.id,
      fromX: 2000, fromY: 1800, toX: bait.x, toY: bait.y, damage: 1, remaining: 1, duration: 1 });
    let hits = 0;
    game.observer = { hit: (_attacker, target) => {
      if (target.id === bait.id) { hits++; leader.level = 3; leader.veteranSkill = "veteranMarch"; }
    } };
    stepGame(game);
    expect(hits).toBe(1);
    expect(follower.speed).toBe(UNIT_DEFS.footman.speed * 1.25);
    expect(game.veteranFrame?.get(follower.id)?.moveSpeedMultiplier).toBe(1.25);
  });

  it("projects a skilled body returned by a custom training factory in that tick", () => {
    const game = scene();
    const hall = createBuilding("barracks", "player", "barracks", 1000, 1000, true);
    const follower = game.spawnUnit("player", "footman", 1200, 1000);
    follower.order = { type: "hold", x: follower.x, y: follower.y };
    game.buildings.push(hall); game.players.player.gold = 10000; game.players.player.supplyCap = 100;
    const native = game.spawnUnit.bind(game);
    game.spawnUnit = (...args) => {
      const unit = native(...args);
      unit.level = 3; unit.veteranSkill = "veteranCommand";
      return unit;
    };
    issuePlayerCommand(game, "player", { type: "train", buildingId: hall.id, unitKind: "footman" });
    hall.queue[0]!.remaining = 1;
    stepGame(game);
    const trained = game.units.find(unit => unit.id !== follower.id)!;
    expect(hall.queue).toHaveLength(0);
    expect(Math.hypot(trained.x - follower.x, trained.y - follower.y)).toBeLessThan(160);
    expect(game.veteranFrame?.get(follower.id)?.attackSpeedMultiplier).toBe(1.35);
    trained.order = { type: "hold", x: trained.x, y: trained.y };
    const foe = createUnit("speed-target", "enemy", "footman", follower.x + 40, follower.y);
    foe.cooldown = 9999; foe.order = { type: "hold", x: foe.x, y: foe.y };
    game.units.push(foe);
    follower.cooldown = 0; follower.order = { type: "attack", targetId: foe.id };
    const hp = foe.hp;
    stepGame(game);
    expect(foe.hp).toBeLessThan(hp);
    expect(follower.cooldown).toBeGreaterThan(0);
    expect(follower.cooldown).toBeLessThan(follower.attackCooldown);
  });

  it("reads a skilled passenger exposed by cargo migration before entry projection", () => {
    const game = scene();
    const ship = game.spawnUnit("player", "transport", 1600, 1600);
    ship.order = { type: "hold", x: ship.x, y: ship.y };
    const passenger = createUnit("nested-veteran", "player", "raider", ship.x, ship.y);
    passenger.level = 3; passenger.veteranSkill = "veteranMobility";
    ship.cargo = [passenger];
    stepGame(game);
    expect(ship.cargo).toBeUndefined();
    expect(game.units.filter(unit => unit.id === passenger.id)).toEqual([passenger]);
    expect(passenger.deck?.shipId).toBe(ship.id);
    expect(game.veteranFrame?.get(passenger.id)?.moveSpeedMultiplier).toBe(1.3);
    expect(passenger.speed).toBe(UNIT_DEFS.raider.speed * 1.3);
  });

  it("restores an aura after a prior empty native frame and retains identical continuation", () => {
    const game = scene();
    const { leader, follower } = company(game);
    stepGame(game);
    expect(game.veteranFrame?.size).toBe(0);
    leader.level = 3; leader.veteranSkill = "veteranMarch";
    const restored = scene();
    restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    for (let tick = 0; tick < 4; tick++) {
      stepGame(game); stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
      expect(follower.speed).toBe(UNIT_DEFS.footman.speed * 1.25);
      expect(restored.veteranFrame?.get(follower.id)?.moveSpeedMultiplier).toBe(1.25);
    }
  });
});
