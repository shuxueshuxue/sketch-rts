import { describe, expect, it } from "vitest";
import { abilityCooldown } from "./ability-cooldowns";
import { autocastEnabled, withAutocast } from "./autocast";
import { ABILITY_DEFS, ABILITY_KINDS } from "./catalog";
import { isGameCommand } from "./command-schema";
import { createGame, issueCommand, snapshotGame, stepGame } from "./sim";
import { checkCommandLegality } from "./sim/command-validation";
import type { GameCommand } from "./types";

function duel() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  return game;
}

function steps(game: ReturnType<typeof duel>, ticks: number) {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
}

describe("autocast", () => {
  it("starts on for every unit ability, and keeps only what the player switched away from that", () => {
    for (const ability of ABILITY_KINDS) expect(ABILITY_DEFS[ability].autocast).toBe("on");
    const priest = { kind: "priest" as const };
    expect(autocastEnabled(priest, "heal")).toBe(true);
    expect(autocastEnabled(priest, "curse")).toBe(false);
    const off = withAutocast({}, "heal", false);
    expect(off).toEqual({ heal: false });
    expect(autocastEnabled({ kind: "priest", autocast: { heal: false } }, "heal")).toBe(false);
    expect(withAutocast({ autocast: { heal: false } }, "heal", true)).toBeUndefined();
  });

  it("switches a unit's ability off and on by command, only for units that have it", () => {
    const game = duel();
    const priest = game.spawnUnit("player", "priest", 500, 500);
    const footman = game.spawnUnit("player", "footman", 540, 500);
    const command: Extract<GameCommand, { type: "setAutocast" }> = { type: "setAutocast", unitIds: [priest.id, footman.id], ability: "heal", enabled: false };
    expect(isGameCommand(command)).toBe(true);
    expect(checkCommandLegality(snapshotGame(game), "player", command)).toBeUndefined();
    issueCommand(game, command);
    expect(priest.autocast).toEqual({ heal: false });
    expect(footman.autocast).toBeUndefined();
    expect(snapshotGame(game).units.find((unit) => unit.id === priest.id)?.autocast).toEqual({ heal: false });
    issueCommand(game, { ...command, enabled: true });
    expect(priest.autocast).toBeUndefined();
    expect(checkCommandLegality(snapshotGame(game), "player", { ...command, unitIds: [footman.id] })).toMatchObject({ message: expect.stringContaining("heal") });
  });

  it("heals the ally missing the most health, and not with heal switched off", () => {
    const healed = (on: boolean) => {
      const game = duel();
      const priest = game.spawnUnit("player", "priest", 500, 500);
      const light = game.spawnUnit("player", "footman", 560, 500);
      const heavy = game.spawnUnit("player", "footman", 500, 560);
      light.hp -= 40;
      heavy.hp -= 100;
      if (!on) issueCommand(game, { type: "setAutocast", unitIds: [priest.id], ability: "heal", enabled: false });
      steps(game, 4);
      return { light: light.maxHp - light.hp, heavy: heavy.maxHp - heavy.hp, ready: abilityCooldown(priest, "heal") === 0 };
    };
    expect(healed(true)).toEqual({ light: 40, heavy: 100 - 55, ready: false });
    expect(healed(false)).toEqual({ light: 40, heavy: 100, ready: true });
  });

  it("does not heal a scratch", () => {
    const game = duel();
    const priest = game.spawnUnit("player", "priest", 500, 500);
    const footman = game.spawnUnit("player", "footman", 560, 500);
    footman.hp -= 10;
    steps(game, 4);
    expect(abilityCooldown(priest, "heal")).toBe(0);
  });

  it("curses a fighting enemy, a summoned one first, and leaves a creep minding its camp alone", () => {
    const game = duel();
    const witch = game.spawnUnit("player", "witch", 500, 500);
    const footman = game.spawnUnit("enemy", "footman", 700, 500);
    const spirit = game.spawnUnit("enemy", "spirit", 700, 560);
    spirit.expiresTick = game.tick + 1_000;
    const ally = game.spawnUnit("player", "footman", 740, 520);
    footman.order = { type: "attack", targetId: ally.id };
    spirit.order = { type: "attack", targetId: ally.id };
    steps(game, 2);
    expect(game.units.some((unit) => unit.id === spirit.id)).toBe(false);
    expect(abilityCooldown(witch, "curse")).toBeGreaterThan(0);

    const camp = duel();
    const lone = camp.spawnUnit("player", "witch", 500, 500);
    camp.spawnUnit("neutral", "wildling", 700, 500);
    steps(camp, 6);
    expect(abilityCooldown(lone, "curse")).toBe(0);
  });

  it("summons a spirit when an enemy player's unit comes near and none stands beside the summoner", () => {
    const game = duel();
    const summoner = game.spawnUnit("player", "summoner", 500, 500);
    game.spawnUnit("enemy", "footman", 800, 500);
    steps(game, 4);
    expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "spirit")).toHaveLength(1);
    expect(abilityCooldown(summoner, "summon")).toBeGreaterThan(0);
  });

  it("casts nothing under a move the player gave", () => {
    const game = duel();
    const priest = game.spawnUnit("player", "priest", 500, 500);
    const footman = game.spawnUnit("player", "footman", 560, 500);
    footman.hp -= 100;
    issueCommand(game, { type: "move", unitIds: [priest.id], x: 900, y: 500 });
    steps(game, 4);
    expect(abilityCooldown(priest, "heal")).toBe(0);
  });
});
