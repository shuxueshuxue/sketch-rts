import { UNIT_DEFS } from "../../shared/catalog";
import { unitNeedsRepair } from "../../shared/unit-repair";
import type { GameCommand, GameSnapshot, PlayerId } from "../../shared/types";
import { sameGroundAs } from "./ground";
import { enemyUnitsNear, units, buildings } from "./snapshot";
import { distance } from "./spatial";
import type { PresetAiPolicyOptions } from "./types";

/** Routine depot work uses a nearby idle worker; miners and ongoing construction keep their assignments. */
export function planMechanicalRepair(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if ((snapshot.players[owner]?.gold ?? 0) < 25) return undefined;
  const own = units(snapshot, owner);
  const workers = own.filter(unit => unit.kind === "worker" && !unit.deck && unit.order.type === "idle");
  if (workers.length === 0) return undefined;
  const bases = buildings(snapshot, owner).filter(building => building.kind === "townHall" && building.complete && building.hp > 0);
  const alreadyAssigned = new Set(own.flatMap(unit => unit.order.type === "repairUnit" || unit.order.type === "repairShip" ? [unit.order.targetId] : []));
  const targets = own.filter(unit => !unit.deck && !UNIT_DEFS[unit.kind].naval && unitNeedsRepair(snapshot, unit) && unit.hp < unit.maxHp * .9
    && !alreadyAssigned.has(unit.id) && bases.some(base => distance(base, unit) <= 520)
    && enemyUnitsNear(snapshot, owner, unit, 400, options.teams).length === 0)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || compareIds(a.id, b.id));
  for (const target of targets) {
    const worker = workers.filter(unit => distance(unit, target) <= 320 && sameGroundAs(snapshot, unit, target))
      .sort((a, b) => distance(a, target) - distance(b, target) || compareIds(a.id, b.id))[0];
    if (worker) return { type: "repairUnit", unitIds: [worker.id], targetId: target.id };
  }
  return undefined;
}

function compareIds(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
