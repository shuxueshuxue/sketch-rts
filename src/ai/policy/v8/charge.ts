import { abilityCooldown } from "../../../shared/ability-cooldowns";
import { autocastEnabled } from "../../../shared/autocast";
import { ABILITY_DEFS, hasSpell, UNIT_DEFS } from "../../../shared/catalog";
import { canReach } from "../../../shared/naval";
import { matchesUnitTarget } from "../../../shared/unit-targeting";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { enemyBuildings, enemyUnits, units } from "../snapshot";
import { distance } from "../spatial";
import type { AiPolicyContext } from "../types";
import { isV8Policy } from "../versions";

// @@@v8-charge - V8 aims its riders' charges itself. Left to the engine's autocast, a rider charges the nearest unit in
// the window, or only the unit it is already hitting: audited over sixteen of V8's games, a fifth of its charges went into
// V7's spirits (85 health, gone in a minute, and a witch's curse kills one outright), three in ten landed on a unit under
// an enemy tower, and for 340 rider-seconds a ready rider hit a tower or hall while an enemy stood inside its window. With
// autocast off, each think every ready rider not walking under a move order charges the most valuable unit in its
// window: a shooter or a caster first (V5's archers step back from a rider that walks; a charge closes on them at once),
// then a worker, then any other fighter or a creep that is fighting; never a summoned spirit; and not a unit under an
// enemy tower whose reach the rider is not already in, nor one it cannot reach (a ship off the beach, see @@@reach). Two
// riders share a target only when there is no other.

const CHARGE_MARGIN = 20;

const def = ABILITY_DEFS.charge as Extract<(typeof ABILITY_DEFS)["charge"], { behavior: "charge" }>;

function isRider(unit: Unit) {
  return UNIT_DEFS[unit.kind].abilities.includes("charge");
}

function worth(unit: Unit) {
  if (unit.kind === "worker") return 2;
  if (UNIT_DEFS[unit.kind].weapon) return 5;
  if (hasSpell(unit.kind) || unit.attackRange > 100) return 4;
  return 1;
}

export function planV8Charge(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV8Policy(options)) return [];
  const riders = units(snapshot, owner).filter(isRider);
  if (riders.length === 0) return [];
  const commands: GameCommand[] = [];
  const auto = riders.filter((rider) => autocastEnabled(rider, "charge"));
  if (auto.length > 0) commands.push({ type: "setAutocast", unitIds: auto.map((rider) => rider.id), ability: "charge", enabled: false });
  const towers = enemyBuildings(snapshot, owner, options.teams).filter((building) => building.kind === "defenseTower" && building.complete);
  const fighting = snapshot.units.filter((unit) => unit.owner === "neutral" && unit.hp > 0 && (unit.order.type === "attack" || (unit.order.type === "attackMove" && unit.order.targetId !== undefined)));
  const foes = [...enemyUnits(snapshot, owner, options.teams), ...fighting].filter((unit) => unit.hp > 0 && unit.expiresTick === undefined && matchesUnitTarget(unit, def.targets, snapshot));
  const taken = new Set(riders.flatMap((rider) => (rider.order.type === "charge" ? [rider.order.targetId] : [])));
  for (const rider of riders) {
    if (rider.order.type === "charge" || rider.order.type === "move" || abilityCooldown(rider, "charge") > 0) continue;
    const exposed = (target: Unit) => towers.some((tower) => distance(tower, target) <= tower.attackRange && distance(tower, rider) > tower.attackRange);
    const window = foes.filter((foe) => {
      const gap = distance(rider, foe);
      return gap >= def.minRange + CHARGE_MARGIN && gap <= def.plannerRange && !exposed(foe) && canReach(snapshot.map, rider, foe);
    });
    const target = window.sort((a, b) => Number(taken.has(a.id)) - Number(taken.has(b.id)) || worth(b) - worth(a) || a.hp - b.hp || distance(rider, a) - distance(rider, b))[0];
    if (!target) continue;
    taken.add(target.id);
    commands.push({ type: "cast", unitId: rider.id, ability: "charge", targetId: target.id });
  }
  return commands;
}
