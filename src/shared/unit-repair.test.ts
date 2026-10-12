import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from "./sim";
import { UNIT_DEFS, resolveVariant } from "./catalog";
import { createBuilding } from "./map";
import { unitNeedsRepair, unitRepairHpPerGold, UNIT_REPAIR_RULES } from "./unit-repair";
import { boardUnit } from "./decks";
import { installedWeapons, shipPartMax, SHIP_WEAPONS } from "./ship-equipment";
import type { Unit } from "./types";

function repairScene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = [];
  game.items = [];
  game.buildings = [];
  game.resources = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  game.players.player!.gold = 100;
  return game;
}

function hold(unit: Unit) { unit.order = { type: "hold", x: unit.x, y: unit.y }; }
function run(game: ReturnType<typeof repairScene>, ticks: number) { for (let tick = 0; tick < ticks; tick++) stepGame(game); }
function runUntil(game: ReturnType<typeof repairScene>, condition: () => boolean, limit = 600) {
  for (let tick = 0; tick < limit && !condition(); tick++) stepGame(game);
  expect(condition()).toBe(true);
}

describe("worker repair of mechanical units", () => {
  it.each(["golem", "rubbleGolem", "rockGolem", "graniteGolem", "siegeRam", "ballista", "catapult", "organGun"] as const)("repairs an owned %s with gold instead of medical healing", kind => {
    const game = repairScene();
    const worker = game.spawnUnit("player", "worker", 500, 500);
    const target = game.spawnUnit("player", kind, 560, 500);
    hold(target);
    target.hp -= 80;
    const hp = target.hp;
    issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: target.id });
    expect(worker.order).toEqual({ type: "repairUnit", targetId: target.id });
    stepGame(game);
    expect(target.hp - hp).toBeCloseTo(unitRepairHpPerGold(game, target));
    expect(game.players.player!.gold).toBe(99);
    expect(game.effects.some(effect => effect.type === "repair" && effect.unitId === worker.id)).toBe(true);
  });

  it("charges unpriced wild constructs by a finite health budget", () => {
    const game = repairScene();
    const construct = game.spawnUnit("player", "graniteGolem", 560, 500);
    expect(UNIT_DEFS.graniteGolem.cost).toBe(0);
    expect(unitRepairHpPerGold(game, construct)).toBe(UNIT_REPAIR_RULES.unpricedHpPerGold);
    expect(unitRepairHpPerGold(game, construct)).toBeLessThan(construct.maxHp);
  });

  it("approaches a distant mechanical target before spending any gold", () => {
    const game = repairScene();
    const worker = game.spawnUnit("player", "worker", 500, 500);
    const target = game.spawnUnit("player", "golem", 900, 500);
    hold(target);
    target.hp -= 100;
    const hp = target.hp;
    issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: target.id });
    stepGame(game);
    expect(worker.x).toBeGreaterThan(500);
    expect(target.hp).toBe(hp);
    expect(game.players.player!.gold).toBe(100);
    runUntil(game, () => target.hp > hp);
    expect(game.players.player!.gold).toBeLessThan(100);
  });

  it("waits for money without cancelling the job or creating free repair", () => {
    const game = repairScene();
    const worker = game.spawnUnit("player", "worker", 500, 500);
    const target = game.spawnUnit("player", "golem", 560, 500);
    hold(target);
    target.hp -= 100;
    const hp = target.hp;
    game.players.player!.gold = 0;
    issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: target.id });
    run(game, 20);
    expect(target.hp).toBe(hp);
    expect(worker.order.type).toBe("repairUnit");
    game.players.player!.gold = 2;
    run(game, 40);
    expect(game.players.player!.gold).toBe(0);
    expect(target.hp - hp).toBeCloseTo(unitRepairHpPerGold(game, target) * 2);
    expect(worker.order.type).toBe("repairUnit");
  });

  it("lets several workers contribute without charging idle workers after the final repair", () => {
    const game = repairScene();
    const workers = [500, 540, 460].map(y => game.spawnUnit("player", "worker", 500, y));
    const target = game.spawnUnit("player", "golem", 560, 500);
    hold(target);
    target.hp -= 100;
    const hp = target.hp;
    const gain = unitRepairHpPerGold(game, target);
    issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: workers.map(worker => worker.id), targetId: target.id });
    stepGame(game);
    expect(target.hp - hp).toBeCloseTo(gain * workers.length);
    expect(game.players.player!.gold).toBe(97);
    for (const worker of workers) worker.cooldown = 0;
    target.hp = target.maxHp - 1;
    stepGame(game);
    expect(target.hp).toBe(target.maxHp);
    expect(game.players.player!.gold).toBe(96);
    expect(workers.every(worker => worker.order.type === "idle")).toBe(true);
    run(game, 30);
    expect(game.players.player!.gold).toBe(96);
  });

  it("rejects nonmechanical, enemy, dead and fully repaired units", () => {
    const game = repairScene();
    const worker = game.spawnUnit("player", "worker", 500, 500);
    const biological = game.spawnUnit("player", "knight", 560, 500);
    const enemy = game.spawnUnit("enemy", "golem", 1000, 1000);
    const dead = game.spawnUnit("player", "golem", 1100, 1100);
    const whole = game.spawnUnit("player", "golem", 1200, 1200);
    biological.hp -= 100;
    enemy.hp -= 100;
    dead.hp = 0;
    for (const target of [biological, enemy, dead, whole]) {
      expect(() => issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: target.id })).toThrow();
    }
    expect(unitNeedsRepair(game, biological)).toBe(false);
    expect(unitNeedsRepair(game, dead)).toBe(false);
    expect(unitNeedsRepair(game, whole)).toBe(false);
    expect(game.players.player!.gold).toBe(100);
  });

  it("cancels a stale biological repair order and a nonworker's forged repair order", () => {
    const game = repairScene();
    const worker = game.spawnUnit("player", "worker", 500, 500);
    const soldier = game.spawnUnit("player", "footman", 520, 540);
    const construct = game.spawnUnit("player", "golem", 560, 500);
    soldier.hp -= 50;
    construct.hp -= 100;
    worker.order = { type: "repairUnit", targetId: soldier.id };
    soldier.order = { type: "repairUnit", targetId: construct.id };
    const hp = construct.hp;
    stepGame(game);
    expect(worker.order.type).toBe("idle");
    expect(soldier.order.type).toBe("idle");
    expect(construct.hp).toBe(hp);
    expect(game.players.player!.gold).toBe(100);
  });

  it("repairs a construct sharing the worker's deck without treating it as a hull", () => {
    const game = repairScene();
    const ship = game.spawnUnit("player", "carrier", 1000, 800);
    const construct = game.spawnUnit("player", "golem", 1000, 800);
    const worker = game.spawnUnit("player", "worker", 1000, 800);
    expect(boardUnit(ship, construct, game.units)).toBe(true);
    expect(boardUnit(ship, worker, game.units)).toBe(true);
    hold(ship);
    hold(construct);
    construct.hp -= 100;
    const hp = construct.hp;
    const hullHp = ship.hp;
    issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: construct.id });
    runUntil(game, () => construct.hp > hp);
    expect(worker.deck?.shipId).toBe(ship.id);
    expect(ship.hp).toBe(hullHp);
    expect(construct.shipParts).toBeUndefined();
    expect(game.players.player!.gold).toBe(99);
  });

  it("continues the next queued order once mechanical repair finishes", () => {
    const game = repairScene();
    const worker = game.spawnUnit("player", "worker", 500, 500);
    const construct = game.spawnUnit("player", "golem", 560, 500);
    hold(construct);
    construct.hp -= 1;
    issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: construct.id });
    issuePlayerCommand(game, "player", { type: "move", unitIds: [worker.id], x: 350, y: 500, queued: true });
    run(game, 2);
    expect(construct.hp).toBe(construct.maxHp);
    expect(worker.order.type).toBe("move");
    expect(worker.x).toBeLessThan(500);
    expect(game.players.player!.gold).toBe(99);
  });

  it("repairs rigging and weapons even when a ship's hull is already full", () => {
    const game = repairScene();
    game.players.player!.gold = 1000;
    const ship = game.spawnUnit("player", "warship", 700, 800);
    const worker = game.spawnUnit("player", "worker", 700, 800);
    hold(ship);
    expect(boardUnit(ship, worker, game.units)).toBe(true);
    const weapon = installedWeapons(game, ship)[0]!;
    ship.shipParts!.rigging = 0;
    weapon.durability = 0;
    expect(unitNeedsRepair(game, ship)).toBe(true);
    issuePlayerCommand(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: ship.id });
    stepGame(game);
    expect(ship.hp).toBe(ship.maxHp);
    expect(ship.shipParts!.rigging).toBeGreaterThan(0);
    expect(game.players.player!.gold).toBe(999);
    runUntil(game, () => !unitNeedsRepair(game, ship), 1200);
    expect(ship.shipParts).toEqual(shipPartMax(ship));
    expect(weapon.durability).toBe(SHIP_WEAPONS.shipCannon.hp);
    const gold = game.players.player!.gold;
    run(game, 20);
    expect(game.players.player!.gold).toBe(gold);
  });

  it("does not spend dock gold on a nonmechanical ship variant", () => {
    const game = repairScene();
    game.variants = { livingHull: resolveVariant({ base: "transport", unitClass: "nonMechanical" }) };
    const ship = game.spawnUnit("player", "transport", 1000, 800);
    ship.variant = "livingHull";
    ship.hp -= 100;
    hold(ship);
    game.buildings.push(createBuilding("repair-dock", "player", "shipyard", 1180, 800, true));
    const hp = ship.hp;
    expect(unitNeedsRepair(game, ship)).toBe(false);
    run(game, 40);
    expect(ship.hp).toBe(hp);
    expect(game.players.player!.gold).toBe(100);
  });

  it("does not suppress an idle worker's autocast on a damaged nonmechanical ship variant", () => {
    const game = repairScene();
    game.variants = { livingHull: resolveVariant({ base: "transport", unitClass: "nonMechanical" }) };
    const ship = game.spawnUnit("player", "transport", 1000, 800);
    ship.variant = "livingHull";
    ship.hp -= 100;
    hold(ship);
    const worker = game.spawnUnit("player", "worker", 1000, 800);
    expect(boardUnit(ship, worker, game.units)).toBe(true);
    worker.level = 3;
    worker.veteranSkill = "veteranRally";
    worker.order = { type: "idle" };
    const ally = game.spawnUnit("player", "footman", worker.x + 70, worker.y + 70);
    const enemy = game.spawnUnit("enemy", "footman", ally.x + 40, ally.y);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [ally.id], targetId: enemy.id });
    const hp = ship.hp;
    run(game, 2);
    expect(worker.abilityCooldowns?.veteranRally ?? 0).toBeGreaterThan(0);
    expect(ally.effects.some(effect => effect.type === "veteranBuff")).toBe(true);
    expect(ship.hp).toBe(hp);
    expect(game.players.player!.gold).toBe(100);
  });

  it("continues an old ship-repair order after snapshot restore and accepts its old command", () => {
    const game = repairScene();
    const ship = game.spawnUnit("player", "transport", 560, 500);
    const worker = game.spawnUnit("player", "worker", 500, 500);
    hold(ship);
    ship.hp -= 100;
    issuePlayerCommand(game, "player", { type: "repairShip", unitIds: [worker.id], targetId: ship.id });
    expect(worker.order.type).toBe("repairUnit");
    worker.order = { type: "repairShip", targetId: ship.id };
    const restored = repairScene();
    restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    restored.scriptedVictory = true;
    const restoredShip = restored.units.find(unit => unit.id === ship.id)!;
    const hp = restoredShip.hp;
    stepGame(restored);
    expect(restoredShip.hp).toBeGreaterThan(hp);
    expect(restored.players.player!.gold).toBe(99);
  });
});
