import { UNIT_DEFS, unitMover } from "../../shared/catalog";
import { canReach } from "../../shared/naval";
import { canTakeStance } from "../../shared/push";
import type { GameCommand, GameSnapshot, MeleeStance, PlayerId } from "../../shared/types";
import { isOpponentOwner } from "./ownership";
import { distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { SHOOTER_UNIT_KINDS } from "./versions";

function readinessPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): { commands: GameCommand[]; aimed: Set<string> } {
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== "worker" && unitMover(unit.kind) === "land");
  const foes = snapshot.units.filter(unit => unit.kind !== "worker" && isOpponentOwner(snapshot, owner, unit.owner, options));
  const commands: GameCommand[] = [];
  const aimed = new Set<string>();
  const stances = new Map<MeleeStance, string[]>();
  const general = options.memory.v6?.general;
  for (const unit of own) {
    if (["board", "cast", "charge", "move"].includes(unit.order.type)) continue;
    const nearby = foes.filter(enemy => distance(unit, enemy) < 300 && canReach(snapshot.map, unit, enemy));
    if (canTakeStance(unit.kind)) {
      const order = unit.order;
      const target = order.type === "attack" || order.type === "attackMove" ? snapshot.units.find(enemy => enemy.id === order.targetId) : undefined;
      const protectedFriend = own.some(friend => friend !== unit && friend.attackRange > 100 && distance(friend, unit) < 140
        && nearby.some(enemy => enemy.attackRange <= 100 && distance(enemy, friend) < 140));
      const stance: MeleeStance = protectedFriend && nearby.some(enemy => distance(enemy, unit) <= unit.attackRange + 30) ? "brace"
        : target && target.attackRange > 100 && unit.speed >= 70 && unit.hp > unit.maxHp * .75 && !nearby.some(enemy => enemy.attackRange <= 100 && distance(enemy, unit) < 160) ? "shock" : "pursue";
      if ((unit.stance ?? "pursue") !== stance) stances.set(stance, [...(stances.get(stance) ?? []), unit.id]);
    }
    if (!(SHOOTER_UNIT_KINDS.has(unit.kind) || UNIT_DEFS[unit.kind].weapon) || unit.attackRange <= 100 || unit.hp < unit.maxHp * .6) continue;
    if (!general?.target || !["guard", "hold", "defend"].includes(general.mode) || distance(unit, general.target) > 200) continue;
    if (!["idle", "hold", "aim"].includes(unit.order.type) || nearby.some(enemy => distance(unit, enemy) <= unit.attackRange)) continue;
    const approaching = foes.filter(enemy => canReach(snapshot.map, unit, enemy) && distance(unit, enemy) > unit.attackRange
      && distance(unit, enemy) <= Math.min(900, unit.attackRange + enemy.speed * 4)).sort((a, b) => distance(unit, a) - distance(unit, b))[0];
    if (!approaching) continue;
    const gap = distance(unit, approaching);
    const reach = unit.attackRange * .85;
    const point = { x: unit.x + (approaching.x - unit.x) * reach / gap, y: unit.y + (approaching.y - unit.y) * reach / gap };
    aimed.add(unit.id);
    if (unit.order.type !== "aim" || distance(unit.order, point) > 40) commands.push({ type: "aim", unitIds: [unit.id], ...point });
  }
  for (const [stance, unitIds] of stances) commands.push({ type: "setStance", unitIds, stance });
  return { commands, aimed };
}

export function planCombatReadiness(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  return readinessPlan(snapshot, owner, options).commands;
}

export function readinessUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  return readinessPlan(snapshot, owner, options).aimed;
}
