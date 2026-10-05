import { ABILITY_DEFS, UNIT_DEFS, unitMover } from "../../shared/catalog";
import { canReach } from "../../shared/naval";
import { sameGround } from "../../shared/terrain";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { isOpponentOwner } from "./ownership";
import { distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { strengthOf } from "./v6/strength";

// Infantry fights across its frontage. Mobile melee can pick an exposed gun or caster without dragging the army along.
export function planBattlefieldCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const own = snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker" && unitMover(unit.kind) === "land");
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unitMover(unit.kind) === "land");
  const towers = snapshot.buildings.filter((building) => isOpponentOwner(snapshot, owner, building.owner, options) && building.complete && building.attackDamage > 0);
  const proxyBuilders = new Set(enemies.filter((unit) => unit.kind === "worker" && unit.order.type === "build" && unit.order.buildingKind === "defenseTower" && snapshot.buildings.some((hall) => hall.owner === owner && hall.kind === "townHall" && distance(hall, unit.order as { x: number; y: number }) < 850)).map((unit) => unit.id));
  const commands: GameCommand[] = [];
  for (const fighter of own.filter((unit) => unit.attackRange <= 100 && unit.attackDamage > 0 && unit.hp >= unit.maxHp * 0.4)) {
    if (["board", "cast", "charge", "move"].includes(fighter.order.type)) continue;
    const mobile = fighter.speed >= 70;
    const general = options.memory.v6?.general;
    const local = enemies.filter((enemy) => sameGround(snapshot.map, fighter, enemy) && distance(fighter, enemy) <= (mobile || proxyBuilders.has(enemy.id) ? 500 : fighter.attackRange + fighter.radius + enemy.radius + 25) && canReach(snapshot.map, fighter, enemy));
    const candidates = local.filter((enemy) => {
      if (enemy.kind === "worker" && !proxyBuilders.has(enemy.id)) return false;
      if (general?.target && ["guard", "hold", "defend"].includes(general.mode) && distance(enemy, general.target) > (general.leash ?? 450)) return false;
      if (towers.some((tower) => distance(tower, enemy) <= tower.attackRange && distance(tower, fighter) > tower.attackRange)) return false;
      if (distance(fighter, enemy) <= fighter.attackRange + fighter.radius + enemy.radius + 25) return true;
      if ((!mobile && !proxyBuilders.has(enemy.id)) || priority(enemy) <= 1) return false;
      // A back line behind a melee screen is not an exposed target. Leave it to the coordinated advance.
      const screened = local.filter((screen) => screen !== enemy && screen.attackRange <= 100 && screen.kind !== "worker" && distance(screen, fighter) < distance(enemy, fighter) && distance(screen, enemy) < 220);
      if (screened.length >= 2) return false;
      const danger = enemies.filter((unit) => unit.kind !== "worker" && sameGround(snapshot.map, fighter, unit) && distance(unit, enemy) < 450);
      const support = own.filter((unit) => sameGround(snapshot.map, fighter, unit) && distance(unit, fighter) < 550);
      return strengthOf(support) >= strengthOf(danger) * 1.1;
    }).sort((a, b) => priority(b) - priority(a) || distance(a, fighter) - distance(b, fighter) || a.hp - b.hp);
    const target = candidates[0];
    if (target && !(fighter.order.type === "attack" && fighter.order.targetId === target.id)) commands.push({ type: "attack", unitIds: [fighter.id], targetId: target.id });
  }
  return commands;

  function priority(unit: Unit): number {
    if (proxyBuilders.has(unit.id)) return 6;
    if (UNIT_DEFS[unit.kind].weapon && unit.kind !== "siegeRam") return 5;
    if (UNIT_DEFS[unit.kind].abilities.some((ability) => ["heal", "summon", "curse"].includes(ABILITY_DEFS[ability].behavior))) return 4;
    return unit.attackRange > 100 ? 2 : 1;
  }
}
