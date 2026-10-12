import { abilityCooldown, withAbilityCooldown } from "./ability-cooldowns";
import { ABILITY_DEFS } from "./catalog";
import { combatCapability } from "./combat-capabilities";
import type { DamageReductionSource } from "./damage-reduction";
import { canReceiveHealing } from "./healing";
import { isStunned } from "./unit-abilities";
import { matchesUnitTarget } from "./unit-targeting";
import { isInCabin } from './ship-cabin';
import type { GameSnapshot, Owner, Unit, UnitStatusEffect, WorldEffect } from "./types";
import { isVeteranActiveSkillId, isVeteranSkillId, VETERAN_SKILLS, type VeteranActiveSkillId, type VeteranModifiers } from "./veteran-skills";

type VeteranSnapshot = Pick<GameSnapshot, "units" | "buildings" | "teams" | "items" | "variants"> & Partial<Pick<GameSnapshot, "projectiles">>;
export type VeteranNearbyQuery = (x: number, y: number, radius: number) => Iterable<Unit>;
export type VeteranEffectSink = (type: WorldEffect["type"], x: number, y: number, remaining: number, options?: Partial<WorldEffect>) => void;
/** One autocast phase shares its first battle projection; create a fresh object on the next simulation tick. */
export type VeteranAutocastFrame = { engaged?: Set<string> };
export type VeteranUnitModifiers = {
  reductions: DamageReductionSource[];
  moveSpeedMultiplier: number;
  attackSpeedMultiplier: number;
  aimSpeedMultiplier: number;
  attackRangeMultiplier: number;
  regenPerSecond: number;
};

function allied(snapshot: VeteranSnapshot, a: Owner, b: Owner) {
  if (a === b) return true;
  if (a === "neutral" || b === "neutral") return false;
  return (snapshot.teams?.[a] ?? a) === (snapshot.teams?.[b] ?? b);
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function compareIds(a: Unit, b: Unit) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function nearbyAllies(snapshot: VeteranSnapshot, source: Unit, radius: number, nearby?: VeteranNearbyQuery) {
  const candidates = nearby?.(source.x, source.y, radius) ?? snapshot.units;
  // A spatial callback may enumerate overlapping buckets. Each unit is affected once.
  const targets = new Map<string, Unit>();
  for (const unit of candidates) {
    if (unit.hp > 0 && !isInCabin(unit) && allied(snapshot, source.owner, unit.owner) && distanceSquared(source, unit) <= radius ** 2) targets.set(unit.id, unit);
  }
  return [...targets.values()];
}

function highestModifiers(target: VeteranModifiers, source: VeteranModifiers) {
  for (const key of Object.keys(source) as (keyof VeteranModifiers)[]) {
    target[key] = Math.max(target[key] ?? 0, source[key] ?? 0);
  }
}

/** Project passives and auras once per simulation frame, without changing permanent unit stats. */
export function buildVeteranFrame(snapshot: VeteranSnapshot, nearby?: VeteranNearbyQuery): Map<string, VeteranUnitModifiers> {
  const projected = new Map<string, { unit: Unit; passive: VeteranModifiers; aura: VeteranModifiers }>();
  const entry = (unit: Unit) => {
    let value = projected.get(unit.id);
    if (!value) {
      value = { unit, passive: {}, aura: {} };
      projected.set(unit.id, value);
    }
    return value;
  };
  for (const source of snapshot.units) {
    if (source.hp <= 0 || !isVeteranSkillId(source.veteranSkill)) continue;
    const effect = VETERAN_SKILLS[source.veteranSkill].effect;
    if (effect.type === "passive" && matchesUnitTarget(source, effect.targets, snapshot)) highestModifiers(entry(source).passive, effect.modifiers);
    if (effect.type === "aura" && !isInCabin(source)) {
      for (const target of nearbyAllies(snapshot, source, effect.radius, nearby)) {
        if (matchesUnitTarget(target, effect.targets, snapshot)) highestModifiers(entry(target).aura, effect.modifiers);
      }
    }
  }
  const result = new Map<string, VeteranUnitModifiers>();
  for (const [id, { unit, passive, aura }] of projected) {
    const reductions: DamageReductionSource[] = [];
    if (passive.damageReduction) reductions.push({ group: "passive", amount: passive.damageReduction });
    if (aura.damageReduction) reductions.push({ group: "aura", amount: aura.damageReduction });
    result.set(id, {
      reductions,
      moveSpeedMultiplier: (passive.moveSpeedMultiplier ?? 1) * (aura.moveSpeedMultiplier ?? 1),
      attackSpeedMultiplier: (passive.attackSpeedMultiplier ?? 1) * (aura.attackSpeedMultiplier ?? 1),
      aimSpeedMultiplier: (passive.aimSpeedMultiplier ?? 1) * (aura.aimSpeedMultiplier ?? 1),
      attackRangeMultiplier: (passive.attackRangeMultiplier ?? 1) * (aura.attackRangeMultiplier ?? 1),
      regenPerSecond: canReceiveHealing(unit, snapshot) ? (passive.regenPerSecond ?? 0) + (aura.regenPerSecond ?? 0) : 0,
    });
  }
  return result;
}

/** Temporary veteran speed buffs use their strongest live value, independent of attack-speed auras. */
export function veteranAttackSpeedMultiplier(unit: Pick<Unit, "effects">): number {
  return unit.effects.reduce((best, effect) => effect.type === "veteranBuff" && effect.remaining > 0
    ? Math.max(best, effect.attackSpeedMultiplier ?? 1) : best, 1);
}

/** Bloodlust and veteran rallies share one temporary attack-speed layer; auras are applied separately. */
export function temporaryAttackSpeedMultiplier(unit: Pick<Unit, "effects">): number {
  const bloodlust = ABILITY_DEFS.bloodlust;
  const bloodlustSpeed = bloodlust.behavior === "bloodlust" ? bloodlust.attackSpeed : 1;
  return unit.effects.reduce((best, effect) => {
    if (effect.remaining <= 0) return best;
    if (effect.type === "bloodlust") return Math.max(best, bloodlustSpeed);
    return effect.type === "veteranBuff" ? Math.max(best, effect.attackSpeedMultiplier ?? 1) : best;
  }, 1);
}

function wardReduction(unit: Unit): number {
  return unit.effects.reduce((best, effect) => effect.type === "protection" && effect.remaining > 0
    ? Math.max(best, effect.damageReduction ?? 0) : best, 0);
}

function needsAttackSpeedBuff(snapshot: VeteranSnapshot, unit: Unit, multiplier: number | undefined): boolean {
  // A hull's saved attackDamage can outlive a destroyed or unloaded gun. Use the actual working weapons.
  return multiplier !== undefined && temporaryAttackSpeedMultiplier(unit) < multiplier && combatCapability(snapshot, unit).armed;
}

function needsBuff(snapshot: VeteranSnapshot, unit: Unit, modifiers: VeteranModifiers, automatic: boolean): boolean {
  const alreadyImmune = automatic && (unit.invulnerable || unit.effects.some(effect => effect.type === "guardian" && effect.remaining > 0));
  return (modifiers.damageReduction !== undefined && !alreadyImmune && wardReduction(unit) < modifiers.damageReduction)
    || needsAttackSpeedBuff(snapshot, unit, modifiers.attackSpeedMultiplier);
}

function applyBuff(snapshot: VeteranSnapshot, unit: Unit, caster: Unit, duration: number, modifiers: VeteranModifiers) {
  const statuses: UnitStatusEffect[] = [];
  if (modifiers.damageReduction !== undefined && wardReduction(unit) < modifiers.damageReduction) {
    statuses.push({ type: "protection", remaining: duration, sourceId: caster.id, damageReduction: modifiers.damageReduction, protectionGroup: "ward" });
  }
  if (needsAttackSpeedBuff(snapshot, unit, modifiers.attackSpeedMultiplier)) {
    statuses.push({ type: "veteranBuff", remaining: duration, sourceId: caster.id, attackSpeedMultiplier: modifiers.attackSpeedMultiplier! });
  }
  // Keep weaker, longer-lived statuses underneath: they can resume when the stronger one expires.
  for (const status of statuses) {
    unit.effects = unit.effects.filter(existing => existing.type !== status.type || existing.sourceId !== caster.id);
    unit.effects.push(status);
  }
}

/** A distant attack order alone does not count as a battle worth spending an automatic cooldown on. */
function engagedUnits(snapshot: VeteranSnapshot, nearby?: VeteranNearbyQuery): Set<string> {
  const targets = new Map([...snapshot.units, ...snapshot.buildings].map(unit => [unit.id, unit]));
  const engaged = new Set<string>();
  const largestBody = snapshot.units.reduce((radius, unit) => Math.max(radius, unit.radius), 0);
  for (const attacker of snapshot.units) {
    if (attacker.hp <= 0 || attacker.attackDamage <= 0) continue;
    const order = attacker.order;
    const targetId = order.type === "attack" || order.type === "charge" || order.type === "attackMove" ? order.targetId : undefined;
    const target = targetId ? targets.get(targetId) : undefined;
    if (!target || target.hp <= 0 || allied(snapshot, attacker.owner, target.owner)) continue;
    // One body-width of grace retains the buff through the immediate approach to contact.
    const reach = attacker.attackRange + attacker.radius + target.radius;
    if (distanceSquared(attacker, target) > reach ** 2) continue;
    engaged.add(attacker.id);
    engaged.add(target.id);
  }
  // Hold-position and point-aim orders retain no target ID; projectiles still prove the fight is underway.
  for (const projectile of snapshot.projectiles ?? []) {
    const target = targets.get(projectile.targetId);
    if (!target || target.hp <= 0 || allied(snapshot, projectile.owner, target.owner)) continue;
    engaged.add(projectile.attackerId);
    engaged.add(target.id);
  }
  // A melee unit holding ground keeps its hold order while striking. A cooling weapon and an enemy
  // still within contact reach distinguish that fight from two idle armies merely nearby.
  for (const attacker of snapshot.units) {
    if (attacker.hp <= 0 || attacker.attackDamage <= 0 || attacker.cooldown <= 0
      || (attacker.order.type !== "hold" && attacker.order.type !== "aim")) continue;
    const radius = attacker.attackRange + attacker.radius + largestBody;
    for (const target of nearby?.(attacker.x, attacker.y, radius) ?? snapshot.units) {
      if (target.hp <= 0 || allied(snapshot, attacker.owner, target.owner)) continue;
      if (distanceSquared(attacker, target) > (attacker.attackRange + attacker.radius + target.radius) ** 2) continue;
      engaged.add(attacker.id);
      engaged.add(target.id);
    }
  }
  // Towers have no attack orders. A live hostile tower covering a unit is an immediate threat.
  for (const building of snapshot.buildings) {
    if (building.hp <= 0 || !building.complete || building.attackDamage <= 0) continue;
    // Unit bodies add contact reach; the narrow phase below verifies the exact radius.
    for (const unit of nearby?.(building.x, building.y, building.attackRange + largestBody) ?? snapshot.units) {
      if (unit.hp > 0 && !allied(snapshot, building.owner, unit.owner)
        && distanceSquared(building, unit) <= (building.attackRange + unit.radius) ** 2) engaged.add(unit.id);
    }
  }
  return engaged;
}

/** Cast a learned veteran skill; base spell cooldowns and weapon cooldowns remain independent. */
export function castVeteranAbility(
  snapshot: VeteranSnapshot,
  caster: Unit,
  skill: VeteranActiveSkillId,
  automatic: boolean,
  addEffect?: VeteranEffectSink,
  nearby?: VeteranNearbyQuery,
  frame?: VeteranAutocastFrame,
): boolean {
  if (!isVeteranActiveSkillId(skill) || caster.veteranSkill !== skill || caster.hp <= 0
    || isInCabin(caster) || isStunned(caster) || abilityCooldown(caster, skill) > 0) return false;
  const effect = VETERAN_SKILLS[skill].effect;
  if (effect.type !== "active") return false;
  let candidates = nearbyAllies(snapshot, caster, effect.radius, nearby).filter(unit => matchesUnitTarget(unit, effect.targets, snapshot));
  let targets: Unit[];
  if (effect.action === "heal") {
    candidates = candidates.filter(unit => canReceiveHealing(unit, snapshot) && unit.hp < unit.maxHp);
    candidates.sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp) || compareIds(a, b));
    targets = candidates.slice(0, effect.maxTargets);
    const effectiveHealing = targets.reduce((sum, unit) => sum + Math.min(effect.healAmount, unit.maxHp - unit.hp), 0);
    // A stronger wave must still rescue fragile units whose entire health pool is below its healing amount.
    const emergency = targets.some(unit => unit.hp <= unit.maxHp * .4
      && unit.maxHp - unit.hp >= Math.min(effect.healAmount / 2, unit.maxHp * .25));
    if (targets.length === 0 || (automatic && effectiveHealing < effect.healAmount && !emergency)) return false;
    for (const target of targets) target.hp = Math.min(target.maxHp, target.hp + effect.healAmount);
  } else {
    candidates = candidates.filter(unit => needsBuff(snapshot, unit, effect.modifiers, automatic));
    if (candidates.length === 0) return false;
    const engaged = automatic
      ? frame ? frame.engaged ??= engagedUnits(snapshot, nearby) : engagedUnits(snapshot, nearby)
      : new Set<string>();
    if (automatic && !candidates.some(unit => engaged.has(unit.id))) return false;
    candidates.sort((a, b) => Number(engaged.has(b.id)) - Number(engaged.has(a.id))
      || distanceSquared(caster, a) - distanceSquared(caster, b) || compareIds(a, b));
    targets = candidates.slice(0, effect.maxTargets);
    for (const target of targets) applyBuff(snapshot, target, caster, effect.duration, effect.modifiers);
  }
  caster.abilityCooldowns = withAbilityCooldown(caster, skill, effect.cooldown);
  const type = effect.action === "heal" ? "heal" : effect.modifiers.damageReduction !== undefined ? "guardianField" : "bloodlust";
  addEffect?.(type, caster.x, caster.y, effect.action === "buff" ? effect.duration : 30,
    { radius: effect.radius, owner: caster.owner, sourceKind: caster.kind, unitId: caster.id });
  return true;
}
