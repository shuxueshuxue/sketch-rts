import { UNIT_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { resolveAiCommandIntent } from "./commands";
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
  const fighters = units(snapshot, owner).filter((unit) => unit.kind !== "worker" && unit.hp >= unit.maxHp * 0.36);
  if (fighters.length < 2) return undefined;
  const enemies = enemyCombatUnits(snapshot, owner, options.teams);
  const candidates = enemies.filter((enemy) => fighters.some((fighter) => distance(fighter, enemy) <= focusFireJoinRange(fighter)));
  const rememberedTarget = options.memory?.strategicPlan?.focusTargetId ? candidates.find((candidate) => candidate.id === options.memory?.strategicPlan?.focusTargetId) : undefined;
  const target = rememberedTarget ?? candidates.sort((a, b) => focusFireTargetScore(b, fighters) - focusFireTargetScore(a, fighters))[0];
  if (!target) return undefined;
  const attackers = fighters.filter((fighter) => distance(fighter, target) <= focusFireJoinRange(fighter));
  const localEnemies = enemies.filter((enemy) => distance(enemy, target) <= 520);
  // @@@focus-fire-local-odds - Focus fire is a commitment; do not pin a small squad in place when the target is protected by a stronger local group.
  if (attackers.length < 12 && localEnemies.length > attackers.length) return undefined;
  if (options.policyMode !== "combat" && localEnemies.length >= 2 && armyPower(localEnemies) > armyPower(attackers) * 1.1) return undefined;
  if (options.memory) {
    options.memory.strategicPlan = {
      ...options.memory.strategicPlan,
      focusTargetOwner: target.owner,
      focusTargetId: target.id,
      focusTargetSinceTick: rememberedTarget ? (options.memory.strategicPlan?.focusTargetSinceTick ?? snapshot.tick) : snapshot.tick,
      focusTargetUpdatedTick: snapshot.tick,
    };
  }
  return attackers.length >= 2 ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: attackers.map((unit) => unit.id), targetId: target.id }, options) : undefined;
}

function focusFireJoinRange(unit: Unit) {
  return unit.attackRange + (unit.attackRange > 100 ? 80 : 95);
}

function focusFireTargetScore(unit: Unit, fighters: Unit[]) {
  const center = averagePoint(fighters);
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 5 + (unit.attackRange > 100 ? 28 : 0);
  return missingHp * 2.4 + threat - distance(unit, center) * 0.18;
}
