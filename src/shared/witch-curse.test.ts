import { describe, expect, it } from "vitest";
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
    expect(witch.cooldown).toBeGreaterThan(ABILITY_DEFS.curse.cooldown - 5);
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
