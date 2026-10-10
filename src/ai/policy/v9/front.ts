import { AUTO_ACQUIRE_RANGE } from "../../../shared/sim";
import { walkRoute, walkingDistance } from "../../../shared/terrain";
import type { GameSnapshot, PlayerId } from "../../../shared/types";
import { BUILDING_DEFS } from "../../../shared/catalog";
import type { Building } from "../../../shared/types";
import { legalBuildPointNear } from "../build-layout";
import { buildings } from "../snapshot";
import { distance, type Point } from "../spatial";
import { mineGuards, v9ExpansionMine, type V6Intel } from "../v6/intel";
import { strengthOf } from "../v6/strength";
import { ARRIVED } from "./march";

// @@@v9-front - V9 holds its army at its front: a little way out from the hall nearest the enemy on the walk toward it, or,
// with the main alone, out from the cleared natural it is about to take. On a ladder map the main's one ramp comes down into the
// natural's clearing, so an army there stands in the way of anything walking at either hall. The old rally, a step from
// the main straight toward the enemies' halls, left the army on the plateau while V8's ravagers razed V9's rising natural
// 880 away and its army never came (russetBrook, v5-extra-2, 4:54).
const FRONT_STEP = 320;
// The army holding the front stands anywhere within ARRIVED of it (see v9-march-round-camps), and each idle soldier takes
// on any creep within the sim's AUTO_ACQUIRE_RANGE of itself: no creep may stand within the two of the front.
const CREEP_CLEARANCE = ARRIVED + AUTO_ACQUIRE_RANGE;
const NATURAL_REACH = 1_300;
// An expansion rises only with the army by it (or a tower): it starts at a tenth of its health.
const ESCORT_RANGE = 650;
const ESCORT_SHARE = 0.5;
const ESCORT_FLOOR = 2;
const TOWER_COVER = 500;

export function v9FrontPoint(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel): Point {
  const enemyHalls = intel.enemies.flatMap((enemy) => enemy.buildings.filter((building) => building.kind === "townHall"));
  if (enemyHalls.length === 0) return intel.home;
  const target = enemyHalls.reduce((best, hall) => (distance(hall, intel.home) < distance(best, intel.home) ? hall : best));
  const halls = buildings(snapshot, owner).filter((building) => building.kind === "townHall");
  const walk = (from: Point) => walkingDistance(snapshot.map, from, target) ?? Infinity;
  let anchor: Point = halls.reduce<Point>((best, hall) => (walk(hall) < walk(best) ? hall : best), intel.home);
  if (halls.length <= 1) {
    const natural = v9ExpansionMine(snapshot, intel);
    if (natural && mineGuards(snapshot, natural).length === 0 && distance(natural, intel.home) <= NATURAL_REACH) anchor = natural;
  }
  // Walk out from the selected hall itself. Projecting an off-axis hall onto the main's route left its mine undefended.
  const route = walkRoute(snapshot.map, anchor, target, 1);
  if (!route || route.length === 0) return anchor;
  let ideal = 0;
  for (let walked = distance(anchor, route[0]!); ideal < route.length - 1 && walked < FRONT_STEP; ideal += 1) walked += distance(route[ideal]!, route[ideal + 1]!);
  const creeps = snapshot.units.filter((unit) => unit.owner === "neutral" && unit.attackDamage > 0);
  const clear = (point: Point) => creeps.every((creep) => distance(creep, point) >= CREEP_CLEARANCE && distance({ x: creep.homeX ?? creep.x, y: creep.homeY ?? creep.y }, point) >= CREEP_CLEARANCE);
  for (let offset = 0; offset < route.length; offset += 1) {
    for (const index of [ideal - offset, ideal + offset]) {
      const point = route[index];
      if (point && clear(point)) return point;
    }
  }
  return anchor;
}

// @@@v9-choke-towers - V9's towers stand where the way out of a base toward the enemy narrows: on the walk from the hall
// to the nearest enemy hall, CHOKE_STEP along it (a main's ramp, a natural's mouth), no farther from the hall than
// CHOKE_REACH (its towers are counted by the hall they guard), and out of a standing camp's reach (a tower there would
// wake it). The old spot, a step from the hall straight toward the enemy, stood wherever the hall did.
const CHOKE_STEP = 260;
const CHOKE_REACH = 460;
const CAMP_CLEARANCE = BUILDING_DEFS.defenseTower.attackRange + 60;

export function v9ChokeTowerPoint(snapshot: GameSnapshot, intel: V6Intel, hall: Building): Point | undefined {
  const enemyHalls = intel.enemies.flatMap((enemy) => enemy.buildings.filter((building) => building.kind === "townHall"));
  if (enemyHalls.length === 0) return undefined;
  const target = enemyHalls.reduce((best, candidate) => (distance(candidate, hall) < distance(best, hall) ? candidate : best));
  const route = walkRoute(snapshot.map, hall, target, 1);
  if (!route || route.length === 0) return undefined;
  let index = 0;
  for (let walked = distance(hall, route[0]!); index < route.length - 1 && walked < CHOKE_STEP; index += 1) walked += distance(route[index]!, route[index + 1]!);
  while (index > 0 && distance(route[index]!, hall) > CHOKE_REACH) index -= 1;
  const point = legalBuildPointNear(snapshot, "defenseTower", route[index]!);
  const creeps = snapshot.units.filter((unit) => unit.owner === "neutral" && unit.attackDamage > 0);
  if (distance(point, hall) > CHOKE_REACH + 60 || creeps.some((creep) => distance(creep, point) <= CAMP_CLEARANCE)) return undefined;
  return point;
}

// Whether V9's army (or a tower of its own) stands by the mine, so a hall may rise there.
export function v9ExpansionCovered(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, mine: Point) {
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, mine) <= TOWER_COVER)) return true;
  const near = strengthOf(intel.army.filter((unit) => distance(unit, mine) <= ESCORT_RANGE));
  return near >= Math.max(ESCORT_FLOOR, intel.power * ESCORT_SHARE);
}
