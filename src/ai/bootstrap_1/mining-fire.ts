import { GOLD_MINE_RULES } from '../../shared/mining';
import { routeClearsDisks, routePrefix } from '../../shared/route-selection';
import { isInCabin } from '../../shared/ship-cabin';
import { steerPoint } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, PlayerId, ResourceNode, Unit } from '../../shared/types';
import { isEnemyOwner, type TeamPolicyOptions } from '../policy/ownership';
import { distance, type Point } from '../policy/spatial';
import { medicalApproachRoad } from './medical-task-safety';

/** Native building fire has no walking, minimum-range or mounted-arc phase.
 * An unfinished tower cannot fire; a working tower between shots still can.
 * Ordinary workers are targeted at their centres, without a hull-radius pad.
 * This does not model the separate mounted weapons of a ship or land siege. */
export function miningBuildingFire(snapshot: GameSnapshot, owner: PlayerId, options: TeamPolicyOptions) {
  return snapshot.buildings.filter(building => building.hp > 0 && building.complete && building.attackDamage > 0
    && isEnemyOwner(snapshot, owner, building.owner, options))
    .map(building => ({ x: building.x, y: building.y, radius: building.attackRange }));
}

export function miningPointOutsideFire(snapshot: GameSnapshot, owner: PlayerId, worker: Unit, point: Point, options: TeamPolicyOptions) {
  if (isInCabin(worker)) return true;
  return miningBuildingFire(snapshot, owner, options).every(fire => distance(point, fire) > fire.radius);
}

/** Use the existing native building-aware continuous range-entry road.
 * updateMineOrder checks range before moving, so a new approach may spend
 * the remainder of one terrain step beyond entry before next tick gathers.
 * Native walkToward prices its entire step at the starting cell pace.
 * All native land paces are at most one: bound the remaining segment by one
 * bare-ground step, rather than integrating slower terrain past entry.
 * No medical task is planned. A miner already inside44 takes no extra step. */
export function miningApproachOutsideFire(snapshot: GameSnapshot, owner: PlayerId, worker: Unit, mine: ResourceNode, options: TeamPolicyOptions) {
  const fire = miningBuildingFire(snapshot, owner, options);
  if (!fire.length || isInCabin(worker)) return true;
  const road = medicalApproachRoad(snapshot, worker, mine, GOLD_MINE_RULES.entryRange);
  if (road && road.length > 1) {
    const entry = road[road.length - 1]!, next = steerPoint(snapshot.map, road[road.length - 2]!, mine);
    road.push(routePrefix(entry, [next], worker.speed / SIM_TICKS_PER_SECOND).at(-1)!);
  }
  return !!road && fire.every(disk => distance(road[0], disk) > disk.radius) && routeClearsDisks(road, fire);
}
