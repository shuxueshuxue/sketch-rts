import { describe, expect, it } from "vitest";
import { createGame, stepGame } from "../sim";

describe("unit update birth timing", () => {
  it.each([false, true])("starts an automatically summoned unit on the next tick (fleet present: %s)", fleet => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.buildings = []; game.resources = []; game.items = [];
    game.scriptedVictory = true;
    delete game.map.terrain;
    if (fleet) {
      const ship = game.spawnUnit("player", "transport", 2000, 2000);
      ship.order = { type: "hold", x: ship.x, y: ship.y };
    }
    const caster = game.spawnUnit("player", "summoner", 1000, 1000);
    caster.order = { type: "hold", x: caster.x, y: caster.y };
    const foe = game.spawnUnit("enemy", "worker", 1250, 1000);
    foe.order = { type: "hold", x: foe.x, y: foe.y };
    const spawn = game.spawnUnit.bind(game);
    game.spawnUnit = (...args) => {
      const unit = spawn(...args);
      // A born cooldown exposes whether the birth tick incorrectly consumes
      // an additional unit update, independently of target acquisition.
      if (unit.kind === "spirit") unit.cooldown = 7;
      return unit;
    };
    game.tick = 1; // Automatic abilities are considered on even ticks.
    stepGame(game);
    const spirit = game.units.find(unit => unit.kind === "spirit")!;
    expect(spirit).toBeDefined();
    expect([spirit.x, spirit.y]).toEqual([1060, 1000]);
    expect(spirit.order.type).toBe("idle");
    expect(spirit.cooldown).toBe(7);
    expect(caster.abilityCooldowns?.summon).toBeGreaterThan(0);

    stepGame(game);
    expect(spirit.order).toMatchObject({ type: "attack", targetId: foe.id });
    expect(spirit.cooldown).toBe(6);
    stepGame(game);
    expect(spirit.x).toBeGreaterThan(1060);
    expect(spirit.cooldown).toBe(5);
  });
});
