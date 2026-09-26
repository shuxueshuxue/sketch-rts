import { describe, expect, it } from "vitest";
import { abilityCooldown } from "./ability-cooldowns";
import { ABILITY_DEFS } from "./catalog";
import { createGame, issueCommand, stepGame } from "./sim";

function duel() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  return game;
}

describe("witch curse", () => {
  it("kills a summoned spirit outright: 100 damage on top of the curse", () => {
    const game = duel();
    const witch = game.spawnUnit("player", "witch", 500, 500);
    const spirit = game.spawnUnit("enemy", "spirit", 700, 500);
    spirit.expiresTick = game.tick + 1_000;
    issueCommand(game, { type: "cast", unitId: witch.id, ability: "curse", targetId: spirit.id });
    stepGame(game);
    expect(game.units.some((unit) => unit.id === spirit.id)).toBe(false);
    expect(abilityCooldown(witch, "curse")).toBeGreaterThan(ABILITY_DEFS.curse.cooldown - 5);
  });

  it("casts while its weapon is cooling down, and the cast leaves the weapon to its own cooldown", () => {
    const game = duel();
    const witch = game.spawnUnit("player", "witch", 500, 500);
    const raider = game.spawnUnit("enemy", "raider", 700, 500);
    // The staff has just swung.
    witch.cooldown = witch.attackCooldown;
    issueCommand(game, { type: "cast", unitId: witch.id, ability: "curse", targetId: raider.id });
    stepGame(game);
    expect(raider.effects.some((effect) => effect.type === "curse")).toBe(true);
    expect(witch.cooldown).toBe(witch.attackCooldown - 1);
    // Told to attack, the staff swings again once its own cooldown is out (the bolt still has to fly), long before the curse is back.
    issueCommand(game, { type: "attack", unitIds: [witch.id], targetId: raider.id });
    const before = raider.hp;
    for (let tick = 0; tick < witch.attackCooldown + 30; tick += 1) stepGame(game);
    expect(raider.hp).toBeLessThan(before);
    expect(abilityCooldown(witch, "curse")).toBeGreaterThan(0);
  });

  it("only curses a unit that was not summoned", () => {
    const game = duel();
    const witch = game.spawnUnit("player", "witch", 500, 500);
    const footman = game.spawnUnit("enemy", "footman", 700, 500);
    issueCommand(game, { type: "cast", unitId: witch.id, ability: "curse", targetId: footman.id });
    stepGame(game);
    expect(footman.hp).toBe(footman.maxHp);
    expect(footman.effects).toContainEqual(expect.objectContaining({ type: "curse" }));
  });
});
