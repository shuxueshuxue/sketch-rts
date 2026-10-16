import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "../catalog";
import { createBuilding, createUnit } from "../map";
import {
  createGame,
  createNativeQueryFrame,
  nativeAutomaticAttackIntent,
  restoreSnapshotIntoGame,
  snapshotGame,
  stepGame,
  type Game,
} from "../sim";
import type { Projectile, Unit } from "../types";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.mercenaryCamps = []; game.projectiles = []; game.effects = [];
  game.shops = []; game.obstacles = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  game.teams.player = "home"; game.teams.enemy = "hostile";
  return game;
}

function holdingFoe(game: Game, x: number, y = 1000) {
  const unit = game.spawnUnit("enemy", "footman", x, y);
  unit.order = { type: "hold", x, y };
  unit.cooldown = 9999;
  return unit;
}

function query(game: Game, unit: Unit) {
  return nativeAutomaticAttackIntent(createNativeQueryFrame(game), unit);
}

function automaticAttack(unit: Unit, targetId: string) {
  unit.order = { type: "attack", targetId, leashX: unit.x, leashY: unit.y };
}

function trackingShot(attacker: Unit, target: Unit): Projectile {
  return {
    id: "pending-finisher", owner: attacker.owner, attackerId: attacker.id, targetId: target.id,
    fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y,
    damage: target.hp + 1, duration: 60, remaining: 60,
  };
}

describe("readonly native automatic attack queries", () => {
  it("uses native team/bucket order for an equal-score tie across 230-wide cells", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    const firstInArray = holdingFoe(game, 1130);
    const firstInBuckets = holdingFoe(game, 870);
    expect(game.units.indexOf(firstInArray)).toBeLessThan(game.units.indexOf(firstInBuckets));
    expect(Math.floor(firstInBuckets.x / 230)).toBeLessThan(Math.floor(firstInArray.x / 230));

    const intent = query(game, guard);
    expect(intent).toMatchObject({ action: "acquire", targetId: firstInBuckets.id, gap: 130, weaponRange: guard.attackRange });
    expect(guard.order).toEqual({ type: "idle" });
    const before = { x: guard.x, y: guard.y };
    stepGame(game);
    expect(guard.order).toMatchObject({ type: "attack", targetId: intent.targetId });
    // Native idle acquisition only sets an order. It does not pursue on this tick.
    expect({ x: guard.x, y: guard.y }).toEqual(before);
  });

  it("keeps a healthy current target while cooling down, then pursues the better target when ready", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    const farm = createBuilding("farm", "enemy", "farm", 1050, 1000, true);
    game.buildings.push(farm);
    const threat = holdingFoe(game, 1100);
    automaticAttack(guard, farm.id);
    guard.cooldown = 8;
    expect(query(game, guard)).toMatchObject({ action: "engage", targetId: farm.id });
    guard.cooldown = 0;
    expect(query(game, guard)).toMatchObject({ action: "pursue", targetId: threat.id, gap: 100 });
    threat.x = 1040;
    expect(query(game, guard)).toMatchObject({ action: "engage", targetId: threat.id, gap: 40 });
    expect(guard.order).toMatchObject({ type: "attack", targetId: farm.id });
  });

  it("retains a ready current target when the candidate improvement does not clear native hysteresis", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    const current = holdingFoe(game, 1110);
    holdingFoe(game, 1100);
    automaticAttack(guard, current.id);
    guard.cooldown = 0;
    expect(query(game, guard)).toMatchObject({ action: "pursue", targetId: current.id, gap: 110 });
    stepGame(game);
    expect(guard.order).toMatchObject({ type: "attack", targetId: current.id });
  });

  it("finishes a missing-target attack without immediately acquiring an available enemy", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    holdingFoe(game, 1130);
    automaticAttack(guard, "missing-target");
    expect(query(game, guard)).toEqual({ action: "none", weaponRange: guard.attackRange });
    expect(guard.order).toMatchObject({ type: "attack", targetId: "missing-target" });
    stepGame(game);
    expect(guard.order).toEqual({ type: "idle" });
  });

  it("replaces a target doomed by a tracking shot despite cooldown, preserving the input order", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    const doomed = holdingFoe(game, 1040);
    const replacement = holdingFoe(game, 1130);
    automaticAttack(guard, doomed.id);
    guard.cooldown = 8;
    game.projectiles.push(trackingShot(guard, doomed));
    const order = guard.order;
    expect(query(game, guard)).toMatchObject({ action: "pursue", targetId: replacement.id, gap: 130 });
    expect(guard.order).toBe(order);
    expect(guard.order).toMatchObject({ targetId: doomed.id });
    stepGame(game);
    expect(guard.order).toMatchObject({ type: "attack", targetId: replacement.id });
  });

  it("does not treat a physical projectile as guaranteed tracking damage", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    const current = holdingFoe(game, 1040);
    holdingFoe(game, 1130);
    automaticAttack(guard, current.id);
    guard.cooldown = 8;
    game.projectiles.push({ ...trackingShot(guard, current), weapon: UNIT_DEFS.ballista.weapon! });
    expect(game.projectiles[0]!.weapon).toBeDefined();
    expect(query(game, guard)).toMatchObject({ action: "engage", targetId: current.id });
  });

  it("re-resolves native replacement IDs through a stale live entity lookup before judging pursuit", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    guard.cooldown = 9999; // Keep setup index-refresh ticks free of a hold-order strike.
    const doomed = holdingFoe(game, 1080);
    const original = holdingFoe(game, 1600);
    guard.order = { type: "hold", x: guard.x, y: guard.y };
    stepGame(game); // Native creates the ID lookup with the original distant body.
    const replacement = createUnit(original.id, original.owner, original.kind, 960, 1000);
    replacement.order = { type: "hold", x: replacement.x, y: replacement.y };
    replacement.cooldown = 9999;
    game.units[game.units.indexOf(original)] = replacement;
    stepGame(game); // Native refreshes spatial membership, retaining the same-count ID cache.
    expect(game.entityById!.get(original.id)).toBe(original);
    expect([...game.unitSpatialByTeam!.get("hostile")!.buckets.values()].flat()).toContain(replacement);
    automaticAttack(guard, doomed.id);
    guard.cooldown = 8;
    game.projectiles.push(trackingShot(guard, doomed));
    const before = JSON.stringify(snapshotGame(game));
    // The live runtime resolves B's ID back to the old distant body after
    // selecting the near new B. A canonical snapshot rebuild intentionally
    // uses the new B, so the two contexts must remain explicitly distinct.
    expect(nativeAutomaticAttackIntent(game, guard)).toMatchObject({ action: "pursue", targetId: original.id, gap: 600 });
    expect(query(game, guard)).toMatchObject({ action: "engage", targetId: replacement.id, gap: 40 });
    expect(JSON.stringify(snapshotGame(game))).toBe(before);
    const x = guard.x;
    stepGame(game);
    expect(guard.order).toMatchObject({ type: "attack", targetId: original.id });
    expect(guard.x).toBeGreaterThan(x);
    expect(replacement.hp).toBe(replacement.maxHp);
  });

  it("excludes explicit attacks and commanded movement from automatic intent", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    const foe = holdingFoe(game, 1040);
    guard.order = { type: "attack", targetId: foe.id };
    expect(query(game, guard)).toEqual({ action: "none", weaponRange: guard.attackRange });
    guard.order = { type: "move", x: 1200, y: 1000 };
    expect(query(game, guard)).toEqual({ action: "none", weaponRange: guard.attackRange });
  });

  it("distinguishes an automatic leash return and artillery dead-zone retreat from pursuit", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1650, 1000);
    const foe = holdingFoe(game, 1750);
    guard.order = { type: "attack", targetId: foe.id, leashX: 1000, leashY: 1000 };
    expect(query(game, guard)).toMatchObject({ action: "return", targetId: foe.id, gap: 100 });
    const artillery = game.spawnUnit("player", "catapult", 1000, 1500);
    const near = holdingFoe(game, 1100, 1500);
    automaticAttack(artillery, near.id);
    expect(query(game, artillery)).toMatchObject({ action: "backOut", targetId: near.id, gap: 100 });
  });

  it("requires the original world unit identity used by native self-threat scoring", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    holdingFoe(game, 1040);
    const frame = createNativeQueryFrame(game);
    expect(() => nativeAutomaticAttackIntent(frame, { ...guard })).toThrow();
    expect(nativeAutomaticAttackIntent(frame, guard).action).toBe("acquire");
  });

  it("preserves self-threat identity and the strict greater-than-60 switch boundary", () => {
    const game = scene();
    const guard = game.spawnUnit("player", "footman", 1000, 1000);
    const ally = game.spawnUnit("player", "footman", 1000, 1200);
    const allyThreat = holdingFoe(game, 870);
    const selfThreat = holdingFoe(game, 1130);
    allyThreat.order = { type: "attack", targetId: ally.id };
    selfThreat.order = { type: "attack", targetId: guard.id };
    // Left bucket is visited first, but the native self bonus beats the ally bonus.
    expect(query(game, guard)).toMatchObject({ action: "acquire", targetId: selfThreat.id });
    automaticAttack(guard, allyThreat.id);
    guard.cooldown = 0;
    // Equal bodies and gap give exactly the 150-90 threat difference: retain current.
    expect(query(game, guard)).toMatchObject({ action: "pursue", targetId: allyThreat.id });
    selfThreat.hp -= 1;
    expect(query(game, guard)).toMatchObject({ action: "pursue", targetId: selfThreat.id });
  });

  it("leaves the full snapshot and runtime indexes intact and does not change the subsequent native fight", () => {
    const queried = scene();
    const guard = queried.spawnUnit("player", "archer", 1000, 1000);
    const first = holdingFoe(queried, 1130, 1040);
    holdingFoe(queried, 1130, 960);
    const untouched = scene();
    restoreSnapshotIntoGame(untouched, snapshotGame(queried), queried.nextId);
    for (let tick = 0; tick < 90; tick += 1) {
      if (tick === 2) {
        const shot = trackingShot(guard, first);
        queried.projectiles.push({ ...shot }); untouched.projectiles.push({ ...shot });
      }
      const before = JSON.stringify(snapshotGame(queried));
      const nextId = queried.nextId;
      const unitIndex = queried.unitSpatial, teamIndex = queried.unitSpatialByTeam;
      const buildingIndex = queried.buildingSpatial, buildingTeams = queried.buildingSpatialByTeam;
      const entities = queried.entityById;
      const frame = createNativeQueryFrame(queried);
      for (const unit of queried.units) nativeAutomaticAttackIntent(frame, unit);
      expect(JSON.stringify(snapshotGame(queried))).toBe(before);
      expect(queried.nextId).toBe(nextId);
      expect(queried.unitSpatial).toBe(unitIndex); expect(queried.unitSpatialByTeam).toBe(teamIndex);
      expect(queried.buildingSpatial).toBe(buildingIndex); expect(queried.buildingSpatialByTeam).toBe(buildingTeams);
      expect(queried.entityById).toBe(entities);
      stepGame(queried); stepGame(untouched);
      expect(snapshotGame(queried)).toStrictEqual(snapshotGame(untouched));
      expect(queried.nextId).toBe(untouched.nextId);
    }
    expect(guard.order.type).not.toBe("idle");
  });
});
