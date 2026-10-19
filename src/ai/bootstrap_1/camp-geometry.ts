import { groundApproachRoute, groundSteeringRoute, routeClearsDisks } from '../../shared/route-selection';
import type { GameSnapshot, Unit } from '../../shared/types';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { walkableGoal, walkingDistance } from '../../shared/terrain';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { withinRangeOf, type Point } from '../policy/spatial';
import { chooseCreepCamp, creepForce, CREEP_ASSEMBLED_RANGE, CREEP_ROUTE_CLEARANCE, CREEP_STAGING_TURNS, stagingClear, stagingPoint, type Camp, type chooseV7Camp, type startV7Creep } from '../policy/v7/creep';

/** Every fighter's approach and the camp's return road must clear other camps. */
export const chooseBootstrapCamp = (home: Point, ...args: Parameters<typeof chooseV7Camp>) => {
  const [snapshot, front, camps, candidates, options, expansionMine] = args;
  if (front.length === 0) return undefined;
  const nearby = withinRangeOf(front, CREEP_ASSEMBLED_RANGE);
  const group = front.map(nearby).sort((a, b) => creepForce(b) - creepForce(a))[0]!;
  return chooseCreepCamp(snapshot, group, camps, candidates, options,
    (camp, from, all) => bootstrapCampApproach(snapshot, home, group, camp, from, all), expansionMine);
};

/** The expansion assembles on this same safe approach while its remaining recruits are training. */
export function bootstrapCampApproach(snapshot: GameSnapshot, home: Point, group: Unit[], camp: Camp, from: Point, all: Camp[]) {
  const disks = all.filter(other => other !== camp).flatMap(other => other.creeps.map(creep =>
    ({ x: creep.x, y: creep.y, radius: CREEP_ROUTE_CLEARANCE })));
  const retreat = groundApproachRoute(snapshot.map, camp.center, home);
  if (retreat === undefined || !routeClearsDisks([camp.center, ...retreat], disks)) return undefined;
  for (const turn of CREEP_STAGING_TURNS) {
    const raw = stagingPoint(camp, from, turn);
    const staging = walkableGoal(snapshot.map, raw.x, raw.y);
    if (!stagingClear(staging, all, camp)) continue;
    const returning = groundApproachRoute(snapshot.map, staging, home);
    if (returning === undefined || !routeClearsDisks([staging, ...returning], disks)) continue;
    const roads = group.map(unit => ({ unit, points: groundApproachRoute(snapshot.map, unit, staging),
      distance: walkingDistance(snapshot.map, unit, staging, 'land') }));
    if (roads.some(road => road.points === undefined || road.distance === undefined
      || !routeClearsDisks([road.unit, ...road.points], disks))) continue;
    return { staging, travelDistance: roads.reduce((sum, road) => sum + road.distance!, 0) / roads.length };
  }
  return undefined;
}

/** Execute the selected geometry without recomputing it against a different camp collection. */
export const startBootstrapCamp: typeof startV7Creep = (snapshot, front, choice, options) => {
  const memory = v6Memory(options);
  memory.creep = { center: choice.camp.center, reach: choice.camp.reach, staging: choice.staging,
    stage: 'gather', since: snapshot.tick, group: choice.group.map(unit => unit.id) };
  recordPlay(memory, choice.why === 'expansion' ? 'general:clearExpansion' : 'general:creep');
};

/** A reinforcement takes its own native steering road, outside every unrelated camp. */
export function campRecruitRoadClear(snapshot: GameSnapshot, unit: Unit, staging: Point, camps: readonly Camp[], target: Camp) {
  const road = groundSteeringRoute(snapshot.map, unit, staging), end = road[road.length - 1]!;
  return Math.hypot(end.x - staging.x, end.y - staging.y) <= MOVE_ORDER_ARRIVAL_RANGE && routeClearsDisks(road,
    camps.filter(camp => camp !== target).flatMap(camp => camp.creeps.map(creep =>
      ({ x: creep.x, y: creep.y, radius: CREEP_ROUTE_CLEARANCE }))));
}
