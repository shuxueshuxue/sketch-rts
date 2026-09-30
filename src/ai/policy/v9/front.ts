import { walkRoute, walkingDistance } from "../../../shared/terrain";
import type { GameSnapshot, PlayerId } from "../../../shared/types";
import { buildings } from "../snapshot";
import { distance, type Point } from "../spatial";
import { v9ExpansionMine, type V6Intel } from "../v6/intel";
import { strengthOf } from "../v6/strength";

// @@@v9-front - V9 holds its army at its front: a little way out from the hall nearest the enemy on the walk toward it, or,
// with the main alone, out from the natural it is about to take. On a ladder map the main's one ramp comes down into the
// natural's clearing, so an army there stands in the way of anything walking at either hall. The old rally, a step from
// the main straight toward the enemies' halls, left the army on the plateau while V8's ravagers razed V9's rising natural
// 880 away and its army never came (russetBrook, v5-extra-2, 4:54).
const FRONT_STEP = 320;
const CREEP_CLEARANCE = 330;
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
    if (natural && distance(natural, intel.home) <= NATURAL_REACH) anchor = natural;
  }
  // The front stands on the walk from the main toward the enemy, FRONT_STEP past the point of it nearest the anchor, or
  // the nearest point to that of the walk that no creep stands near: idle soldiers pick a fight with creeps within 230,
  // and a front beside the natural's guard cost V9 a soldier a game to it by 3:00 (1000 games, against 0.06).
  const route = walkRoute(snapshot.map, intel.home, target, 1);
  if (!route || route.length === 0) return anchor;
  let nearest = 0;
  route.forEach((point, index) => {
    if (distance(point, anchor) < distance(route[nearest]!, anchor)) nearest = index;
  });
  let ideal = nearest;
  for (let walked = 0; ideal < route.length - 1 && walked < FRONT_STEP; ideal += 1) walked += distance(route[ideal]!, route[ideal + 1]!);
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

// Whether V9's army (or a tower of its own) stands by the mine, so a hall may rise there.
export function v9ExpansionCovered(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, mine: Point) {
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, mine) <= TOWER_COVER)) return true;
  const near = strengthOf(intel.army.filter((unit) => distance(unit, mine) <= ESCORT_RANGE));
  return near >= Math.max(ESCORT_FLOOR, intel.power * ESCORT_SHARE);
}
