import { describe, expect, it } from "vitest";
import { SUPPORT_BUILDING_HEAL } from "../catalog";
import { createBuilding, createUnit } from "../map";
import { createGame, stepGame } from "../sim";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.resources = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}

describe("spatial membership storage transfer", () => {
  it("rebuilds an older unit index after its metadata storage moved to another index", () => {
    const game = scene();
    const well = createBuilding("well", "player", "moonWell", 300, 300, true);
    const patient = createUnit("patient", "player", "footman", 400, 300);
    patient.hp -= 60; patient.cooldown = 9999;
    patient.order = { type: "hold", x: 400, y: 300 };
    game.buildings.push(well); game.units.push(patient);
    stepGame(game);
    const olderIndex = game.unitSpatial!;
    patient.x = well.x = 1000; well.cooldown = 0;
    stepGame(game);
    expect(game.unitSpatial).not.toBe(olderIndex);
    const hp = patient.hp;
    game.unitSpatial = olderIndex;
    well.cooldown = 0;
    stepGame(game);
    expect(patient.hp).toBe(hp + SUPPORT_BUILDING_HEAL);
    expect(game.unitSpatial).not.toBe(olderIndex);
  });

  it("rebuilds older team buckets before a held fighter acquires an enemy in a different cell", () => {
    const game = scene();
    const fighter = createUnit("fighter", "player", "footman", 1000, 1000);
    const enemy = createUnit("enemy", "enemy", "footman", 400, 1000);
    for (const unit of [fighter, enemy]) {
      unit.cooldown = 9999;
      unit.order = { type: "hold", x: unit.x, y: unit.y };
    }
    game.units.push(fighter, enemy);
    stepGame(game);
    const olderTeams = game.unitSpatialByTeam!;
    enemy.x = 1040;
    stepGame(game);
    expect(game.unitSpatialByTeam).not.toBe(olderTeams);
    const hp = enemy.hp;
    game.unitSpatialByTeam = olderTeams;
    fighter.cooldown = 0;
    stepGame(game);
    expect(enemy.hp).toBeLessThan(hp);
    expect(game.unitSpatialByTeam).not.toBe(olderTeams);
  });
});
