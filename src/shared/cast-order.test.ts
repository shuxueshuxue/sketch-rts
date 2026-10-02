import { describe, expect, it } from "vitest";
import { abilityCooldown } from "./ability-cooldowns";
import { ABILITY_DEFS } from "./catalog";
import { createGame, issueCommand, stepGame } from "./sim";
import type { Unit } from "./types";

// @@@cast-order: a spell cast out of reach is walked to and cast on arrival; its unit gone on the way, the caster idles.
function duel() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  return game;
}

function stepUntil(game: ReturnType<typeof duel>, maxTicks: number, predicate: () => boolean) {
  for (let i = 0; i < maxTicks && !predicate(); i += 1) stepGame(game);
  return predicate();
}

function gap(a: Unit, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const FAR = 700;

describe("casting out of reach", () => {
  it("walks a priest to a far wounded ally, heals it in range, then stands idle", () => {
    const game = duel();
    const priest = game.spawnUnit("player", "priest", 500, 500);
    const hurt = game.spawnUnit("player", "footman", 500 + FAR, 500);
    hurt.hp = 40;
    issueCommand(game, { type: "cast", unitId: priest.id, ability: "heal", targetId: hurt.id });
    expect(priest.order).toMatchObject({ type: "cast", ability: "heal", targetId: hurt.id });
    expect(hurt.hp).toBe(40);

    expect(stepUntil(game, 400, () => hurt.hp > 40)).toBe(true);
    expect(priest.x).toBeGreaterThan(500);
    expect(gap(priest, hurt)).toBeLessThanOrEqual(ABILITY_DEFS.heal.range);
    expect(abilityCooldown(priest, "heal")).toBeGreaterThan(0);
    expect(priest.order.type).toBe("idle");
  });

  it("walks a witch to a far enemy and curses it in range", () => {
    const game = duel();
    const witch = game.spawnUnit("player", "witch", 500, 500);
    const foe = game.spawnUnit("enemy", "footman", 500 + FAR, 500);
    issueCommand(game, { type: "cast", unitId: witch.id, ability: "curse", targetId: foe.id });
    expect(witch.order.type).toBe("cast");

    expect(stepUntil(game, 400, () => foe.effects.some((effect) => effect.type === "curse"))).toBe(true);
    expect(gap(witch, foe)).toBeLessThanOrEqual(ABILITY_DEFS.curse.range);
    expect(witch.order.type).toBe("idle");
  });

  it("walks a summoner toward a far point and summons there once in range", () => {
    const game = duel();
    const summoner = game.spawnUnit("player", "summoner", 500, 500);
    const point = { x: 500 + FAR, y: 520 };
    issueCommand(game, { type: "cast", unitId: summoner.id, ability: "summon", ...point });
    expect(summoner.order.type).toBe("cast");

    const spirit = () => game.units.find((unit) => unit.kind === "spirit");
    expect(stepUntil(game, 400, () => spirit() !== undefined)).toBe(true);
    expect(spirit()).toMatchObject(point);
    expect(gap(summoner, point)).toBeLessThanOrEqual(ABILITY_DEFS.summon.range);
    expect(summoner.order.type).toBe("idle");
  });

  it("rides a knight up to a far enemy until it is inside the window, then charges it", () => {
    const game = duel();
    const knight = game.spawnUnit("player", "knight", 500, 500);
    const foe = game.spawnUnit("enemy", "footman", 500 + FAR, 500);
    const charge = ABILITY_DEFS.charge;
    if (charge.behavior !== "charge") throw new Error("charge is not a charge");
    issueCommand(game, { type: "cast", unitId: knight.id, ability: "charge", targetId: foe.id });
    expect(knight.order.type).toBe("cast");

    let from = 0;
    expect(
      stepUntil(game, 400, () => {
        if (knight.order.type !== "charge") from = gap(knight, foe);
        return knight.order.type === "charge";
      }),
    ).toBe(true);
    expect(from).toBeGreaterThanOrEqual(charge.minRange);
    expect(from).toBeLessThanOrEqual(charge.range + knight.speed);
    expect(abilityCooldown(knight, "charge")).toBeGreaterThan(0);
    expect(stepUntil(game, 40, () => foe.hp < foe.maxHp)).toBe(true);
  });

  it("still refuses a charge at a unit nearer than the shortest charge", () => {
    const game = duel();
    const knight = game.spawnUnit("player", "knight", 500, 500);
    const foe = game.spawnUnit("enemy", "footman", 600, 500);
    expect(() => issueCommand(game, { type: "cast", unitId: knight.id, ability: "charge", targetId: foe.id })).toThrow("at least");
    expect(knight.order.type).toBe("idle");
  });

  it("idles, spell unspent, when the unit it walks to dies on the way", () => {
    const cases = [
      { kind: "priest", ability: "heal", side: "player" },
      { kind: "witch", ability: "curse", side: "enemy" },
      { kind: "knight", ability: "charge", side: "enemy" },
    ] as const;
    for (const { kind, ability, side } of cases) {
      const game = duel();
      const caster = game.spawnUnit("player", kind, 500, 500);
      const target = game.spawnUnit(side, "footman", 500 + FAR + 300, 500);
      if (side === "player") target.hp = 40;
      issueCommand(game, { type: "cast", unitId: caster.id, ability, targetId: target.id });
      for (let i = 0; i < 20; i += 1) stepGame(game);
      expect(caster.order.type).toBe("cast");
      const walked = caster.x;
      expect(walked).toBeGreaterThan(500);

      target.hp = 0;
      for (let i = 0; i < 3; i += 1) stepGame(game);
      expect(caster.order.type, kind).toBe("idle");
      expect(abilityCooldown(caster, ability), kind).toBe(0);
      for (let i = 0; i < 20; i += 1) stepGame(game);
      expect(caster.x - walked, kind).toBeLessThan(10);
    }
  });

  it("queues a cast after the orders before it on shift, and casts at once within range without it", () => {
    const game = duel();
    const priest = game.spawnUnit("player", "priest", 500, 500);
    const hurt = game.spawnUnit("player", "footman", 650, 500);
    hurt.hp = 40;
    issueCommand(game, { type: "move", unitIds: [priest.id], x: 500, y: 900 });
    issueCommand(game, { type: "cast", unitId: priest.id, ability: "heal", targetId: hurt.id, queued: true });
    expect(priest.order.type).toBe("move");
    expect(priest.orderQueue).toEqual([{ type: "cast", ability: "heal", targetId: hurt.id }]);
    expect(hurt.hp).toBe(40);

    // First the walk to its move's end, then back to the footman to heal it.
    let deepest = priest.y;
    expect(
      stepUntil(game, 600, () => {
        deepest = Math.max(deepest, priest.y);
        return hurt.hp > 40;
      }),
    ).toBe(true);
    expect(deepest).toBeGreaterThan(890);
    expect(gap(priest, hurt)).toBeLessThanOrEqual(ABILITY_DEFS.heal.range);

    const other = game.spawnUnit("player", "priest", 600, 500);
    hurt.hp = 40;
    issueCommand(game, { type: "cast", unitId: other.id, ability: "heal", targetId: hurt.id });
    expect(hurt.hp).toBeGreaterThan(40);
    expect(other.order.type).toBe("idle");
  });
});
