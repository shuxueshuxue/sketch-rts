import { describe, expect, it } from "vitest";
import { engagedEntityIds, healthBarColor, shouldShowHealthBar } from "./health-bars";
import { createGame } from "../shared/sim";

describe("health bar visibility", () => {
  it("hides an idle full-health entity and shows every amount of injury", () => {
    expect(shouldShowHealthBar({ hp: 100, maxHp: 100 })).toBe(false);
    expect(shouldShowHealthBar({ hp: 99, maxHp: 100 })).toBe(true);
    for (const flag of ["selected", "hovered", "engaged", "constructing"]) {
      expect(shouldShowHealthBar({ hp: 100, maxHp: 100, [flag]: true })).toBe(true);
    }
    expect(shouldShowHealthBar({ hp: 50, maxHp: 100, still: true, selected: true })).toBe(false);
    expect(shouldShowHealthBar({ hp: 0, maxHp: 100, selected: true })).toBe(false);
  });
  it("distinguishes healthy, wounded and critical health", () => {
    expect(new Set([healthBarColor(100, 100), healthBarColor(50, 100), healthBarColor(25, 100)]).size).toBe(3);
  });
  it("keeps selected, damaged and fighting hulls clear while retaining ordinary crew bars", () => {
    for (const flag of ["selected", "hovered", "engaged"]) {
      expect(shouldShowHealthBar({ hp: 20, maxHp: 180, shipHull: true, [flag]: true })).toBe(false);
      expect(shouldShowHealthBar({ hp: 20, maxHp: 80, [flag]: true })).toBe(true);
    }
  });
  it("shows both sides of a close fight without marking a long march as combat", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.buildings = [];
    const ally = game.spawnUnit("player", "footman", 800, 800);
    const enemy = game.spawnUnit("enemy", "footman", 860, 800);
    ally.order = { type: "attack", targetId: enemy.id };
    expect(engagedEntityIds(game)).toEqual(new Set([ally.id, enemy.id]));
    enemy.x = 2000;
    expect(engagedEntityIds(game).size).toBe(0);
  });
});
