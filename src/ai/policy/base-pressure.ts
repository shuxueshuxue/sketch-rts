import { GOLD_MINE_RULES } from "../../shared/mining";
import type { Building, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { opponentPlayerIds } from "./ownership";
import { activeResources, buildings, combatUnits, completeBuildings, enemyCombatUnitsNear, units } from "./snapshot";
import { distance } from "./spatial";
import { mainBase, nearestResource } from "./world-model";

export type OwnedBaseObjectivePauseThreat = {
  base: Building;
  enemies: Unit[];
  defenders: Unit[];
};

export function ownedBaseNeedsObjectivePause(snapshot: GameSnapshot, owner: PlayerId, options: { teams?: Partial<Record<PlayerId, string>> }) {
  return ownedBaseObjectivePauseThreat(snapshot, owner, options) !== undefined;
}

export function ownedBaseObjectivePauseThreat(snapshot: GameSnapshot, owner: PlayerId, options: { teams?: Partial<Record<PlayerId, string>> }): OwnedBaseObjectivePauseThreat | undefined {
  if (opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  const main = mainBase(snapshot, owner);
  for (const base of buildings(snapshot, owner).filter((building) => building.kind === "townHall" && !building.complete && distance(building, main) > 500)) {
    const enemies = enemyCombatUnitsNear(snapshot, owner, base, 760, options.teams);
    if (enemies.length < 2) continue;
    const defenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, base) <= 820);
    // @@@unfinished-expansion-pause - In 1v2, an unfinished outer hall is a live liability; do not send the field army to creeps while enemies control that pocket.
    if (armyPower(enemies) >= armyPower(defenders) * 0.35) return { base, enemies, defenders };
  }
  for (const base of completeBuildings(snapshot, owner, "townHall")) {
    if (base.id === (main as Partial<Building>).id) continue;
    const enemies = enemyCombatUnitsNear(snapshot, owner, base, 700, options.teams);
    if (enemies.length < 2) continue;
    const defenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, base) <= 720);
    if (armyPower(enemies) >= armyPower(defenders) * 0.35) return { base, enemies, defenders };
  }
  for (const base of fragileMiningExpansions(snapshot, owner)) {
    const approaching = expansionApproachers(snapshot, owner, base, options);
    if (approaching.length >= 2 && armyPower(approaching) >= 1.8) {
      const defenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, base) <= 820);
      return { base, enemies: approaching, defenders };
    }
  }
  return undefined;
}

// Enemy fighters within this range of an outlying base are on their way to it.
const EXPANSION_APPROACH_RANGE = 1_500;

export function expansionApproachers(snapshot: GameSnapshot, owner: PlayerId, base: Building, options: { teams?: Partial<Record<PlayerId, string>> }) {
  return enemyCombatUnitsNear(snapshot, owner, base, EXPANSION_APPROACH_RANGE, options.teams);
}

function fragileMiningExpansions(snapshot: GameSnapshot, owner: PlayerId) {
  const main = mainBase(snapshot, owner);
  return completeBuildings(snapshot, owner, "townHall").filter((base) => {
    if (base.id === (main as Partial<Building>).id) return false;
    const mine = nearestResource(activeResources(snapshot), base);
    if (!mine || distance(mine, base) > GOLD_MINE_RULES.baseRange) return false;
    const miners = units(snapshot, owner).filter((unit) => unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === mine.id);
    const hasTower = buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, base) <= 430);
    return miners.length < 3 || !hasTower;
  });
}
