import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import { createBuilding } from "./map";
import { createGame, issuePlayerCommand, refreshUnitStats, stepGame, type Game } from "./sim";
import { seconds } from "./time";
import { xpStarThresholds } from "./unit-value";
import type { Unit } from "./types";
import type { VeteranSkillId } from "./veteran-skills";

function scene() {
  const game = createGame("bareDuel", { players: ["player", "ally", "enemy"], teams: { player: "blue", ally: "blue", enemy: "red" }, aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}

function run(game: Game, ticks: number) {
  for (let tick = 0; tick < ticks; tick++) stepGame(game);
}

/** Other tests exercise natural drafting; a fixed offered choice isolates balance. */
function learn(game: Game, unit: Unit, skill: VeteranSkillId) {
  unit.level = 3;
  unit.xp = xpStarThresholds(UNIT_DEFS[unit.kind])[2]!;
  unit.veteranSkillChoices = ["veteranResilience", "veteranMobility", skill];
  refreshUnitStats(game, unit);
  issuePlayerCommand(game, unit.owner, { type: "learnVeteranSkill", unitId: unit.id, skill });
}

function disable(game: Game, unit: Unit, ability: "heal" | "bloodlust" | "veteranHealingWave" | "veteranRally" | "veteranInnerFire") {
  issuePlayerCommand(game, unit.owner, { type: "setAutocast", unitIds: [unit.id], ability, enabled: false });
}

function firingLine(sources: "none" | "one" | "two" | "enemy" = "none") {
  const game = scene();
  const attacker = game.spawnUnit("player", "footman", 800, 800);
  const target = createBuilding("combat-target", "enemy", "townHall", 880, 800, true);
  game.buildings.push(target);
  const leaders = sources === "none" ? [] : Array.from({ length: sources === "two" ? 2 : 1 }, (_, index) => {
    const leader = game.spawnUnit(sources === "enemy" ? "enemy" : "ally", "footman", 760 + index * 80, 670);
    learn(game, leader, "veteranCommand");
    issuePlayerCommand(game, leader.owner, { type: "holdPosition", unitIds: [leader.id] });
    return leader;
  });
  const hits: { tick: number; damage: number }[] = [];
  game.observer = { hit(source, struck, damage) {
    if (source.id === attacker.id && struck.id === target.id) hits.push({ tick: game.tick, damage });
  } };
  issuePlayerCommand(game, "player", { type: "attack", unitIds: [attacker.id], targetId: target.id });
  return { game, attacker, target, leaders, hits };
}

function intervals(hits: { tick: number }[], from = -Infinity, until = Infinity) {
  const ticks = hits.filter(hit => hit.tick >= from && hit.tick <= until).map(hit => hit.tick);
  return ticks.slice(1).map((tick, index) => tick - ticks[index]!);
}

describe("three-star skill combat balance", () => {
  it("makes command noticeably improve actual damage, without stacking duplicate or hostile sources", () => {
    const baseline = firingLine(), commanded = firingLine("one"), duplicates = firingLine("two"), hostile = firingLine("enemy");
    for (const sample of [baseline, commanded, duplicates, hostile]) {
      run(sample.game, seconds(30));
      expect(sample.target.hp).toBeGreaterThan(0);
      expect(sample.hits.length).toBeGreaterThan(20);
      expect(sample.target.maxHp - sample.target.hp).toBeCloseTo(sample.hits.reduce((sum, hit) => sum + hit.damage, 0));
      expect(sample.attacker.x).toBe(800);
      expect(sample.attacker.y).toBe(800);
    }
    const damage = (sample: typeof baseline) => sample.hits.reduce((sum, hit) => sum + hit.damage, 0);
    const ratio = damage(commanded) / damage(baseline);
    // 20 Hz cooldown rounding changes a nominal +35% into about +37.5%
    // for this particular weapon; actual landed damage must still improve.
    expect(ratio).toBeGreaterThan(1.30);
    expect(ratio).toBeLessThan(1.43);
    expect(new Set(intervals(commanded.hits))).toEqual(new Set([16]));
    expect(new Set(intervals(baseline.hits))).toEqual(new Set([22]));
    expect(duplicates.hits).toEqual(commanded.hits);
    expect(hostile.hits).toEqual(baseline.hits);
  });

  it("returns to the ordinary weapon cadence when the commander walks out of range", () => {
    const sample = firingLine("one");
    run(sample.game, seconds(5));
    expect(new Set(intervals(sample.hits))).toEqual(new Set([16]));
    const leader = sample.leaders[0]!;
    issuePlayerCommand(sample.game, "ally", { type: "move", unitIds: [leader.id], x: 500, y: 500, avoidCombat: true });
    run(sample.game, seconds(6));
    expect(Math.hypot(leader.x - sample.attacker.x, leader.y - sample.attacker.y)).toBeGreaterThan(160);
    const afterDeparture = sample.game.tick;
    run(sample.game, seconds(8));
    const after = intervals(sample.hits, afterDeparture);
    expect(after.length).toBeGreaterThan(4);
    expect(new Set(after)).toEqual(new Set([22]));
  });

  it("removes command after its source is killed by a real enemy attack", () => {
    const sample = firingLine();
    const leader = sample.game.spawnUnit("ally", "worker", 760, 670);
    learn(sample.game, leader, "veteranCommand");
    const killer = sample.game.spawnUnit("enemy", "mercenary", 760, 620);
    issuePlayerCommand(sample.game, "enemy", { type: "attack", unitIds: [killer.id], targetId: leader.id });
    for (let tick = 0; tick < seconds(12) && leader.hp > 0; tick++) stepGame(sample.game);
    expect(leader.hp).toBeLessThanOrEqual(0);
    expect(killer.hp).toBeGreaterThan(0);
    expect(sample.hits.some((hit, index) => index > 0 && hit.tick - sample.hits[index - 1]!.tick === 16)).toBe(true);
    issuePlayerCommand(sample.game, "enemy", { type: "move", unitIds: [killer.id], x: 500, y: 500, avoidCombat: true });
    const death = sample.game.tick;
    run(sample.game, seconds(7));
    const after = intervals(sample.hits, death + seconds(1));
    expect(after.length).toBeGreaterThan(3);
    expect(new Set(after)).toEqual(new Set([22]));
  });

  it("uses the stronger rally over bloodlust, then resumes bloodlust and ordinary attacks as each expires", () => {
    const sample = firingLine();
    const leader = sample.game.spawnUnit("player", "footman", 760, 670);
    learn(sample.game, leader, "veteranRally");
    disable(sample.game, leader, "veteranRally");
    issuePlayerCommand(sample.game, "player", { type: "holdPosition", unitIds: [leader.id] });
    const mage = sample.game.spawnUnit("player", "ogreMage", 650, 600);
    issuePlayerCommand(sample.game, "player", { type: "holdPosition", unitIds: [mage.id] });
    // Creep spells use their engine autocast path rather than a manual cast.
    run(sample.game, 2);
    expect(sample.attacker.effects.map(effect => effect.type)).toContain("bloodlust");
    disable(sample.game, mage, "bloodlust");
    issuePlayerCommand(sample.game, "player", { type: "cast", unitId: leader.id, ability: "veteranRally" });
    // Already-running weapon cooldowns are preserved when a buff arrives.
    // Observe subsequent actual strikes rather than rewriting that cooldown.
    sample.hits.length = 0;
    expect(sample.attacker.effects.map(effect => effect.type)).toContain("bloodlust");
    expect(sample.attacker.effects.map(effect => effect.type)).toContain("veteranBuff");
    run(sample.game, seconds(7));
    const rallied = intervals(sample.hits);
    expect(rallied.length).toBeGreaterThan(5);
    expect(new Set(rallied)).toEqual(new Set([14]));
    run(sample.game, seconds(7));
    const bloodlusted = intervals(sample.hits, seconds(9), seconds(14));
    expect(bloodlusted.length).toBeGreaterThan(3);
    expect(new Set(bloodlusted)).toEqual(new Set([17]));
    expect(sample.attacker.effects.some(effect => effect.type === "veteranBuff")).toBe(false);
    expect(sample.attacker.effects.some(effect => effect.type === "bloodlust")).toBe(true);
    run(sample.game, seconds(8));
    const normal = intervals(sample.hits, seconds(16));
    expect(normal.length).toBeGreaterThan(3);
    expect(new Set(normal)).toEqual(new Set([22]));
    expect(sample.attacker.effects.some(effect => effect.type === "bloodlust" || effect.type === "veteranBuff")).toBe(false);
    expect(leader.abilityCooldowns?.veteranRally).toBeGreaterThan(0);
  });

  it.each([1, 6])("heals a meaningful amount for %i wounded allies while keeping the five-target limit and cooldown", count => {
    const game = scene(), caster = game.spawnUnit("player", "priest", 800, 800);
    learn(game, caster, "veteranHealingWave");
    disable(game, caster, "heal");
    disable(game, caster, "veteranHealingWave");
    const formation = [[-80, -50], [0, -80], [80, -50], [-80, 50], [0, 80], [80, 50]] as const;
    const wounded = formation.slice(0, count).map(([x, y]) => {
      const ally = game.spawnUnit("ally", "footman", 800 + x, 800 + y);
      ally.hp -= 100;
      return ally;
    });
    const machine = game.spawnUnit("ally", "golem", 900, 800); machine.hp -= 100;
    const hostile = game.spawnUnit("enemy", "footman", 800, 900); hostile.hp -= 100;
    const before = wounded.map(unit => unit.hp), machineBefore = machine.hp, hostileBefore = hostile.hp;
    issuePlayerCommand(game, "player", { type: "cast", unitId: caster.id, ability: "veteranHealingWave" });
    expect(wounded.reduce((sum, unit, index) => sum + unit.hp - before[index]!, 0)).toBe(Math.min(count, 5) * 90);
    expect(wounded.filter((unit, index) => unit.hp - before[index]! === 90)).toHaveLength(Math.min(count, 5));
    expect(machine.hp).toBe(machineBefore);
    expect(hostile.hp).toBe(hostileBefore);
    expect(caster.abilityCooldowns?.veteranHealingWave).toBe(seconds(18));
    expect(() => issuePlayerCommand(game, "player", { type: "cast", unitId: caster.id, ability: "veteranHealingWave" })).toThrow(/cooldown/);
    // The hostile is moved away before observing the spell's cooldown; the
    // assertion above proves exclusion without mixing later combat damage.
    issuePlayerCommand(game, "enemy", { type: "move", unitIds: [hostile.id], x: 1200, y: 1200, avoidCombat: true });
    run(game, seconds(18));
    expect(caster.abilityCooldowns?.veteranHealingWave ?? 0).toBe(0);
  });

  it("automatically saves a critical small-health worker despite the larger healing wave", () => {
    const game = scene(), caster = game.spawnUnit("player", "priest", 800, 800);
    learn(game, caster, "veteranHealingWave");
    disable(game, caster, "heal");
    const worker = game.spawnUnit("ally", "worker", 860, 800);
    worker.hp = 27; // Below 40% health, but missing fewer than half of a 90-point wave.
    run(game, 2); // Autocast decisions run every second simulation tick.
    expect(worker.hp).toBe(worker.maxHp);
    expect(caster.abilityCooldowns?.veteranHealingWave).toBe(seconds(18));
    expect(game.effects.some(effect => effect.type === "heal" && effect.unitId === caster.id)).toBe(true);
  });

  it("reduces actual incoming blows by 35%, rejects duplicate wards and stops protecting on expiry", () => {
    const game = scene(), victim = game.spawnUnit("player", "footman", 800, 800);
    const caster = game.spawnUnit("player", "priest", 760, 670), duplicate = game.spawnUnit("player", "priest", 840, 670);
    for (const priest of [caster, duplicate]) {
      learn(game, priest, "veteranInnerFire");
      disable(game, priest, "heal"); disable(game, priest, "veteranInnerFire");
      issuePlayerCommand(game, "player", { type: "holdPosition", unitIds: [priest.id] });
    }
    issuePlayerCommand(game, "player", { type: "cast", unitId: caster.id, ability: "veteranInnerFire" });
    issuePlayerCommand(game, "player", { type: "cast", unitId: duplicate.id, ability: "veteranInnerFire" });
    expect(victim.effects.filter(effect => effect.type === "protection")).toHaveLength(1);
    expect(duplicate.abilityCooldowns?.veteranInnerFire ?? 0).toBe(0);
    const attacker = game.spawnUnit("enemy", "footman", 844, 800);
    const hits: number[] = [];
    game.observer = { hit(source, struck, damage) { if (source.id === attacker.id && struck.id === victim.id) hits.push(damage); } };
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [attacker.id], targetId: victim.id });
    stepGame(game);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeCloseTo(attacker.attackDamage * .65);
    issuePlayerCommand(game, "enemy", { type: "move", unitIds: [attacker.id], x: 1200, y: 1200, avoidCombat: true });
    run(game, seconds(8));
    expect(victim.effects.some(effect => effect.type === "protection")).toBe(false);
    const fresh = game.spawnUnit("enemy", "footman", victim.x + 44, victim.y);
    let unprotected = 0;
    game.observer = { hit(source, struck, damage) { if (source.id === fresh.id && struck.id === victim.id) unprotected += damage; } };
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [fresh.id], targetId: victim.id });
    stepGame(game);
    expect(unprotected).toBe(fresh.attackDamage);
    expect(caster.abilityCooldowns?.veteranInnerFire).toBeGreaterThan(0);
  });

  it("lets steady aim shoot sooner and sustain a faster real arrow cadence", () => {
    const fire = (steady: boolean) => {
      const game = scene(), archer = game.spawnUnit("player", "archer", 800, 800);
      if (steady) learn(game, archer, "veteranSteadyAim");
      else {
        archer.level = 3;
        archer.xp = xpStarThresholds(UNIT_DEFS.archer)[2]!;
        refreshUnitStats(game, archer);
      }
      const target = createBuilding("archery-target", "enemy", "townHall", 1080, 800, true);
      game.buildings.push(target);
      const launches: number[] = [], impacts: { tick: number; damage: number }[] = [];
      game.observer = { hit(source, struck, damage) {
        if (source.id === archer.id && struck.id === target.id) impacts.push({ tick: game.tick, damage });
      } };
      issuePlayerCommand(game, "player", { type: "attack", unitIds: [archer.id], targetId: target.id });
      for (let tick = 0; tick < seconds(20); tick++) {
        const cooldown = archer.cooldown;
        stepGame(game);
        if (archer.cooldown > cooldown) {
          expect(game.projectiles.some(projectile => projectile.attackerId === archer.id)).toBe(true);
          launches.push(game.tick);
        }
      }
      expect(target.hp).toBeGreaterThan(0);
      expect(archer.x).toBe(800);
      expect(archer.y).toBe(800);
      expect(impacts.length).toBeGreaterThan(10);
      expect(target.maxHp - target.hp).toBeCloseTo(impacts.reduce((sum, impact) => sum + impact.damage, 0));
      return { launches, impacts };
    };
    const baseline = fire(false), trained = fire(true);
    expect(trained.launches[0]!).toBeLessThanOrEqual(Math.ceil(baseline.launches[0]! * .65));
    expect(new Set(intervals(baseline.launches.map(tick => ({ tick }))))).toEqual(new Set([30]));
    expect(new Set(intervals(trained.launches.map(tick => ({ tick }))))).toEqual(new Set([25]));
    expect(trained.impacts.length / baseline.impacts.length).toBeGreaterThan(1.15);
    expect(trained.impacts.length / baseline.impacts.length).toBeLessThan(1.30);
  });
});
