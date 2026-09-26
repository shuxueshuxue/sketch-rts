import { describe, expect, it } from "vitest";
import { abilityCooldown } from "./ability-cooldowns";
import { ABILITY_DEFS, UNIT_DEFS, type AbilityDef } from "./catalog";
import { createGame, issueCommand, issuePlayerCommand, snapshotGame, stepGame } from "./sim";
import { checkCommandLegality } from "./sim/command-validation";
import type { Unit } from "./types";

const CHARGE = ABILITY_DEFS.charge as Extract<AbilityDef, { behavior: "charge" }>;

function duel() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  return game;
}

function steps(game: ReturnType<typeof duel>, ticks: number) {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
}

// The rider's blow on a footman, doubled: what a charge takes off it.
function chargeBlow(rider: Unit) {
  return Math.round(rider.attackDamage * CHARGE.damageMultiplier);
}

describe("cavalry charge", () => {
  it("is the raider's and the knight's", () => {
    expect(UNIT_DEFS.raider.abilities).toContain("charge");
    expect(UNIT_DEFS.knight.abilities).toContain("charge");
  });

  it("dashes at a unit inside the window, strikes it for twice a blow, and fights on", () => {
    const game = duel();
    const raider = game.spawnUnit("player", "raider", 500, 500);
    const footman = game.spawnUnit("enemy", "footman", 900, 500);
    issueCommand(game, { type: "setAutocast", unitIds: [raider.id], ability: "charge", enabled: false });
    issueCommand(game, { type: "cast", unitId: raider.id, ability: "charge", targetId: footman.id });
    expect(raider.order.type).toBe("charge");
    expect(game.effects.some((effect) => effect.type === "chargeTrail" && effect.unitId === raider.id)).toBe(true);
    // 400 away at 30 a tick: on it well inside a second, far sooner than it could ride there.
    steps(game, 16);
    expect(footman.hp).toBe(footman.maxHp - chargeBlow(raider));
    expect(Math.hypot(raider.x - footman.x, raider.y - footman.y)).toBeLessThanOrEqual(raider.attackRange);
    expect(raider.order).toMatchObject({ type: "attack", targetId: footman.id });
    expect(abilityCooldown(raider, "charge")).toBeGreaterThan(CHARGE.cooldown - 20);
    expect(game.effects.some((effect) => effect.type === "chargeImpact")).toBe(true);
  });

  it("only charges a unit from 300 to 500 away", () => {
    for (const gap of [250, 550]) {
      const game = duel();
      const raider = game.spawnUnit("player", "raider", 500, 500);
      const footman = game.spawnUnit("enemy", "footman", 500 + gap, 500);
      const command = { type: "cast", unitId: raider.id, ability: "charge", targetId: footman.id } as const;
      expect(checkCommandLegality(snapshotGame(game), "player", command)).toMatchObject({ message: expect.stringContaining("300 to 500") });
      expect(() => issueCommand(game, command)).toThrow(/300 to 500/);
    }
  });

  it("charges on its own an enemy that comes inside the window, and not once switched off", () => {
    const charged = (autocast: boolean) => {
      const game = duel();
      const raider = game.spawnUnit("player", "raider", 500, 500);
      const footman = game.spawnUnit("enemy", "footman", 920, 500);
      if (!autocast) issueCommand(game, { type: "setAutocast", unitIds: [raider.id], ability: "charge", enabled: false });
      steps(game, 24);
      return footman.maxHp - footman.hp;
    };
    expect(charged(true)).toBeGreaterThanOrEqual(chargeBlow({ attackDamage: UNIT_DEFS.raider.attackDamage } as Unit));
    expect(charged(false)).toBe(0);
  });

  it("spreads a line's charges over the enemies inside the window instead of piling onto the nearest", () => {
    const game = duel();
    const riders = [0, 1, 2, 3].map((index) => game.spawnUnit("player", "raider", 500, 440 + index * 40));
    const foes = [0, 1, 2, 3].map((index) => game.spawnUnit("enemy", "footman", 900 + index * 10, 440 + index * 40));
    steps(game, 2);
    const targets = riders.map((rider) => (rider.order.type === "charge" ? rider.order.targetId : undefined));
    expect(targets.every((target) => target !== undefined)).toBe(true);
    expect(new Set(targets).size).toBe(foes.length);
  });

  it("does not charge a creep minding its camp, nor while riding where it was told", () => {
    const creep = duel();
    const rider = creep.spawnUnit("player", "raider", 500, 500);
    creep.spawnUnit("neutral", "wildling", 900, 500);
    steps(creep, 20);
    expect(rider.order.type).not.toBe("charge");
    expect(abilityCooldown(rider, "charge")).toBe(0);

    const moving = duel();
    const passer = moving.spawnUnit("player", "raider", 500, 500);
    moving.spawnUnit("enemy", "footman", 900, 700);
    issueCommand(moving, { type: "move", unitIds: [passer.id], x: 900, y: 300 });
    steps(moving, 20);
    expect(abilityCooldown(passer, "charge")).toBe(0);
  });

  it("finishes the dash before an order given during it", () => {
    const game = duel();
    const knight = game.spawnUnit("player", "knight", 500, 500);
    const footman = game.spawnUnit("enemy", "footman", 900, 500);
    issueCommand(game, { type: "cast", unitId: knight.id, ability: "charge", targetId: footman.id });
    steps(game, 2);
    issueCommand(game, { type: "move", unitIds: [knight.id], x: 200, y: 200 });
    expect(knight.order.type).toBe("charge");
    steps(game, 16);
    expect(footman.hp).toBe(footman.maxHp - chargeBlow(knight));
    expect(knight.order).toMatchObject({ type: "move", x: 200, y: 200 });
  });

  it("lets the enemy's rider charge too", () => {
    const game = duel();
    const raider = game.spawnUnit("enemy", "raider", 500, 500);
    const footman = game.spawnUnit("player", "footman", 900, 500);
    issuePlayerCommand(game, "enemy", { type: "cast", unitId: raider.id, ability: "charge", targetId: footman.id });
    steps(game, 16);
    expect(footman.hp).toBeLessThan(footman.maxHp);
  });
});
