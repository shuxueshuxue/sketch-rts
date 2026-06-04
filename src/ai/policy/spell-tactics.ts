import { UNIT_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { resolveAiCommandIntent } from "./commands";
import { activeUnitClaim } from "./claims";
import { enemyCombatUnits, units } from "./snapshot";
import { averagePoint, distance } from "./spatial";
import { nearestEnemyUnit } from "./threats";
import type { PresetAiPolicyOptions } from "./types";

export function planAbilityCommands(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const commands: GameCommand[] = [];
  for (const caster of units(snapshot, owner).filter((unit) => unit.cooldown === 0)) {
    const abilities = UNIT_DEFS[caster.kind].abilities;
    if (abilities.includes("heal")) {
      const target = units(snapshot, owner).find((unit) => unit.hp < unit.maxHp * 0.7 && distance(unit, caster) <= 220);
      if (target) {
        commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: "heal", targetId: target.id }, options));
        continue;
      }
    }
    if (abilities.includes("summon")) {
      const target = nearestEnemyUnit(snapshot, owner, caster, 240, options);
      const hasSpirit = units(snapshot, owner).some((unit) => unit.kind === "spirit" && distance(unit, caster) < 320);
      if (target && !hasSpirit) {
        commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: "summon", x: caster.x + 54, y: caster.y + 28 }, options));
        continue;
      }
    }
    if (abilities.includes("curse")) {
      const target = nearestEnemyUnit(snapshot, owner, caster, 260, options);
      if (target && !target.effects.some((effect) => effect.type === "curse")) commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: "curse", targetId: target.id }, options));
    }
  }
  return commands;
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
  const finisherTarget = options.policyMode === "combat" && anchoredRememberedTarget && anchoredRememberedTarget.hp <= anchoredRememberedTarget.maxHp * 0.4 ? singleHitFinisherTarget(candidates, fighters) : undefined;
  const freshCandidates = rememberedTarget && !anchoredRememberedTarget ? candidates.filter((candidate) => candidate.id !== rememberedTarget.id) : candidates;
  const target = finisherTarget ?? anchoredRememberedTarget ?? freshCandidates.sort((a, b) => focusFireTargetScore(b, fighters) - focusFireTargetScore(a, fighters))[0];
  if (!target) return undefined;
  const attackers = focusFireAttackers(fighters, target);
  const localEnemies = enemies.filter((enemy) => distance(enemy, target) <= 520);
  // @@@focus-fire-local-odds - Focus fire is a commitment; do not pin a small squad in place when the target is protected by a stronger local group.
  const canPickOffWoundedTarget = focusFireCanPickOffWoundedTarget(attackers, target);
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
  if (abilities.includes("summon")) score += 130;
  if (abilities.includes("heal")) score += 115;
  if (abilities.includes("curse")) score += 95;
  return score;
}
