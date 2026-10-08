import { describe, expect, it } from "vitest";
import { POISON_DAMAGE, UNIT_DEFS } from "./catalog";
import { addWorldEffect, createGame, issuePlayerCommand, removeUnit, restoreSnapshotIntoGame, snapshotGame, stepGame, strikeUnit } from "./sim";
import { createBuilding } from "./map";
import { DAMAGE_PROFILES as P } from "./damage-types";
import { LIGHTNING_ROD } from "./item-rules";
import { boardUnit, syncDecks } from "./decks";
import { upgradeSavedCombat } from "./combat-save-upgrade";
import { checksumGame } from "./sim/checksum";
import type { Unit, UnitKind, UnitStatusEffect } from "./types";
import type { DamageDelivery, DamageProfile } from "./damage-types";

function damageBattle() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = [];
  game.buildings = [];
  game.items = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}

function poisonedUnit() {
  const game = damageBattle();
  const target = game.spawnUnit("player", "footman", 500, 500);
  target.effects = [{ type: "poison", remaining: 21, sourceId: "dead-poisoner" }];
  return { game, target };
}

function hold(unit: Unit) {
  unit.order = { type: "hold", x: unit.x, y: unit.y };
  unit.cooldown = 9999;
}

function stepUntil(game: ReturnType<typeof damageBattle>, predicate: () => boolean) {
  for (let tick = 0; tick < 100 && !predicate(); tick++) stepGame(game);
  expect(predicate()).toBe(true);
}

describe("damage pipeline integration", () => {
  it.each([
    { name: "physical melee", kind: "footman", delivery: "melee", profile: P.MELEE_CUT, expected: 49.5616 },
    { name: "physical ranged", kind: "archer", delivery: "ranged", profile: P.RANGED_PIERCE, expected: 24.7808 },
    { name: "physical effect", kind: "footman", delivery: "effect", profile: P.EXPLOSION, expected: 49.5616 },
    { name: "magic melee", kind: "spirit", delivery: "melee", profile: P.MAGIC_MELEE, expected: 61.952 },
    { name: "magic ranged", kind: "priest", delivery: "ranged", profile: P.MAGIC_RANGED, expected: 30.976 },
    { name: "magic effect", kind: "priest", delivery: "effect", profile: P.BURNING, expected: 61.952 },
  ] satisfies { name: string; kind: UnitKind; delivery: DamageDelivery; profile: DamageProfile; expected: number }[])("settles $name through combined defenses and lets guardian block it entirely", ({ kind, delivery, profile, expected }) => {
    const game = damageBattle();
    const target = game.spawnUnit("player", "knight", 800, 800);
    target.level = 3;
    target.veteranSkill = "veteranResilience";
    target.hands = { left: "shield" };
    target.effects = [
      { type: "protection", remaining: 100, damageReduction: 0.15, protectionGroup: "ward", sourceId: "weak-ward" },
      { type: "protection", remaining: 100, damageReduction: 0.2, protectionGroup: "ward", sourceId: "strong-ward" },
    ];
    game.items.push(
      { id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 },
      { id: "shield", kind: "roundShield", carrierId: target.id, slot: "carry0", x: 0, y: 0, cooldownRemaining: 0 },
    );
    const weakAura = game.spawnUnit("player", "footman", 800, 860);
    weakAura.level = 3;
    weakAura.veteranSkill = "veteranVigilance";
    const strongAura = game.spawnUnit("player", "footman", 860, 800);
    strongAura.level = 3;
    strongAura.veteranSkill = "veteranPhalanx";
    const attacker = game.spawnUnit("enemy", kind, 1600, 1600);
    for (const unit of game.units) hold(unit);
    stepGame(game);
    const hit = () => {
      if (delivery === "effect") {
        addWorldEffect(game, "burningGround", target.x, target.y, 1, { owner: "enemy", damage: 100, damageProfile: profile, radius: 1, tickEvery: 1 });
        stepGame(game);
      } else strikeUnit(game, attacker, target, 100, delivery);
    };
    let before = target.hp;
    hit();
    expect(before - target.hp).toBeCloseTo(expected, 8);
    target.effects.push({ type: "guardian", remaining: 20 });
    before = target.hp;
    hit();
    expect(target.hp).toBe(before);
  });

  it.each(["guardian", "protection"] as const)("expires %s consistently when poison ticks regardless of effect insertion order", type => {
    const damage: number[] = [];
    for (const protectionFirst of [true, false]) {
      const { game, target } = poisonedUnit();
      const protection: UnitStatusEffect = { type, remaining: 1, ...(type === "protection" ? { damageReduction: 0.2, protectionGroup: "ward" as const } : {}) };
      if (protectionFirst) target.effects.unshift(protection);
      else target.effects.push(protection);
      const before = target.hp;
      stepGame(game);
      damage.push(before - target.hp);
      expect(target.effects.some(effect => effect.type === type)).toBe(false);
    }
    expect(damage).toEqual([POISON_DAMAGE, POISON_DAMAGE]);
  });

  it.each(["guardian", "protection"] as const)("keeps live %s effective and resumes full poison damage after expiry in either order", type => {
    for (const protectionFirst of [true, false]) {
      const { game, target } = poisonedUnit();
      const protection: UnitStatusEffect = { type, remaining: 2, ...(type === "protection" ? { damageReduction: 0.2, protectionGroup: "ward" as const } : {}) };
      if (protectionFirst) target.effects.unshift(protection);
      else target.effects.push(protection);
      let before = target.hp;
      stepGame(game);
      expect(before - target.hp).toBeCloseTo(type === "guardian" ? 0 : POISON_DAMAGE * 0.8);
      target.effects.find(effect => effect.type === "poison")!.remaining = 21;
      before = target.hp;
      stepGame(game);
      expect(before - target.hp).toBeCloseTo(POISON_DAMAGE);
    }
  });

  it("keeps the poison's final expiry tick and credits a lethal double-poison tick only once", () => {
    const { game, target } = poisonedUnit();
    target.hp = POISON_DAMAGE - 1;
    target.effects = [
      { type: "poison", remaining: 1, sourceId: "first-dead-poisoner", sourceOwner: "enemy" },
      { type: "poison", remaining: 1, sourceId: "second-dead-poisoner", sourceOwner: "neutral" },
    ];
    stepGame(game);
    expect(target.hp).toBe(-1);
    expect(game.match.stats.unitsKilled.enemy).toBe(1);
    expect(game.match.stats.unitsKilled.neutral ?? 0).toBe(0);
    expect(game.units.some(unit => unit.id === target.id)).toBe(false);
  });

  it("keeps poison subject to guardian immunity after the poisoner dies", () => {
    const { game, target } = poisonedUnit();
    target.effects.push({ type: "guardian", remaining: 40 });
    const before = target.hp;
    stepGame(game);
    expect(target.hp).toBe(before);
  });

  it("drops a slain source's aura at the frame boundary and preserves the next hit across restore", () => {
    const game = damageBattle();
    const leader = game.spawnUnit("enemy", "footman", 700, 500);
    leader.level = 3;
    leader.veteranSkill = "veteranVigilance";
    const target = game.spawnUnit("enemy", "footman", 750, 500);
    hold(leader);
    hold(target);
    const assassin = game.spawnUnit("player", "archer", 500, 480);
    const shooter = game.spawnUnit("player", "archer", 500, 530);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [assassin.id], targetId: leader.id });
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [shooter.id], targetId: target.id });
    stepUntil(game, () => game.projectiles.some(shot => shot.targetId === leader.id) && game.projectiles.some(shot => shot.targetId === target.id));
    const killShot = game.projectiles.find(shot => shot.targetId === leader.id)!;
    const followShot = game.projectiles.find(shot => shot.targetId === target.id)!;
    game.projectiles = [killShot, followShot];
    for (const shot of game.projectiles) shot.remaining = 1;
    leader.hp = 1;
    hold(assassin);
    hold(shooter);
    const before = target.hp;
    stepGame(game);
    // Hits in one tick share its initial aura projection; it is cleared at tick end.
    expect(before - target.hp).toBeCloseTo(followShot.damage * 0.92);
    expect(game.units.some(unit => unit.id === leader.id)).toBe(false);
    expect(game.veteranFrame?.get(target.id)?.reductions ?? []).toEqual([]);
    game.projectiles.push({ ...followShot, id: "next-frame-shot", remaining: 1 });
    const restored = damageBattle();
    restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    restored.scriptedVictory = true;
    const nextBefore = target.hp;
    stepGame(game);
    stepGame(restored);
    expect(nextBefore - target.hp).toBeCloseTo(followShot.damage);
    expect(restored.units.find(unit => unit.id === target.id)!.hp).toBe(target.hp);
    expect(checksumGame(restored)).toBe(checksumGame(game));
  });

  it("applies magical poison through active wards after its source is gone", () => {
    const { game, target } = poisonedUnit();
    target.effects.push({ type: "protection", remaining: 40, damageReduction: 0.2, protectionGroup: "ward" });
    game.items.push({ id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 });
    const before = target.hp;
    stepGame(game);
    expect(before - target.hp).toBeCloseTo(POISON_DAMAGE * 0.8);
  });

  it("does not let physical armor stop magical poison without a protective skill", () => {
    const { game, target } = poisonedUnit();
    game.items.push({ id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 });
    const before = target.hp;
    stepGame(game);
    expect(before - target.hp).toBeCloseTo(POISON_DAMAGE);
  });

  it.each(["archer", "priest", "defenseTower"] as const)("preserves %s damage classification after its source dies and applies heavy armor once", kind => {
    const game = damageBattle();
    const target = game.spawnUnit("enemy", "knight", 700, 500);
    hold(target);
    game.items.push({ id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 });
    const attacker = kind === "defenseTower"
      ? createBuilding("test-tower", "player", "defenseTower", 500, 500, true)
      : game.spawnUnit("player", kind, 500, 500);
    if (kind === "defenseTower") game.buildings.push(attacker as ReturnType<typeof createBuilding>);
    else issuePlayerCommand(game, "player", { type: "attack", unitIds: [attacker.id], targetId: target.id });
    stepUntil(game, () => game.projectiles.some(shot => shot.attackerId === attacker.id));
    const shot = game.projectiles.find(shot => shot.attackerId === attacker.id)!;
    expect(shot.damage).toBe(attacker.attackDamage);
    expect(shot.damageProfile).toEqual(kind === "priest" ? P.MAGIC_RANGED : kind === "defenseTower" ? P.TOWER_ARROW : P.RANGED_PIERCE);
    if (kind === "defenseTower") game.buildings = game.buildings.filter(building => building.id !== attacker.id);
    else removeUnit(game, attacker.id);
    game.entityById?.delete(attacker.id);
    const before = target.hp;
    stepUntil(game, () => target.hp < before);
    const heavy = Math.round(shot.damage * (kind === "defenseTower" ? 0.7 : 0.5));
    expect(before - target.hp).toBeCloseTo(heavy * (kind === "priest" ? 1 : 0.92));
  });

  it("samples the target's worn equipment and temporary protection at impact", () => {
    const game = damageBattle();
    const target = game.spawnUnit("enemy", "knight", 700, 500);
    const attacker = game.spawnUnit("player", "archer", 500, 500);
    hold(target);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [attacker.id], targetId: target.id });
    stepUntil(game, () => game.projectiles.length > 0);
    const shot = game.projectiles[0]!;
    removeUnit(game, attacker.id);
    game.items.push({ id: "new-armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 });
    target.effects.push({ type: "protection", remaining: 100, damageReduction: 0.2, protectionGroup: "ward" });
    const before = target.hp;
    stepUntil(game, () => target.hp < before);
    expect(before - target.hp).toBeCloseTo(Math.round(shot.damage * 0.5) * 0.92 * 0.8);
  });

  it("finishes a migrated old ordinary projectile without applying heavy armor twice", () => {
    const game = damageBattle();
    const target = game.spawnUnit("enemy", "knight", 700, 500);
    const attacker = game.spawnUnit("player", "archer", 500, 500);
    hold(target);
    game.items.push({ id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 });
    issuePlayerCommand(game, "player", { type: "attack", unitIds: [attacker.id], targetId: target.id });
    stepUntil(game, () => game.projectiles.length > 0);
    removeUnit(game, attacker.id);
    const oldSave = snapshotGame(game);
    const oldShot = oldSave.projectiles[0]!;
    delete oldShot.damageProfile;
    oldShot.damage = Math.round(oldShot.damage * 0.5);
    restoreSnapshotIntoGame(game, upgradeSavedCombat(oldSave), game.nextId);
    game.scriptedVictory = true;
    const restoredTarget = game.units.find(unit => unit.id === target.id)!;
    const before = restoredTarget.hp;
    stepUntil(game, () => restoredTarget.hp < before);
    expect(before - restoredTarget.hp).toBeCloseTo(oldShot.damage * 0.92);
  });

  it("does not attach a fire archer's weapon status or physical reduction to lightning", () => {
    const game = damageBattle();
    const attacker = game.spawnUnit("player", "sparkArcher", 500, 500);
    const target = game.spawnUnit("enemy", "knight", 650, 500);
    hold(attacker);
    hold(target);
    game.items.push({ id: "rod", kind: "lightningRod", carrierId: attacker.id, slot: "carry0", x: 0, y: 0, cooldownRemaining: 0 });
    attacker.hands = { right: "rod" };
    game.items.push({ id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 });
    const before = target.hp;
    issuePlayerCommand(game, "player", { type: "useItem", unitId: attacker.id, itemId: "rod", targetId: target.id });
    expect(before - target.hp).toBe(LIGHTNING_ROD.damage);
    expect(target.effects.some(effect => effect.type === "scorch")).toBe(false);
  });

  it("does not let caster-slayer increase scripted spell damage", () => {
    const game = damageBattle();
    const attacker = game.spawnUnit("player", "ashChieftain", 500, 500);
    const target = game.spawnUnit("enemy", "priest", 650, 500);
    const before = target.hp;
    strikeUnit(game, attacker, target, 20, "spell");
    expect(before - target.hp).toBe(20);
  });

  it("passes a physical deck hit to a heavy hull without inheriting its crew's ward", () => {
    const game = damageBattle();
    const ship = game.spawnUnit("enemy", "carrier", 900, 800);
    const crew = game.spawnUnit("enemy", "footman", 900, 800);
    const attacker = game.spawnUnit("player", "archer", 700, 800);
    boardUnit(ship, crew, game.units);
    syncDecks(game.units);
    crew.effects.push({ type: "protection", remaining: 100, damageReduction: 0.2, protectionGroup: "ward" });
    const crewHp = crew.hp;
    const hullHp = ship.hp;
    strikeUnit(game, attacker, crew, 100, "ranged");
    expect(crewHp - crew.hp).toBe(80);
    // Ordinary arrows transfer one tenth of their original impact to the hull.
    expect(hullHp - ship.hp).toBeCloseTo(Math.round(100 * 0.1 * 0.5));
    expect(ship.hp).toBeLessThan(UNIT_DEFS.carrier.hp);
  });
});
