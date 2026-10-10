import { describe, expect, it } from "vitest";
import { SUPPORT_BUILDING_HEAL, UNIT_DEFS } from "../catalog";
import { createBuilding, createUnit } from "../map";
import { createGame, issuePlayerCommand, refreshUnitStats, restoreSnapshotIntoGame, snapshotGame, stepGame } from "../sim";
import { xpStarThresholds } from "../unit-value";
import { checksumGame } from "./checksum";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.resources = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}

function restingFighter(id: string, x: number, y: number) {
  const unit = createUnit(id, "player", "footman", x, y);
  unit.hp -= 40;
  unit.cooldown = 9999;
  unit.order = { type: "hold", x, y };
  return unit;
}

describe("spatial queries across simulation frames", () => {
  it("heals using live positions within a cell and after crossing into or out of nearby cells", () => {
    const game = scene();
    const well = createBuilding("well", "player", "moonWell", 300, 300, true);
    const target = restingFighter("target", 400, 300);
    game.buildings.push(well); game.units.push(target);
    const initial = target.hp;
    stepGame(game);
    expect(target.hp).toBe(initial + SUPPORT_BUILDING_HEAL);
    // Both 400 and 600 are in cell 1; the actual range test must see the move.
    target.x = 600; well.cooldown = 0;
    stepGame(game);
    expect(target.hp).toBe(initial + SUPPORT_BUILDING_HEAL);
    target.x = 1000; well.cooldown = 0;
    stepGame(game);
    expect(target.hp).toBe(initial + SUPPORT_BUILDING_HEAL);
    target.x = 319; well.cooldown = 0;
    stepGame(game);
    expect(target.hp).toBe(initial + 2 * SUPPORT_BUILDING_HEAL);
  });

  it("heals the current body after a same-length in-place replacement with the same ID and cell", () => {
    const game = scene();
    const well = createBuilding("well", "player", "moonWell", 300, 300, true);
    const original = restingFighter("target", 400, 300);
    game.buildings.push(well); game.units.push(original);
    stepGame(game);
    const detachedHp = original.hp;
    const replacement = restingFighter(original.id, original.x, original.y);
    replacement.hp -= 20;
    const initial = replacement.hp;
    game.units.splice(0, 1, replacement);
    well.cooldown = 0;
    stepGame(game);
    expect(replacement.hp).toBe(initial + SUPPORT_BUILDING_HEAL);
    expect(original.hp).toBe(detachedHp);
  });

  it("includes a newly trained wounded target in the same tick's healing phase", () => {
    const game = scene();
    const well = createBuilding("well", "player", "moonWell", 300, 300, true);
    const barracks = createBuilding("barracks", "player", "barracks", 440, 300, true);
    barracks.rallyX = well.x; barracks.rallyY = well.y;
    game.buildings.push(well, barracks);
    game.units.push(restingFighter("distant", 2000, 300));
    stepGame(game);
    const spawn = game.spawnUnit.bind(game);
    game.spawnUnit = (...args) => {
      const unit = spawn(...args);
      // Isolate healing of a body created between the two index refreshes.
      unit.hp -= 40;
      return unit;
    };
    barracks.queue.push({ unitKind: "footman", remaining: 1 });
    well.cooldown = 0;
    stepGame(game);
    const trained = game.units.find(unit => unit.id !== "distant")!;
    expect(barracks.queue).toHaveLength(0);
    expect(trained.hp).toBe(trained.maxHp - 40 + SUPPORT_BUILDING_HEAL);
  });

  it("keeps combat and position sequences identical to freshly rebuilt indexes through reordering, death and restore", () => {
    const game = scene();
    const leader = game.spawnUnit("player", "footman", 350, 220);
    const fighter = game.spawnUnit("player", "footman", 400, 300);
    const foe = game.spawnUnit("enemy", "footman", 600, 300);
    leader.level = 3;
    leader.xp = xpStarThresholds(UNIT_DEFS.footman)[2]!;
    refreshUnitStats(game, leader);
    leader.veteranSkillChoices = ["veteranResilience", "veteranMobility", "veteranCommand"];
    issuePlayerCommand(game, "player", { type: "learnVeteranSkill", unitId: leader.id, skill: "veteranCommand" });
    issuePlayerCommand(game, "player", { type: "holdPosition", unitIds: [leader.id] });
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [fighter.id], targetId: foe.id });
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [foe.id], targetId: fighter.id });
    const fresh = scene();
    restoreSnapshotIntoGame(fresh, snapshotGame(game), game.nextId);
    let freshIndex = fresh.unitSpatial;
    // Untracked structural copies force rebuilding at all three refreshes;
    // actual queries retain the same freshly built buckets and visit order.
    Object.defineProperty(fresh, "unitSpatial", {
      configurable: true,
      get: () => freshIndex && { ...freshIndex },
      set: (index: typeof freshIndex) => { freshIndex = index; },
    });
    for (let tick = 0; tick < 64; tick += 1) {
      if (tick === 16) { game.units.reverse(); fresh.units.reverse(); }
      if (tick === 40) {
        expect(foe.hp).toBeLessThan(foe.maxHp);
        foe.hp = 0;
        fresh.units.find(unit => unit.id === foe.id)!.hp = 0;
      }
      if (tick === 48) restoreSnapshotIntoGame(game, snapshotGame(game), game.nextId);
      stepGame(game); stepGame(fresh);
      expect(checksumGame(game)).toBe(checksumGame(fresh));
    }
    expect(game.units.some(unit => unit.id === foe.id)).toBe(false);
  });
});
