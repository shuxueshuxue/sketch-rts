import { ABILITY_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { resolveAiCommandIntent } from "./commands";
import { activeUnitClaim } from "./claims";
import { enemyCombatUnits, enemyUnitsNear, neutralUnitsNear, units } from "./snapshot";
import { averagePoint, distance } from "./spatial";
import { nearestEnemyUnit } from "./threats";
import type { PresetAiPolicyOptions } from "./types";

export function planAbilityCommands(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const commands: GameCommand[] = [];
  for (const caster of units(snapshot, owner).filter((unit) => unit.cooldown === 0)) {
    const abilities = UNIT_DEFS[caster.kind].abilities;
    const healAbility = abilities.find((ability) => ABILITY_DEFS[ability].behavior === "heal");
    if (healAbility) {
      const def = ABILITY_DEFS[healAbility];
      const target = healTarget(snapshot, owner, caster, def.plannerRange);
      if (target) {
        commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: healAbility, targetId: target.id }, options));
        continue;
      }
      const regroup = healerRegroupCommand(snapshot, owner, caster, def.plannerRange, options);
      if (regroup) {
        commands.push(regroup);
        continue;
      }
    }
    const summonAbility = abilities.find((ability) => ABILITY_DEFS[ability].behavior === "summon");
    if (summonAbility) {
      const def = ABILITY_DEFS[summonAbility];
      const target = nearestEnemyUnit(snapshot, owner, caster, def.plannerRange, options);
      const hasSpirit = units(snapshot, owner).some((unit) => unit.kind === "spirit" && distance(unit, caster) < 320);
      if (target && !hasSpirit) {
        commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: summonAbility, x: caster.x + 54, y: caster.y + 28 }, options));
        continue;
      }
    }
    const curseAbility = abilities.find((ability) => ABILITY_DEFS[ability].behavior === "curse");
    if (curseAbility) {
      const def = ABILITY_DEFS[curseAbility];
      if (def.behavior !== "curse") continue;
      const target = curseTarget(snapshot, owner, caster, def, options);
      if (target) commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: curseAbility, targetId: target.id }, options));
    }
  }
  return commands;
}

function healTarget(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, healRange: number) {
  return units(snapshot, owner)
    .filter((unit) => unit.hp < unit.maxHp * 0.7 && distance(unit, caster) <= healRange)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || b.maxHp - b.hp - (a.maxHp - a.hp) || distance(a, caster) - distance(b, caster))[0];
}

function healerRegroupCommand(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, healRange: number, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || activeUnitClaim(snapshot, owner, caster, options)) return undefined;
  const wounded = units(snapshot, owner).filter((unit) => unit.id !== caster.id && unit.kind !== "worker" && unit.hp < unit.maxHp * 0.7 && distance(unit, caster) > healRange && distance(unit, caster) <= 1400);
  const groups = wounded
    .map((anchor) => wounded.filter((unit) => distance(unit, anchor) <= 260))
    .filter((group) => group.length >= 2)
    .map((group) => ({ group, point: averagePoint(group) }))
    .filter(({ point }) => enemyCombatUnits(snapshot, owner, options.teams).every((enemy) => distance(enemy, point) > 620) && neutralUnitsNear(snapshot, point, 420).length === 0)
    .sort((a, b) => b.group.length - a.group.length || distance(caster, a.point) - distance(caster, b.point));
  const target = groups[0]?.point;
  // @@@healer-regroup - Healers that cannot cast yet should walk to a safe wounded cluster instead of idling at the last hired camp.
  if (!target || !healerRegroupOrderCanMove(caster, target)) return undefined;
  return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [caster.id], x: target.x, y: target.y }, options);
}

function healerRegroupOrderCanMove(caster: Unit, target: { x: number; y: number }) {
  if (caster.order.type === "idle") return true;
  return caster.order.type === "move" && distance(caster.order, target) > 180;
}

function curseTarget(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, def: Extract<(typeof ABILITY_DEFS)[keyof typeof ABILITY_DEFS], { behavior: "curse" }>, options: PresetAiPolicyOptions) {
  const candidates = [...enemyUnitsNear(snapshot, owner, caster, def.plannerRange, options.teams), ...neutralUnitsNear(snapshot, caster, def.plannerRange)].filter((target) => !target.effects.some((effect) => effect.type === def.statusType));
  if (def.scorchedDamageMultiplier !== undefined) {
    const scorched = candidates.filter((target) => target.effects.some((effect) => effect.type === "scorch")).sort((a, b) => distance(a, caster) - distance(b, caster))[0];
    if (scorched) return scorched;
  }
  return candidates.sort((a, b) => distance(a, caster) - distance(b, caster))[0];
}

export function planFocusFireCommand(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2") return undefined;
  const fighters = units(snapshot, owner).filter((unit) => unit.kind !== "worker" && unit.hp >= unit.maxHp * 0.36 && focusFireReadyUnit(snapshot, owner, unit, options));
  if (fighters.length === 1) {
    const target = soloFinisherTarget(fighters[0]!, enemyCombatUnits(snapshot, owner, options.teams));
    return target ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: [fighters[0]!.id], targetId: target.id }, options) : undefined;
  }
  if (fighters.length < 2) return undefined;
  const enemies = enemyCombatUnits(snapshot, owner, options.teams);
  const candidates = enemies.filter((enemy) => fighters.some((fighter) => distance(fighter, enemy) <= focusFireJoinRange(fighter)));
  const rememberedTarget = options.memory?.strategicPlan?.focusTargetId ? candidates.find((candidate) => candidate.id === options.memory?.strategicPlan?.focusTargetId) : undefined;
  const anchoredRememberedTarget = rememberedTarget && rememberedFocusStillAnchored(rememberedTarget, fighters, options) ? rememberedTarget : undefined;
  const finisherCanInterruptMemory = anchoredRememberedTarget && (options.policyMode !== "combat" || anchoredRememberedTarget.hp <= anchoredRememberedTarget.maxHp * 0.4);
  const finisherTarget = finisherCanInterruptMemory ? singleHitFinisherTarget(candidates, fighters) : undefined;
  const freshCandidates = rememberedTarget && !anchoredRememberedTarget ? candidates.filter((candidate) => candidate.id !== rememberedTarget.id) : candidates;
  const target = finisherTarget ?? anchoredRememberedTarget ?? freshCandidates.sort((a, b) => focusFireTargetScore(b, fighters) - focusFireTargetScore(a, fighters))[0];
  if (!target) return undefined;
  const attackers = focusFireAttackers(fighters, target);
  const localEnemies = enemies.filter((enemy) => distance(enemy, target) <= 520);
  // @@@focus-fire-local-odds - Focus fire is a commitment; do not pin a small squad in place when the target is protected by a stronger local group.
  const canPickOffWoundedTarget = focusFireCanPickOffWoundedTarget(attackers, target);
  if (!canPickOffWoundedTarget && partialTailFocusIsSupportedByStrongerEnemy(fighters, attackers, target, enemies)) return undefined;
  if (options.policyMode === "combat" && attackers.length < 4 && localEnemies.length > attackers.length && casterTargetBonus(target) === 0 && target.hp > target.maxHp * 0.18) return undefined;
  if (!canPickOffWoundedTarget && attackers.length < 12 && localEnemies.length > attackers.length) return undefined;
  if (!canPickOffWoundedTarget && localEnemies.length >= 2 && armyPower(localEnemies) > armyPower(attackers) * 1.1) return undefined;
  if (options.memory) {
    options.memory.strategicPlan = {
      ...options.memory.strategicPlan,
      focusTargetOwner: target.owner,
      focusTargetId: target.id,
      focusTargetSinceTick: anchoredRememberedTarget ? (options.memory.strategicPlan?.focusTargetSinceTick ?? snapshot.tick) : snapshot.tick,
      focusTargetUpdatedTick: snapshot.tick,
    };
  }
  return attackers.length >= 2 ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: attackers.map((unit) => unit.id), targetId: target.id }, options) : undefined;
}

function partialTailFocusIsSupportedByStrongerEnemy(fighters: Unit[], attackers: Unit[], target: Unit, enemies: Unit[]) {
  if (!UNIT_DEFS[target.kind].abilities.some((ability) => ABILITY_DEFS[ability].behavior === "heal") || target.hp < target.maxHp * 0.82) return false;
  if (attackers.length >= Math.max(5, Math.ceil(fighters.length * 0.65))) return false;
  const support = enemies.filter((enemy) => distance(enemy, target) <= 900);
  if (support.length <= attackers.length + 1) return false;
  // @@@supported-caster-tail - A healer/caster bonus is not a license for a partial tail to start a fight the main group cannot join.
  return armyPower(support) > armyPower(attackers) * 1.12;
}

function rememberedFocusStillAnchored(target: Unit, fighters: Unit[], options: PresetAiPolicyOptions) {
  if (options.policyMode !== "combat" || fighters.length < 6) return true;
  const attackers = focusFireAttackers(fighters, target);
  if (rememberedWoundedTargetCanBeFinished(target, attackers)) return true;
  // @@@focus-tail-release - Combat focus memory should stabilize a fight, not let a tiny tail drag the main army out of formation.
  return attackers.length >= Math.max(3, Math.ceil(fighters.length * 0.45));
}

function focusFireAttackers(fighters: Unit[], target: Unit) {
  return fighters.filter((fighter) => distance(fighter, target) <= focusFireJoinRange(fighter));
}

function singleHitFinisherTarget(candidates: Unit[], fighters: Unit[]) {
  return candidates
    .filter((target) => focusFireAttackers(fighters, target).some((attacker) => target.hp <= attacker.attackDamage))
    .sort((a, b) => a.hp - b.hp || focusFireTargetScore(b, fighters) - focusFireTargetScore(a, fighters))[0];
}

function focusFireReadyUnit(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: PresetAiPolicyOptions) {
  const claim = activeUnitClaim(snapshot, owner, unit, options);
  return !claim || claim.kind === "attack";
}

function soloFinisherTarget(fighter: Unit, enemies: Unit[]) {
  return enemies
    .filter((enemy) => distance(fighter, enemy) <= fighter.attackRange)
    .filter((enemy) => enemy.hp <= fighter.attackDamage)
    .sort((a, b) => soloFinisherScore(b) - soloFinisherScore(a))[0];
}

function soloFinisherScore(unit: Unit) {
  // @@@solo-finisher - A lone survivor may take a free last hit, but only without chasing into the enemy group.
  return casterTargetBonus(unit) + (unit.maxHp - unit.hp) * 3 + unit.attackDamage * 4 + (unit.attackRange > 100 ? 35 : 0);
}

function focusFireCanPickOffWoundedTarget(attackers: Unit[], target: Unit) {
  if (attackers.length >= 5 && target.hp <= target.maxHp * 0.6) return true;
  const volleyDamage = attackers.reduce((total, unit) => total + unit.attackDamage, 0);
  if (attackers.length >= 2 && target.hp <= target.maxHp * 0.34 && volleyDamage >= target.hp * 1.35) return true;
  // @@@critical-pickoff - A tiny group may finish a near-dead target, but ordinary wounded targets still respect local odds.
  return attackers.length >= 2 && target.hp <= target.maxHp * 0.18 && volleyDamage >= target.hp * 2;
}

function rememberedWoundedTargetCanBeFinished(target: Unit, attackers: Unit[]) {
  return attackers.length >= 4 && target.hp <= target.maxHp * 0.4 && attackers.reduce((total, unit) => total + unit.attackDamage, 0) >= target.hp * 1.35;
}

function focusFireJoinRange(unit: Unit) {
  return unit.attackRange + (unit.attackRange > 100 ? 80 : 95);
}

function focusFireTargetScore(unit: Unit, fighters: Unit[]) {
  const center = averagePoint(fighters);
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 5 + (unit.attackRange > 100 ? 28 : 0);
  return casterTargetBonus(unit) + missingHp * 2.4 + threat - distance(unit, center) * 0.18;
}

function casterTargetBonus(unit: Unit) {
  const abilities = UNIT_DEFS[unit.kind].abilities;
  let score = 0;
  if (abilities.some((ability) => ABILITY_DEFS[ability].behavior === "summon")) score += 130;
  if (abilities.some((ability) => ABILITY_DEFS[ability].behavior === "heal")) score += 115;
  if (abilities.some((ability) => ABILITY_DEFS[ability].behavior === "curse")) score += 95;
  return score;
}
