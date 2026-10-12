import { describe, expect, it } from "vitest";
import { createBuilding, createUnit } from "../map";
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame, type Game } from "../sim";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.mercenaryCamps = []; game.projectiles = []; game.effects = [];
  delete game.shops;
  delete game.map.terrain;
  game.scriptedVictory = true;
  return game;
}

function completeTwin(game: Game) {
  const complete = scene();
  restoreSnapshotIntoGame(complete, snapshotGame(game), game.nextId);
  // A public custom factory keeps the full hull, cabin and reachability path.
  complete.spawnUnit = complete.spawnUnit.bind(complete);
  return complete;
}

function compareSteps(game: Game, count: number, inspect?: (tick: number, complete: Game) => void) {
  const complete = completeTwin(game);
  for (let tick = 0; tick < count; tick++) {
    stepGame(game); stepGame(complete);
    expect(snapshotGame(game)).toStrictEqual(snapshotGame(complete));
    inspect?.(tick, complete);
  }
}

describe("certified grounded combat frames", () => {
  it("keeps queued ground movement through stun, slowing and arrival", () => {
    const game = scene();
    const walker = game.spawnUnit("player", "worker", 800, 800);
    walker.order = { type: "move", x: 900, y: 800 };
    walker.orderQueue = [{ type: "move", x: 1200, y: 850 }];
    walker.effects = [{ type: "stun", remaining: 10 }, { type: "slow", remaining: 35 }];
    compareSteps(game, 200);
    expect(walker.order).toEqual({ type: "idle" });
    expect(walker.arrivedAt).toEqual({ x: 1200, y: 850 });
    expect(walker.orderQueue).toEqual([]);
    expect(Math.hypot(walker.x - 1200, walker.y - 850)).toBeLessThan(5);
  });

  it("keeps automatic target ties, retargeting and damage from pending tracking shots", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "archer", 1000, 1000);
    const first = game.spawnUnit("enemy", "footman", 1130, 1040);
    const second = game.spawnUnit("enemy", "footman", 1130, 960);
    first.order = { type: "hold", x: first.x, y: first.y };
    second.order = { type: "hold", x: second.x, y: second.y };
    first.cooldown = 10000; second.cooldown = 10000;
    const initialHp = first.hp;
    compareSteps(game, 110, (tick, complete) => {
      if (tick === 0) {
        expect(guard.order).toMatchObject({ type: "attack", targetId: first.id });
        const shot = { id: "pending-finisher", owner: "player", attackerId: guard.id, targetId: first.id,
          fromX: guard.x, fromY: guard.y, toX: first.x, toY: first.y, damage: first.hp,
          remaining: 60, duration: 60 };
        game.projectiles.push({ ...shot }); complete.projectiles.push({ ...shot });
      }
      if (tick === 1) expect(guard.order).toMatchObject({ type: "attack", targetId: second.id });
    });
    expect(second.hp).toBeLessThan(second.maxHp);
    expect(first.hp).toBeLessThan(initialHp);
  });

  it("keeps explicit melee attacks on a structure surface and unit center", () => {
    const game = scene();
    const hall = createBuilding("target-hall", "enemy", "townHall", 1300, 1000, true);
    game.buildings = [hall];
    const fighter = game.spawnUnit("player", "footman", hall.x - hall.radius - 47, hall.y);
    fighter.order = { type: "attack", targetId: hall.id };
    const archer = game.spawnUnit("player", "archer", 900, 1200);
    const foe = game.spawnUnit("enemy", "footman", 1400, 1200);
    foe.order = { type: "hold", x: foe.x, y: foe.y }; foe.cooldown = 10000;
    archer.order = { type: "attack", targetId: foe.id };
    const hallHp = hall.hp, archerX = archer.x;
    compareSteps(game, 160);
    expect(hall.hp).toBeLessThan(hallHp);
    expect(archer.x).toBeGreaterThan(archerX);
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });

  it("keeps attack-move acquisition and lost-target destination recovery", () => {
    const game = scene();
    const attacker = game.spawnUnit("player", "footman", 1000, 1000);
    const target = game.spawnUnit("enemy", "worker", 1150, 1000);
    target.hp = 1; target.order = { type: "hold", x: target.x, y: target.y };
    attacker.order = { type: "attackMove", x: 1500, y: 1000, targetId: "departed-target" };
    let resumedDestination = false;
    compareSteps(game, 200, () => {
      if (attacker.order.type === "attackMove" && !attacker.order.targetId && !game.units.some(unit => unit.id === target.id)) resumedDestination = true;
    });
    expect(game.units.some(unit => unit.id === target.id)).toBe(false);
    expect(attacker.x).toBeGreaterThan(1200);
    expect(resumedDestination).toBe(true);
    expect(attacker.order).toEqual({ type: "idle" });
    expect(attacker.order).not.toHaveProperty("targetId");
  });

  it.each(["attack", "attackMove", "aim"] as const)("keeps the land artillery dead zone for %s", orderType => {
    const game = scene();
    const catapult = game.spawnUnit("player", "catapult", 1000, 1000);
    const target = game.spawnUnit("enemy", "footman", 1100, 1000);
    target.order = { type: "hold", x: target.x, y: target.y }; target.cooldown = 10000;
    catapult.order = orderType === "attack" ? { type: "attack", targetId: target.id }
      : orderType === "attackMove" ? { type: "attackMove", x: 1400, y: 1000, targetId: target.id }
      : { type: "aim", x: target.x, y: target.y };
    compareSteps(game, 110);
    expect(catapult.x).toBeLessThan(1000);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("keeps terrain reachability when two land units stand on different islands", () => {
    const game = scene();
    game.map.width = 1000; game.map.height = 800;
    game.map.terrain = { cell: 40, cols: 25, rows: 20,
      cells: Array.from({ length: 500 }, (_, i) => i % 25 >= 10 && i % 25 <= 14 ? "~" : ".").join("") };
    const fighter = game.spawnUnit("player", "footman", 380, 400);
    const across = game.spawnUnit("enemy", "footman", 620, 400);
    across.order = { type: "hold", x: across.x, y: across.y };
    fighter.order = { type: "attack", targetId: across.id };
    compareSteps(game, 50);
    expect(fighter.order).toEqual({ type: "idle" });
    expect(across.hp).toBe(across.maxHp);
    expect(fighter.x).toBe(380);
  });

  it("keeps same-frame summons in the target rules without moving their first action", () => {
    const game = scene();
    const summoner = game.spawnUnit("player", "summoner", 1000, 1000);
    summoner.order = { type: "hold", x: summoner.x, y: summoner.y };
    const enemy = game.spawnUnit("enemy", "archer", 1250, 1000);
    enemy.order = { type: "attackMove", x: 900, y: 1000, targetId: summoner.id };
    game.tick = 1;
    const source = game.units;
    compareSteps(game, 70, tick => {
      if (tick === 0) {
        const spirit = game.units.find(unit => unit.kind === "spirit")!;
        expect(spirit).toBeDefined();
        expect(spirit.order).toEqual({ type: "idle" });
        expect(game.units).toBe(source);
      }
    });
    expect(summoner.abilityCooldowns?.summon).toBeGreaterThan(0);
  });

  it.each(["attack", "attackMove"] as const)("retains a stale hull's geometry after equal-length replacement for %s", orderType => {
    const game = scene();
    const archer = game.spawnUnit("player", "archer", 1000, 1000);
    game.spawnUnit("enemy", "worker", 1360, 1000);
    archer.order = { type: "hold", x: archer.x, y: archer.y };
    const complete = completeTwin(game);
    for (const candidate of [game, complete]) {
      stepGame(candidate);
      candidate.units[1] = createUnit("old-hull", "enemy", "transport", 1360, 1000);
      candidate.units[1]!.order = { type: "hold", x: 1360, y: 1000 };
      // Refresh the existing entity cache while preserving the vessel array
      // cache's public equal-length replacement behavior.
      candidate.buildings = [...candidate.buildings];
      stepGame(candidate);
      candidate.units[1] = createUnit("new-body", "enemy", "worker", 2000, 2000);
      candidate.units[0]!.order = orderType === "attack" ? { type: "attack", targetId: "old-hull" }
        : { type: "attackMove", x: 1600, y: 1000, targetId: "old-hull" };
      candidate.units[0]!.cooldown = 0;
    }
    for (let tick = 0; tick < 5; tick++) {
      stepGame(game); stepGame(complete);
      expect(snapshotGame(game)).toStrictEqual(snapshotGame(complete));
    }
    expect(game.shipReachPadding).toBe(0);
    expect(game.entityById!.get("old-hull")!.kind).toBe("transport");
    expect(archer.x).toBe(1000);
    expect(archer.aim).toBeDefined();
  });

  it("retains cabin protection on a stale target outside the current unit array", () => {
    const game = scene();
    const archer = game.spawnUnit("player", "archer", 1000, 1000);
    game.spawnUnit("enemy", "worker", 1200, 1000);
    archer.order = { type: "hold", x: archer.x, y: archer.y };
    archer.cooldown = 10000;
    const complete = completeTwin(game);
    for (const candidate of [game, complete]) {
      stepGame(candidate);
      const oldTarget = candidate.units[1]!;
      candidate.units[1] = createUnit("new-body", "enemy", "worker", 2000, 2000);
      oldTarget.cabin = { shipId: "departed-hull" };
      oldTarget.deck = { shipId: "departed-hull", x: 0, y: 0 };
      candidate.units[0]!.order = { type: "attack", targetId: oldTarget.id };
      candidate.units[0]!.cooldown = 0;
    }
    stepGame(game); stepGame(complete);
    expect(snapshotGame(game)).toStrictEqual(snapshotGame(complete));
    expect(archer.order).toEqual({ type: "idle" });
    expect(archer.x).toBe(1000);
    expect(archer.aim).toBeUndefined();
  });
});
