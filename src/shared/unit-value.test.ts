import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import { killXpReward, xpStarThresholds } from "./unit-value";
import { createGame, stepGame } from "./sim";
import type { UnitKind } from "./types";
import { createBuilding } from "./map";

function singleShot(owner: "enemy" | "neutral", kind: UnitKind = "footman", removeTower = false) {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = [createBuilding("home", "player", "townHall", 500, 3000, true), createBuilding("enemy-home", "enemy", "townHall", 3000, 3000, true)]; game.resources = [];
  const tower = createBuilding("tower", "player", "defenseTower", 800, 800, true);
  const target = game.spawnUnit(owner, kind, 1000, 800);
  target.order = { type: "hold", x: target.x, y: target.y }; target.attackDamage = 0;
  game.buildings.push(tower);
  stepGame(game);
  tower.cooldown = 1000;
  if (removeTower) game.buildings = game.buildings.filter(building => building.id !== tower.id);
  for (let i = 0; i < 20; i++) stepGame(game);
  return target.maxHp - target.hp;
}

describe("unit value and veteran rewards", () => {
  it("charges expensive units more XP while valuing their defeat more highly", () => {
    expect(xpStarThresholds(UNIT_DEFS.footman)).toEqual([60, 130, 260]);
    expect(xpStarThresholds(UNIT_DEFS.knight)).toEqual([114, 247, 494]);
    expect(xpStarThresholds(UNIT_DEFS.catapult)).toEqual([234, 507, 1014]);
    expect(UNIT_DEFS.footman.xpReward).toBe(33);
    expect(UNIT_DEFS.catapult.xpReward).toBe(130);
    expect(killXpReward(UNIT_DEFS.catapult, 3)).toBe(260);
    expect(killXpReward(UNIT_DEFS.spirit, 3)).toBe(0);
  });
  it("pays larger and more dangerous camps more gold", () => {
    expect(UNIT_DEFS.mossGnawer.goldBounty).toBe(20);
    expect(UNIT_DEFS.ancientStag.goldBounty).toBe(130);
    expect(UNIT_DEFS.redDragon.goldBounty).toBe(310);
    expect(UNIT_DEFS.venomSpider.goldBounty).toBeGreaterThan(UNIT_DEFS.thornSlinger.goldBounty!);
  });
  it("halves tower damage only against neutrals, including shots from a destroyed tower", () => {
    expect(singleShot("enemy")).toBe(16);
    expect(singleShot("neutral")).toBe(8);
    expect(singleShot("neutral", "footman", true)).toBe(8);
    expect(singleShot("enemy", "golem")).toBe(11);
    expect(singleShot("neutral", "golem")).toBe(6);
  });
  it("credits one tower last-hit bounty and one readable gold effect", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.buildings = [createBuilding("home", "player", "townHall", 500, 3000, true), createBuilding("enemy-home", "enemy", "townHall", 3000, 3000, true)]; game.resources = [];
    game.players.player.gold = 0;
    const tower = createBuilding("tower", "player", "defenseTower", 800, 800, true);
    const creep = game.spawnUnit("neutral", "mossGnawer", 1000, 800);
    creep.hp = 1; creep.order = { type: "hold", x: creep.x, y: creep.y };
    game.buildings.push(tower);
    for (let i = 0; i < 15; i++) stepGame(game);
    expect(game.players.player.gold).toBe(20);
    expect(game.match.stats.neutralUnitsKilled.player).toBe(1);
    expect(game.effects.filter(effect => effect.type === "goldBounty")).toEqual([
      expect.objectContaining({ x: 1000, y: 800, amount: 20, owner: "player" }),
    ]);
  });
});
