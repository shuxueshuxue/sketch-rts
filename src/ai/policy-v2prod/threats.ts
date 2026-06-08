import type { Building, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { enemyBuildingsNear, enemyUnitsNear, neutralUnitsNear } from "./snapshot";
import { nearestEntity, type Point } from "./spatial";
import type { PresetAiPolicyOptions } from "./types";

export function enemyPressure(snapshot: GameSnapshot, owner: PlayerId, point: Point, range: number, options: PresetAiPolicyOptions) {
  return enemyUnitsNear(snapshot, owner, point, range, options.teams).length > 0;
}

export function nearestOpponentThreat(snapshot: GameSnapshot, owner: PlayerId, point: Point, range: number, options: PresetAiPolicyOptions): Unit | Building | undefined {
  return nearestEntity(
    [
      ...enemyUnitsNear(snapshot, owner, point, range, options.teams),
      ...enemyBuildingsNear(snapshot, owner, point, range, options.teams),
    ],
    point,
  );
}

export function nearestEnemyUnit(snapshot: GameSnapshot, owner: PlayerId, from: Point, range: number, options: PresetAiPolicyOptions) {
  return nearestEntity([...enemyUnitsNear(snapshot, owner, from, range, options.teams), ...neutralUnitsNear(snapshot, from, range)], from);
}
