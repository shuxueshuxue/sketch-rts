import { UNIT_DEFS, unitMover } from "../../shared/catalog";
import { combatTargetScore, combatVictimId, shouldSwitchCombatTarget, type CombatTarget, type TargetThreat } from "../../shared/combat-target";
import { canReach } from "../../shared/naval";
import { strengthOf } from "./v6/strength";
import { isEnemyOwner } from "./ownership";
import { distance } from "./spatial";
import type { GameSnapshot, PlayerId, Unit } from "../../shared/types";
import type { AiPolicyContext } from "./types";

// AI may reconsider its own explicit attacks; shared simulation must never do that for a human's command.
// The common threat score chooses the fight. Here, mission leashes and artillery screens constrain that choice.
export function engagementTargets(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Map<string, CombatTarget> {
  const entities = new Map([...snapshot.units, ...snapshot.buildings].map(entity => [entity.id, entity]));
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== "worker" && unit.attackDamage > 0);
  const foes = [...entities.values()].filter(target => target.hp > 0 && isEnemyOwner(snapshot, owner, target.owner, options));
  const pending = new Map<string, number>();
  for (const shot of snapshot.projectiles) if (shot.owner === owner) pending.set(shot.targetId, (pending.get(shot.targetId) ?? 0) + shot.damage);
  const result = new Map<string, CombatTarget>();
  for (const fighter of own) {
    const order = fighter.order;
    if (fighter.hp < fighter.maxHp * .4 || !(order.type === "attack" || order.type === "attackMove") || !order.targetId) continue;
    const current = entities.get(order.targetId);
    if (!current) continue;
    const near = own.filter(unit => unit !== fighter && distance(unit, fighter) < 250);
    const screened = near.filter(unit => unit.attackRange <= 100 && unitMover(unit.kind) === unitMover(fighter.kind)).length >= 2;
    const threat = (target: CombatTarget): TargetThreat => {
      const victim = entities.get(combatVictimId(target) ?? "");
      return victim && !isEnemyOwner(snapshot, owner, victim.owner, options) && distance(victim, fighter) < 350 ? victim.id === fighter.id ? "self" : "ally" : "none";
    };
    const score = (target: CombatTarget) => {
      const gap = Math.max(0, distance(fighter, target) - ("order" in target ? 0 : target.radius));
      const effort = UNIT_DEFS[fighter.kind].weapon ? Math.max(0, gap - fighter.attackRange) + Math.min(gap, fighter.attackRange) * .25 : gap;
      const base = combatTargetScore(target, effort, threat(target), target.hp - (pending.get(target.id) ?? 0));
      // A protected siege piece continues its demolition assignment; direct danger still outweighs it.
      const siege = (UNIT_DEFS[fighter.kind].weapon?.buildingMultiplier ?? 1) >= 1.5;
      return base + (siege && !("order" in target) ? 220 + (screened ? 150 : 0) : 0);
    };
    const general = options.memory.v6?.general;
    const local = foes.filter(target => {
      const reach = "order" in target ? Math.max(fighter.attackRange + 80, target.attackRange + target.speed * 2 + 50) : fighter.attackRange + target.radius + 80;
      if (distance(fighter, target) > Math.min(600, reach) || !canReach(snapshot.map, fighter, target)) return false;
      if (unitMover(fighter.kind) === "land" && general?.target && ["guard", "hold", "defend"].includes(general.mode) && distance(target, general.target) > (general.leash ?? 450)) return false;
      return true;
    });
    const danger = local.filter((target): target is Unit => "order" in target && target.kind !== "worker" && target.attackDamage > 0);
    if (strengthOf(own.filter(unit => distance(unit, fighter) < 550)) < strengthOf(danger) * .8) continue;
    const candidate = local.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
    const currentScore = canReach(snapshot.map, fighter, current) ? score(current) : -Infinity;
    const target = candidate && shouldSwitchCombatTarget(currentScore, score(candidate)) ? candidate : current;
    // Keep an active local engagement from being overwritten by a later strategic script on the same frame.
    if (target.id !== current.id || local.some(enemy => "order" in enemy && enemy.attackDamage > 0 && (enemy.id === target.id || threat(enemy) !== "none"))) result.set(fighter.id, target);
  }
  return result;
}
