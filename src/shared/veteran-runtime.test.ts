import { describe, expect, it, vi } from "vitest";
import { resolveVariant } from "./catalog";
import { resolveDamage } from "./damage-reduction";
import { createBuilding, createUnit } from "./map";
import { shipMounts } from "./ship-equipment";
import { seconds } from "./time";
import type { GameSnapshot, Unit, UnitKind } from "./types";
import { buildVeteranFrame, castVeteranAbility, temporaryAttackSpeedMultiplier, veteranAttackSpeedMultiplier, type VeteranAutocastFrame } from "./veteran-runtime";
import type { VeteranSkillId } from "./veteran-skills";

function soldier(id: string, skill?: VeteranSkillId, kind: UnitKind = "footman", owner = "player", x = 500, y = 500) {
  const unit = createUnit(id, owner, kind, x, y);
  unit.level = 3;
  if (skill) unit.veteranSkill = skill;
  return unit;
}

function snapshot(...units: Unit[]): Pick<GameSnapshot, "units" | "buildings" | "teams" | "items" | "variants"> {
  return { units, buildings: [], items: [], teams: { player: "blue", ally: "blue", enemy: "red" } };
}

describe("veteran passives and auras", () => {
  it("projects the strongest protection aura, keeps personal protection separate, and removes auras after departure or death", () => {
    const veteran = soldier("veteran", "veteranResilience");
    const watch = soldier("watch", "veteranVigilance");
    const phalanx = soldier("phalanx", "veteranPhalanx");
    const game = snapshot(veteran, watch, phalanx);
    const protection = buildVeteranFrame(game).get(veteran.id)!.reductions;
    expect(protection).toEqual([{ group: "passive", amount: .12 }, { group: "aura", amount: .12 }]);
    expect(resolveDamage(100, { reductions: protection }).damage).toBeCloseTo(77.44);
    phalanx.x += 131;
    expect(buildVeteranFrame(game).get(veteran.id)!.reductions).toEqual([{ group: "passive", amount: .12 }, { group: "aura", amount: .08 }]);
    watch.hp = 0;
    expect(buildVeteranFrame(game).get(veteran.id)!.reductions).toEqual([{ group: "passive", amount: .12 }]);
  });

  it("affects self and teammates, excluding enemies, neutrals, dead units and out-of-range query hits", () => {
    const leader = soldier("leader", "veteranCommand");
    const ally = soldier("ally", undefined, "footman", "ally", 660);
    const enemy = soldier("enemy", undefined, "footman", "enemy");
    const neutral = soldier("neutral", undefined, "footman", "neutral");
    const dead = soldier("dead"); dead.hp = 0;
    const distant = soldier("distant", undefined, "footman", "player", 661);
    const game = snapshot(leader, ally, enemy, neutral, dead, distant);
    const query = vi.fn(() => [...game.units, ally]);
    const frame = buildVeteranFrame(game, query);
    expect(query).toHaveBeenCalledWith(500, 500, 160);
    expect([...frame.keys()]).toEqual(["leader", "ally"]);
    expect(frame.get(ally.id)!.attackSpeedMultiplier).toBe(1.08);
    delete game.teams;
    expect(buildVeteranFrame(game).has(ally.id)).toBe(false);
  });

  it("does not compound auras or permanent stats across frames; independent passives combine with the strongest aura", () => {
    const runner = soldier("runner", "veteranMobility");
    const first = soldier("first", "veteranMarch");
    const second = soldier("second", "veteranMarch");
    const game = snapshot(runner, first, second);
    const speed = runner.speed;
    const once = buildVeteranFrame(game);
    expect(once.get(runner.id)!.moveSpeedMultiplier).toBeCloseTo(1.21);
    expect(once.get(first.id)!.moveSpeedMultiplier).toBe(1.1);
    expect(buildVeteranFrame(game)).toEqual(once);
    expect(runner.speed).toBe(speed);
  });

  it("combines personal recovery with the strongest recovery aura and never repairs hulls", () => {
    const veteran = soldier("veteran", "veteranEndurance");
    const healer = soldier("healer", "veteranRenewal", "priest");
    const another = soldier("another", "veteranRenewal", "priest");
    const ship = soldier("ship", undefined, "warship");
    const frame = buildVeteranFrame(snapshot(veteran, healer, another, ship));
    expect(frame.get(veteran.id)!.regenPerSecond).toBe(4.2);
    expect(frame.get(healer.id)!.regenPerSecond).toBe(1.2);
    expect(frame.get(ship.id)?.regenPerSecond ?? 0).toBe(0);
  });

  it("exposes aiming and range bonuses without modifying base stats", () => {
    const archer = soldier("archer", "veteranSteadyAim", "archer");
    const ballista = soldier("ballista", "veteranSiegeDrill", "ballista");
    const frame = buildVeteranFrame(snapshot(archer, ballista));
    expect(frame.get(archer.id)!.aimSpeedMultiplier).toBe(1.3);
    expect(frame.get(ballista.id)!.attackRangeMultiplier).toBe(1.1);
    expect(frame.get(ballista.id)!.attackSpeedMultiplier).toBe(1);
  });

  it("honors campaign class overrides in passive, aura and active medical target filters", () => {
    const renewal = soldier("renewal", "veteranRenewal", "priest");
    const healer = soldier("healer", "veteranHealingWave", "priest");
    const metal = soldier("metal", "veteranEndurance", "footman"); metal.variant = "metalFootman";
    const living = soldier("living", "veteranEndurance", "golem"); living.variant = "livingGolem";
    const game = snapshot(renewal, healer, metal, living);
    game.variants = {
      metalFootman: resolveVariant({ base: "footman", unitClass: "mechanical" }),
      livingGolem: resolveVariant({ base: "golem", unitClass: "nonMechanical" }),
    };
    const frame = buildVeteranFrame(game);
    expect(frame.has(metal.id)).toBe(false);
    expect(frame.get(living.id)!.regenPerSecond).toBe(4.2);
    metal.hp -= 80; living.hp -= 80;
    const metalBefore = metal.hp, livingBefore = living.hp;
    expect(castVeteranAbility(game, healer, "veteranHealingWave", true)).toBe(true);
    expect(metal.hp).toBe(metalBefore);
    expect(living.hp).toBe(livingBefore + 30);
  });
});

describe("veteran active skills", () => {
  it("heals the five most wounded allies, excluding hulls and hostile, dead or distant units, without touching other cooldowns", () => {
    const caster = soldier("caster", "veteranHealingWave", "priest");
    caster.cooldown = 15;
    caster.abilityCooldowns = { heal: 9 };
    const wounded = Array.from({ length: 6 }, (_, index) => {
      const unit = soldier(`ally-${index}`, undefined, "footman", index === 0 ? "ally" : "player");
      unit.hp = unit.maxHp - (35 + index * 5);
      return unit;
    });
    const ship = soldier("ship", undefined, "warship"); ship.hp -= 100;
    const enemy = soldier("enemy", undefined, "footman", "enemy"); enemy.hp -= 100;
    const dead = soldier("dead"); dead.hp = 0;
    const distant = soldier("distant", undefined, "footman", "player", 681); distant.hp -= 100;
    const game = snapshot(caster, ...wounded, ship, enemy, dead, distant);
    const emit = vi.fn();
    const before = new Map(game.units.map(unit => [unit.id, unit.hp]));
    expect(castVeteranAbility(game, caster, "veteranHealingWave", true, emit)).toBe(true);
    for (const unit of wounded.slice(1)) expect(unit.hp).toBe(before.get(unit.id)! + 30);
    for (const unit of [caster, wounded[0]!, ship, enemy, dead, distant]) expect(unit.hp).toBe(before.get(unit.id));
    expect(caster.abilityCooldowns).toEqual({ heal: 9, veteranHealingWave: seconds(24) });
    expect(caster.cooldown).toBe(15);
    expect(emit).toHaveBeenCalledWith("heal", 500, 500, 30, expect.objectContaining({ radius: 180, unitId: caster.id }));
    expect(castVeteranAbility(game, caster, "veteranHealingWave", false)).toBe(false);
  });

  it("holds automatic healing until it can heal 30 HP, with an exception for a critically wounded ally", () => {
    const caster = soldier("caster", "veteranHealingWave", "priest");
    const ally = soldier("ally");
    const game = snapshot(caster, ally);
    expect(castVeteranAbility(game, caster, "veteranHealingWave", true)).toBe(false);
    ally.hp -= 29;
    expect(castVeteranAbility(game, caster, "veteranHealingWave", true)).toBe(false);
    expect(caster.abilityCooldowns).toBeUndefined();
    caster.hp -= 1;
    expect(castVeteranAbility(game, caster, "veteranHealingWave", true)).toBe(true);
    expect(ally.hp).toBe(ally.maxHp);
    caster.abilityCooldowns = undefined;
    ally.maxHp = 25; ally.hp = 10;
    expect(castVeteranAbility(game, caster, "veteranHealingWave", true)).toBe(true);
    expect(ally.hp).toBe(25);
  });

  it("allows manual small heals but rejects unlearned skills, dead casters and live stuns", () => {
    const caster = soldier("caster", "veteranHealingWave", "priest");
    const game = snapshot(caster);
    caster.hp -= 1;
    caster.effects.push({ type: "stun", remaining: 1 });
    expect(castVeteranAbility(game, caster, "veteranHealingWave", false)).toBe(false);
    caster.effects[0]!.remaining = 0;
    expect(castVeteranAbility(game, caster, "veteranRally", false)).toBe(false);
    expect(castVeteranAbility(game, caster, "veteranHealingWave", false)).toBe(true);
    caster.hp = 0; caster.abilityCooldowns = undefined;
    expect(castVeteranAbility(game, caster, "veteranHealingWave", false)).toBe(false);
  });

  it("does not automatically buff idle units or distant attack orders; buffs start on actual contact", () => {
    const caster = soldier("caster", "veteranRally");
    const enemy = soldier("enemy", undefined, "footman", "enemy", 900);
    const game = snapshot(caster, enemy);
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(false);
    caster.order = { type: "attack", targetId: enemy.id };
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(false);
    enemy.x = 525;
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(true);
    expect(veteranAttackSpeedMultiplier(caster)).toBe(1.2);
    expect(caster.effects[0]!.remaining).toBe(seconds(6));
    expect(enemy.effects).toEqual([]);
  });

  it("recognizes an ally under attack and prioritizes combatants within the five-target limit", () => {
    const caster = soldier("caster", "veteranInnerFire", "priest");
    const allies = Array.from({ length: 5 }, (_, index) => soldier(`ally-${index}`, undefined, "footman", "player", 510 + index));
    const victim = soldier("victim", undefined, "footman", "ally", 600);
    const enemy = soldier("enemy", undefined, "footman", "enemy", 625);
    enemy.order = { type: "attack", targetId: victim.id };
    const game = snapshot(caster, ...allies, victim, enemy);
    expect(castVeteranAbility(game, caster, "veteranInnerFire", true)).toBe(true);
    expect(victim.effects).toContainEqual(expect.objectContaining({ type: "protection", damageReduction: .2, protectionGroup: "ward" }));
    expect(game.units.filter(unit => unit.effects.length > 0)).toHaveLength(5);
    expect(enemy.effects).toEqual([]);
  });

  it("recognizes holding melee units and projectiles without replacing their orders", () => {
    const caster = soldier("caster", "veteranRally");
    const enemy = soldier("enemy", undefined, "footman", "enemy", 525);
    caster.order = { type: "hold", x: 500, y: 500 };
    caster.cooldown = 10;
    const game = snapshot(caster, enemy);
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(true);
    expect(caster.order.type).toBe("hold");
    caster.effects = []; caster.cooldown = 0; caster.abilityCooldowns = undefined;
    enemy.x = 800;
    const withProjectile = { ...game, projectiles: [{
      id: "arrow", attackerId: enemy.id, owner: enemy.owner, targetId: caster.id,
      fromX: 800, fromY: 500, toX: 500, toY: 500, damage: 10, remaining: 5, duration: 10,
    }] };
    expect(castVeteranAbility(withProjectile, caster, "veteranRally", true)).toBe(true);
  });

  it("responds to a hostile tower covering allies but ignores incomplete towers", () => {
    const caster = soldier("caster", "veteranInnerFire", "priest");
    const tower = createBuilding("tower", "enemy", "defenseTower", 540, 500, false);
    const game = snapshot(caster); game.buildings = [tower];
    expect(castVeteranAbility(game, caster, "veteranInnerFire", true)).toBe(false);
    tower.complete = true;
    expect(castVeteranAbility(game, caster, "veteranInnerFire", true)).toBe(true);
  });

  it("shares one battle scan across separate rally casters and refreshes the decision on the next frame", () => {
    const first = soldier("first", "veteranRally", "footman", "player", 500);
    const second = soldier("second", "veteranRally", "footman", "player", 900);
    const tower = createBuilding("tower", "enemy", "defenseTower", 700, 500, true);
    tower.attackRange = 1000;
    const game = snapshot(first, second); game.buildings = [tower];
    let towerQueries = 0;
    let casterQueries = 0;
    const query = (x: number, y: number, radius: number) => {
      if (x === tower.x && y === tower.y) towerQueries += 1;
      else casterQueries += 1;
      return game.units.filter(unit => Math.hypot(unit.x - x, unit.y - y) <= radius);
    };
    const frame: VeteranAutocastFrame = {};
    expect(castVeteranAbility(game, first, "veteranRally", true, undefined, query, frame)).toBe(true);
    expect(castVeteranAbility(game, second, "veteranRally", true, undefined, query, frame)).toBe(true);
    expect(temporaryAttackSpeedMultiplier(first)).toBe(1.2);
    expect(temporaryAttackSpeedMultiplier(second)).toBe(1.2);
    expect(casterQueries).toBe(2);
    expect(towerQueries).toBe(1);
    // Fresh ticks observe the ended fight instead of retaining the previous frame's decision.
    tower.hp = 0;
    second.effects = []; second.abilityCooldowns = undefined;
    expect(castVeteranAbility(game, second, "veteranRally", true, undefined, query, {})).toBe(false);
    expect(second.abilityCooldowns).toBeUndefined();
    const manualFrame: VeteranAutocastFrame = {};
    expect(castVeteranAbility(game, second, "veteranRally", false, undefined, query, manualFrame)).toBe(true);
    expect(manualFrame.engaged).toBeUndefined();
  });

  it("keeps independent ward sources and guardian scrolls, avoids redundant casts and lets weaker buffs resume", () => {
    const caster = soldier("caster", "veteranInnerFire", "priest");
    caster.effects = [
      { type: "guardian", remaining: 200 },
      { type: "protection", sourceId: "other", remaining: 200, damageReduction: .1, protectionGroup: "ward" },
    ];
    const game = snapshot(caster);
    expect(castVeteranAbility(game, caster, "veteranInnerFire", false)).toBe(true);
    expect(caster.effects).toHaveLength(3);
    expect(caster.effects[2]).toEqual({ type: "protection", sourceId: caster.id, remaining: seconds(6), damageReduction: .2, protectionGroup: "ward" });
    caster.abilityCooldowns = undefined;
    expect(castVeteranAbility(game, caster, "veteranInnerFire", false)).toBe(false);
    expect(caster.abilityCooldowns).toBeUndefined();
    caster.effects = [
      { type: "veteranBuff", sourceId: "weak", remaining: 200, attackSpeedMultiplier: 1.1 },
      { type: "veteranBuff", sourceId: "strong", remaining: 1, attackSpeedMultiplier: 1.2 },
    ];
    expect(veteranAttackSpeedMultiplier(caster)).toBe(1.2);
    caster.effects[1]!.remaining = 0;
    expect(veteranAttackSpeedMultiplier(caster)).toBe(1.1);
    caster.effects[0]!.remaining = 0;
    expect(veteranAttackSpeedMultiplier(caster)).toBe(1);
  });

  it("holds rally while bloodlust already provides a stronger bonus, then permits it after bloodlust expires", () => {
    const caster = soldier("caster", "veteranRally");
    const enemy = soldier("enemy", undefined, "footman", "enemy", 525);
    caster.order = { type: "attack", targetId: enemy.id };
    caster.effects = [{ type: "bloodlust", remaining: 1 }];
    const game = snapshot(caster, enemy);
    expect(temporaryAttackSpeedMultiplier(caster)).toBe(1.3);
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(false);
    expect(caster.abilityCooldowns).toBeUndefined();
    expect(caster.effects).toHaveLength(1);
    caster.effects[0]!.remaining = 0;
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(true);
    expect(temporaryAttackSpeedMultiplier(caster)).toBe(1.2);
    caster.effects.push({ type: "bloodlust", remaining: 1 });
    expect(temporaryAttackSpeedMultiplier(caster)).toBe(1.3);
    caster.effects.at(-1)!.remaining = 0;
    expect(temporaryAttackSpeedMultiplier(caster)).toBe(1.2);
  });

  it("skips bloodlusted allies when assigning rally targets while still buffing an unbuffed combatant", () => {
    const caster = soldier("caster", "veteranRally");
    caster.effects = [{ type: "bloodlust", remaining: seconds(15) }];
    const ally = soldier("ally");
    const enemy = soldier("enemy", undefined, "footman", "enemy", 525);
    ally.order = { type: "attack", targetId: enemy.id };
    const game = snapshot(caster, ally, enemy);
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(true);
    expect(caster.effects).toEqual([{ type: "bloodlust", remaining: seconds(15) }]);
    expect(temporaryAttackSpeedMultiplier(ally)).toBe(1.2);
  });

  it("does not waste rally on a lone unarmed transport under attack", () => {
    const caster = soldier("transport", "veteranRally", "transport");
    caster.fittings = [];
    const enemy = soldier("enemy", undefined, "footman", "enemy", 525);
    enemy.order = { type: "attack", targetId: caster.id };
    expect(castVeteranAbility(snapshot(caster, enemy), caster, "veteranRally", true)).toBe(false);
    expect(caster.abilityCooldowns).toBeUndefined();
    expect(caster.effects).toEqual([]);
  });

  it("lets an unarmed transport rally an armed nearby ally without buffing itself", () => {
    const caster = soldier("transport", "veteranRally", "transport");
    caster.fittings = [];
    const ally = soldier("ally", undefined, "footman", "player", 525);
    const enemy = soldier("enemy", undefined, "footman", "enemy", 550);
    ally.order = { type: "attack", targetId: enemy.id };
    expect(castVeteranAbility(snapshot(caster, ally, enemy), caster, "veteranRally", true)).toBe(true);
    expect(caster.abilityCooldowns?.veteranRally).toBe(seconds(24));
    expect(caster.effects).toEqual([]);
    expect(temporaryAttackSpeedMultiplier(ally)).toBe(1.2);
  });

  it("reserves rally's five targets for working weapons, including intact mounted guns and excluding broken or unloaded guns", () => {
    const caster = soldier("transport", "veteranRally", "transport"); caster.fittings = [];
    const broken = soldier("broken", undefined, "warship", "player", 505);
    broken.fittings = [{ ...shipMounts(broken)[0]!, id: "broken-gun" }];
    const unloaded = soldier("unloaded", undefined, "warship", "player", 510); unloaded.fittings = [];
    const armed = soldier("armed", undefined, "warship", "player", 600);
    armed.fittings = [{ ...shipMounts(armed)[0]!, id: "working-gun" }];
    // The working mount must win over a stale zero hull attack stat, and broken guns over stale positive stats.
    armed.attackDamage = 0;
    expect(broken.attackDamage).toBeGreaterThan(0);
    expect(unloaded.attackDamage).toBeGreaterThan(0);
    const allies = Array.from({ length: 4 }, (_, index) => soldier(`ally-${index}`, undefined, "footman", "player", 520 + index * 5));
    const enemy = soldier("enemy", undefined, "archer", "enemy", 650);
    enemy.order = { type: "attack", targetId: armed.id };
    const game = snapshot(caster, broken, unloaded, armed, ...allies, enemy);
    game.items = [
      { id: "broken-gun", kind: "shipCannon", shipId: broken.id, mountId: "bow", durability: 0, cooldownRemaining: 0, x: broken.x, y: broken.y },
      { id: "cargo-gun", kind: "shipCannon", shipId: unloaded.id, durability: 90, cooldownRemaining: 0, x: unloaded.x, y: unloaded.y },
      { id: "working-gun", kind: "shipCannon", shipId: armed.id, mountId: "bow", durability: 90, cooldownRemaining: 0, x: armed.x, y: armed.y },
    ];
    expect(castVeteranAbility(game, caster, "veteranRally", true)).toBe(true);
    expect(game.units.filter(unit => unit.effects.some(effect => effect.type === "veteranBuff"))).toHaveLength(5);
    for (const unit of [armed, ...allies]) expect(temporaryAttackSpeedMultiplier(unit)).toBe(1.2);
    for (const unit of [caster, broken, unloaded, enemy]) expect(unit.effects).toEqual([]);
  });

  it("preserves automatic wards under guardian immunity while allowing a deliberate manual precast", () => {
    const caster = soldier("caster", "veteranInnerFire", "priest");
    const enemy = soldier("enemy", undefined, "footman", "enemy", 525);
    enemy.order = { type: "attack", targetId: caster.id };
    caster.effects = [{ type: "guardian", remaining: seconds(7) }];
    const game = snapshot(caster, enemy);
    expect(castVeteranAbility(game, caster, "veteranInnerFire", true)).toBe(false);
    expect(caster.abilityCooldowns).toBeUndefined();
    expect(castVeteranAbility(game, caster, "veteranInnerFire", false)).toBe(true);
    expect(caster.effects).toContainEqual(expect.objectContaining({ type: "guardian" }));
    expect(caster.effects).toContainEqual(expect.objectContaining({ type: "protection", damageReduction: .2 }));
    caster.abilityCooldowns = undefined; caster.effects = []; caster.invulnerable = true;
    expect(castVeteranAbility(game, caster, "veteranInnerFire", true)).toBe(false);
    caster.invulnerable = false;
    expect(castVeteranAbility(game, caster, "veteranInnerFire", true)).toBe(true);
  });

  it("chooses identical healing targets regardless of spatial query enumeration order", () => {
    const firstCaster = soldier("caster", "veteranHealingWave", "priest");
    const friends = Array.from({ length: 6 }, (_, index) => {
      const unit = soldier(`friend-${index}`); unit.hp -= 40; return unit;
    });
    const first = snapshot(firstCaster, ...friends);
    const second = structuredClone(first);
    const secondCaster = second.units[0]!;
    expect(castVeteranAbility(first, firstCaster, "veteranHealingWave", true)).toBe(true);
    expect(castVeteranAbility(second, secondCaster, "veteranHealingWave", true, undefined, () => [...second.units].reverse())).toBe(true);
    expect(second).toEqual(first);
    expect(friends[5]!.hp).toBe(friends[5]!.maxHp - 40);
  });
});
