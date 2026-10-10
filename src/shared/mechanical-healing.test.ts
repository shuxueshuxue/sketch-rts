import { describe, expect, it } from "vitest";
import { UNIT_DEFS, resolveVariant } from "./catalog";
import { boardUnit } from "./decks";
import { createBuilding, createUnit } from "./map";
import { createGame, issuePlayerCommand, leadershipRegenPerSecond, refreshUnitStats, snapshotGame, stepGame, unitRegenPerSecond } from "./sim";
import { seconds } from "./time";
import { xpStarThresholds } from "./unit-value";
import type { Unit } from "./types";
import { temporaryAttackSpeedMultiplier } from "./veteran-runtime";
import type { VeteranSkillId } from "./veteran-skills";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.scriptedVictory = true; delete game.map.terrain;
  return game;
}

function learn(game: ReturnType<typeof scene>, unit: Unit, skill: VeteranSkillId) {
  unit.level = 3; unit.xp = xpStarThresholds(UNIT_DEFS[unit.kind])[2]!;
  const offered: VeteranSkillId[] = [skill, "veteranResilience", "veteranMobility", "veteranCommand"];
  unit.veteranSkillChoices = [...new Set(offered)].slice(0, 3);
  refreshUnitStats(game, unit);
  issuePlayerCommand(game, unit.owner, { type: "learnVeteranSkill", unitId: unit.id, skill });
}

function mixed(skill?: VeteranSkillId) {
  const game = scene();
  const ship = game.spawnUnit("player", "warship", 900, 800);
  const crew = game.spawnUnit("player", "footman", 900, 800);
  expect(boardUnit(ship, crew, game.units)).toBe(true);
  const siege = game.spawnUnit("player", "ballista", 990, 740);
  const golem = game.spawnUnit("player", "golem", 810, 740);
  const priest = game.spawnUnit("player", "priest", 900, 740);
  priest.autocast = { heal: false, veteranHealingWave: false };
  if (skill) learn(game, priest, skill);
  for (const unit of [ship, crew, siege, golem]) unit.hp -= 80;
  return { game, ship, crew, siege, golem, priest, mechanical: [ship, siege, golem] };
}

describe("mechanical bodies and medical effects in the shared simulation", () => {
  it("preserves medical eligibility before a public leadership lookup for an absent owner", () => {
    const game = scene();
    const machine = createUnit("machine", "missing-owner", "golem", 900, 900);
    machine.level = 3;
    const rookie = createUnit("rookie", "missing-owner", "footman", 1000, 900);
    const neutral = createUnit("neutral", "neutral", "footman", 1100, 900);
    neutral.level = 3;
    for (const unit of [machine, rookie, neutral]) {
      expect(leadershipRegenPerSecond(game, unit)).toBe(0);
      expect(unitRegenPerSecond(game, unit)).toBe(0);
    }
    rookie.level = 1;
    expect(() => leadershipRegenPerSecond(game, rookie)).toThrow("Missing player state for missing-owner");
    expect(() => unitRegenPerSecond(game, rookie)).toThrow("Missing player state for missing-owner");
  });

  it("adds innate, leadership and learned recovery live, then stops healing after a mechanical override", () => {
    const game = scene();
    game.variants = { recovery: resolveVariant({ base: "footman", regenPerSecond: 7 }) };
    const fighter = game.spawnUnit("player", "footman", 1000, 1000);
    fighter.variant = "recovery";
    learn(game, fighter, "veteranEndurance");
    fighter.order = { type: "hold", x: fighter.x, y: fighter.y };
    game.players.player.upgrades.leadership = 3;
    fighter.hp -= 50;
    const hp = fighter.hp;
    stepGame(game);
    expect(fighter.hp).toBe(hp + (7 + 12 + 6) / 20);
    expect(leadershipRegenPerSecond(game, fighter)).toBe(12);
    expect(unitRegenPerSecond(game, fighter)).toBe(25);
    const snapshot = snapshotGame(game);
    expect(unitRegenPerSecond(snapshot, snapshot.units[0]!)).toBe(25);

    game.variants.recovery = resolveVariant({ base: "footman", unitClass: "mechanical", regenPerSecond: 7 });
    expect(leadershipRegenPerSecond(game, fighter)).toBe(0);
    expect(unitRegenPerSecond(game, fighter)).toBe(0);
    const unchanged = fighter.hp;
    stepGame(game);
    expect(fighter.hp).toBe(unchanged);
    const mechanicalSnapshot = snapshotGame(game);
    expect(unitRegenPerSecond(mechanicalSnapshot, mechanicalSnapshot.units[0]!)).toBe(0);
  });

  it("caps innate regeneration at full health and resumes on the next wounded tick", () => {
    const game = scene();
    const revenant = game.spawnUnit("player", "cinderRevenant", 900, 900);
    stepGame(game);
    expect(revenant.hp).toBe(revenant.maxHp);

    revenant.hp -= 1;
    const wounded = revenant.hp;
    stepGame(game);
    expect(revenant.hp).toBe(wounded + 7 / 20);
    revenant.hp = revenant.maxHp - .1;
    stepGame(game);
    expect(revenant.hp).toBe(revenant.maxHp);
    stepGame(game);
    expect(revenant.hp).toBe(revenant.maxHp);

    revenant.hp -= 3;
    const woundedAgain = revenant.hp;
    stepGame(game);
    expect(revenant.hp).toBe(woundedAgain + 7 / 20);
  });

  it("resumes leadership regeneration for wounded deck crew while machines keep their damage", () => {
    const { game, priest, crew, mechanical } = mixed();
    crew.level = 3; crew.xp = xpStarThresholds(UNIT_DEFS[crew.kind])[2]!;
    refreshUnitStats(game, crew);
    game.players.player!.upgrades.leadership = 3;
    crew.hp = crew.maxHp - .2;
    priest.hp = priest.maxHp;
    const before = mechanical.map(unit => unit.hp);
    stepGame(game);
    expect(crew.hp).toBe(crew.maxHp);
    stepGame(game);
    expect(crew.hp).toBe(crew.maxHp);
    crew.hp -= 2;
    const wounded = crew.hp;
    stepGame(game);
    expect(crew.hp).toBe(wounded + 12 / 20);
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
  });

  it("heals deck crew with a group wave and scroll while leaving siege engines, stone golems and hulls unchanged", () => {
    const { game, priest, crew, mechanical } = mixed("veteranHealingWave");
    crew.hp -= 30; // Leave room for both the stronger wave and the subsequent scroll.
    const before = mechanical.map(unit => unit.hp), crewBefore = crew.hp;
    issuePlayerCommand(game, "player", { type: "cast", unitId: priest.id, ability: "veteranHealingWave" });
    expect(crew.hp).toBe(crewBefore + 90);
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
    game.items.push({ id: "medical-scroll", kind: "healingScroll", carrierId: priest.id, slot: "carry0", x: priest.x, y: priest.y, cooldownRemaining: 0 });
    issuePlayerCommand(game, "player", { type: "useItem", unitId: priest.id, itemId: "medical-scroll" });
    expect(crew.hp).toBe(crew.maxHp);
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
  });

  it("targets wounded crew with ordinary autocast and cancels queued mechanical healing without spending a cooldown", () => {
    const { game, priest, crew, siege, mechanical } = mixed();
    priest.order = { type: "cast", ability: "heal", targetId: siege.id };
    const before = mechanical.map(unit => unit.hp), crewBefore = crew.hp;
    stepGame(game);
    expect(priest.order.type).toBe("idle");
    expect(priest.abilityCooldowns?.heal ?? 0).toBe(0);
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
    priest.autocast = {};
    stepGame(game);
    expect(crew.hp).toBe(crewBefore + 55);
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
    expect(priest.abilityCooldowns?.heal).toBeGreaterThan(0);
  });

  it("blocks innate regeneration, leadership, recovery auras, old recovery passives and rings on mechanical bodies", () => {
    const { game, priest, crew, golem, mechanical } = mixed("veteranRenewal");
    game.variants = { regenerativeGolem: resolveVariant({ base: "golem", regenPerSecond: 8 }) };
    golem.variant = "regenerativeGolem";
    // A stale learned passive still obeys its target filter, independently of save migration.
    golem.veteranSkill = "veteranEndurance";
    for (const unit of mechanical) { unit.level = 3; refreshUnitStats(game, unit); unit.hp = unit.maxHp - 80; }
    learn(game, crew, "veteranEndurance"); crew.hp = crew.maxHp - 80;
    game.players.player!.upgrades.leadership = 3;
    for (const unit of [golem, crew]) game.items.push({ id: `ring-${unit.id}`, kind: "regenRing", carrierId: unit.id, slot: "head", x: unit.x, y: unit.y, cooldownRemaining: 0 });
    priest.hp = priest.maxHp;
    const before = mechanical.map(unit => unit.hp), crewBefore = crew.hp;
    for (let tick = 0; tick < seconds(1); tick += 1) stepGame(game);
    expect(crew.hp).toBeGreaterThan(crewBefore);
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
    for (const unit of mechanical) {
      expect(leadershipRegenPerSecond(game, unit)).toBe(0);
      expect(unitRegenPerSecond(game, unit)).toBe(0);
    }
  });

  it("lets healing buildings select non-mechanical deck crew over more damaged machines", () => {
    const { game, crew, mechanical } = mixed();
    for (const unit of mechanical) unit.hp = 1;
    const well = createBuilding("well", "player", "moonWell", 900, 660, true);
    game.buildings.push(well);
    const before = mechanical.map(unit => unit.hp), crewBefore = crew.hp;
    stepGame(game);
    expect(crew.hp).toBeGreaterThan(crewBefore);
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
  });

  it.each(["veteranInnerFire", "veteranRally"] as const)("keeps unrestricted %s available to both mechanical bodies and their non-mechanical crew", skill => {
    const { game, priest, crew, mechanical } = mixed(skill);
    issuePlayerCommand(game, "player", { type: "cast", unitId: priest.id, ability: skill });
    for (const unit of [priest, crew, ...mechanical]) {
      if (skill === "veteranInnerFire") expect(unit.effects).toContainEqual(expect.objectContaining({ type: "protection", damageReduction: .35 }));
      else expect(temporaryAttackSpeedMultiplier(unit)).toBe(1.6);
    }
  });

  it("uses campaign unit-class overrides for direct healing, automatic healing and recovery passives", () => {
    const game = scene();
    game.variants = {
      metalFootman: resolveVariant({ base: "footman", unitClass: "mechanical", regenPerSecond: 20 }),
      livingGolem: resolveVariant({ base: "golem", unitClass: "nonMechanical" }),
    };
    const healer = game.spawnUnit("player", "priest", 1000, 1000);
    const metal = game.spawnUnit("player", "footman", 1060, 1000); metal.variant = "metalFootman";
    const living = game.spawnUnit("player", "golem", 940, 1000); living.variant = "livingGolem";
    metal.veteranSkill = "veteranEndurance"; living.veteranSkill = "veteranEndurance";
    metal.hp -= 80; living.hp -= 80;
    const before = metal.hp, livingBefore = living.hp;
    expect(() => issuePlayerCommand(game, "player", { type: "cast", unitId: healer.id, ability: "heal", targetId: metal.id })).toThrow(/mechanical/);
    stepGame(game); stepGame(game);
    expect(metal.hp).toBe(before);
    expect(living.hp).toBeGreaterThan(livingBefore + 55);
    expect(unitRegenPerSecond(game, metal)).toBe(0);
    expect(unitRegenPerSecond(game, living)).toBe(6);
  });
});
