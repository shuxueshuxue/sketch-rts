import { describe, expect, it } from "vitest";
import { createBuilding } from "../map";
import { createGame, issuePlayerCommand, stepGame } from "../sim";

function scene(type: "attack" | "attackMove") {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  const farm = createBuilding("old-target", "enemy", "farm", 1050, 1000, true);
  game.buildings.push(farm);
  const guard = game.spawnUnit("player", "footman", 1000, 1000);
  guard.order = type === "attack"
    ? { type, targetId: farm.id, leashX: 1000, leashY: 1000 }
    : { type, targetId: farm.id, x: 1800, y: 1000 };
  const threat = game.spawnUnit("enemy", "footman", 1100, 1000);
  // A live combatant outranks the farm without damage-triggered aggro
  // deciding the target for us. Reconsideration must come from the order.
  threat.order = { type: "hold", x: threat.x, y: threat.y };
  threat.cooldown = 9999;
  return { game, guard, farm, threat };
}

describe("automatic combat orders between shots", () => {
  it("keeps cooling-down automatic orders and their queued destination despite a better target", () => {
    for (const type of ["attack", "attackMove"] as const) {
      const { game, guard, farm, threat } = scene(type);
      guard.cooldown = 8;
      issuePlayerCommand(game, "player", { type: "move", unitIds: [guard.id], x: 2000, y: 1000, queued: true });
      const order = guard.order, queued = guard.orderQueue![0], farmHp = farm.hp, threatHp = threat.hp;
      for (let tick = 0; tick < 4; tick += 1) stepGame(game);
      expect(guard.order).toBe(order);
      expect(guard.order).toMatchObject({ type, targetId: farm.id });
      expect(guard.cooldown).toBe(4);
      expect(guard.orderQueue).toHaveLength(1);
      expect(guard.orderQueue![0]).toBe(queued);
      expect(farm.hp).toBe(farmHp);
      expect(threat.hp).toBe(threatHp);
    }
  });

  it("reconsiders ready automatic orders and actually strikes the better target without changing their intent", () => {
    for (const type of ["attack", "attackMove"] as const) {
      const { game, guard, farm, threat } = scene(type);
      guard.cooldown = 1;
      const original = guard.order, farmHp = farm.hp, threatHp = threat.hp;
      stepGame(game);
      expect(guard.order).not.toBe(original);
      expect(original).toMatchObject({ type, targetId: farm.id });
      expect(guard.order).toEqual(type === "attack"
        ? { type, targetId: threat.id, leashX: 1000, leashY: 1000 }
        : { type, targetId: threat.id, x: 1800, y: 1000 });
      expect(guard.x).toBeGreaterThan(1000);
      for (let tick = 0; tick < 40 && threat.hp === threatHp; tick += 1) stepGame(game);
      expect(threat.hp).toBeLessThan(threatHp);
      expect(farm.hp).toBe(farmHp);
      expect(guard.order).toMatchObject({ type, targetId: threat.id });
    }
  });

  it("keeps an explicit attack on the farm even when a better live combatant is available", () => {
    const { game, guard, farm, threat } = scene("attack");
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [guard.id], targetId: farm.id });
    guard.cooldown = 1;
    const order = guard.order, farmHp = farm.hp, threatHp = threat.hp;
    stepGame(game);
    expect(guard.order).toBe(order);
    expect(guard.order).toEqual({ type: "attack", targetId: farm.id });
    expect(farm.hp).toBeLessThan(farmHp);
    expect(threat.hp).toBe(threatHp);
  });

  it("finishes an attack whose target disappeared, then activates the queued move on the following tick", () => {
    const { game, guard, farm } = scene("attack");
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [guard.id], targetId: farm.id });
    issuePlayerCommand(game, "player", { type: "move", unitIds: [guard.id], x: 2000, y: 1000, queued: true });
    const queued = guard.orderQueue![0];
    game.buildings = [];
    stepGame(game);
    expect(guard.order).toEqual({ type: "idle" });
    expect(guard.x).toBe(1000);
    expect(guard.orderQueue![0]).toBe(queued);
    stepGame(game);
    expect(guard.order).toBe(queued);
    expect(guard.order).toEqual({ type: "move", x: 2000, y: 1000 });
    expect(guard.orderQueue).toHaveLength(0);
    expect(guard.x).toBeGreaterThan(1000);
  });

  it("reacquires after an attack-move target disappears while preserving the destination and queued order", () => {
    const { game, guard, threat } = scene("attackMove");
    guard.cooldown = 8;
    issuePlayerCommand(game, "player", { type: "move", unitIds: [guard.id], x: 2000, y: 1000, queued: true });
    const queued = guard.orderQueue![0], threatHp = threat.hp;
    game.buildings = [];
    stepGame(game);
    expect(guard.order).toEqual({ type: "attackMove", targetId: threat.id, x: 1800, y: 1000 });
    expect(guard.x).toBeGreaterThan(1000);
    expect(threat.hp).toBe(threatHp);
    expect(guard.orderQueue).toHaveLength(1);
    expect(guard.orderQueue![0]).toBe(queued);
  });
});
