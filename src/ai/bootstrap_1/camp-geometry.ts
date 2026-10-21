import { groundApproachRoute, groundSteeringRoute, routeClearsDisks } from '../../shared/route-selection';
import type { GameSnapshot, Unit } from '../../shared/types';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { walkableGoal, walkingDistance } from '../../shared/terrain';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { withinRangeOf, type Point } from '../policy/spatial';
import { assessCreepCamp, creepForce, CREEP_ASSEMBLED_RANGE, CREEP_ROUTE_CLEARANCE, CREEP_STAGING_TURNS, stagingClear, stagingPoint, type Camp, type CreepAssessment, type chooseV7Camp, type startV7Creep } from '../policy/v7/creep';
import { recordExecutorReason } from '../executor-reasons';

/** Planning callers supply their current budgeted route facts. Undefined keeps
 * the existing native execution geometry; an unknown answer never falls back
 * to a synchronous native field. */
export type CampApproachRouteReader = (from: Point, goal: Point) =>
  Readonly<{ status: 'known'; points: readonly Point[]; distance: number }>
  | Readonly<{ status: 'unknown' | 'unreachable'; reasonCode: string }>;
export type CampApproachPointReader = (point: Point) => Readonly<{ status: 'known'; point: Point }>
  | Readonly<{ status: 'unknown' | 'unreachable'; reasonCode: string }>;

/** Every fighter's approach and the camp's return road must clear other camps. */
export const chooseBootstrapCamp = (home: Point, ...args: Parameters<typeof chooseV7Camp>) => {
  return assessBootstrapCamp(home, ...args).choice;
};
export const assessBootstrapCamp = (home: Point, ...args: Parameters<typeof chooseV7Camp>): CreepAssessment => {
  const [snapshot, front, camps, candidates, options, expansionMine] = args;
  if (front.length === 0) {
    recordExecutorReason(options, { executor: 'creep.selection', outcome: 'blocked', reason: 'no-clearing-units',
      targetIds: candidates.flatMap(camp => camp.creeps.map(unit => unit.id)), unitIds: [] });
    return { reason: 'no-clearing-units' };
  }
  const nearby = withinRangeOf(front, CREEP_ASSEMBLED_RANGE);
  const group = front.map(nearby).sort((a, b) => creepForce(b) - creepForce(a))[0]!;
  return assessCreepCamp(snapshot, group, camps, candidates, options,
    (camp, from, all) => bootstrapCampApproach(snapshot, home, group, camp, from, all), expansionMine);
};

/** The expansion assembles on this same safe approach while its remaining recruits are training. */
export function bootstrapCampApproach(snapshot: GameSnapshot, home: Point, group: Unit[], camp: Camp, from: Point, all: Camp[], planningRoute?: CampApproachRouteReader, planningPoint?: CampApproachPointReader) {
  const disks = all.filter(other => other !== camp).flatMap(other => other.creeps.map(creep =>
    ({ x: creep.x, y: creep.y, radius: CREEP_ROUTE_CLEARANCE })));
  const road = (start: Point, goal: Point) => {
    if (!planningRoute) return groundApproachRoute(snapshot.map, start, goal);
    const answer = planningRoute(start, goal);
    return answer.status === 'known' ? answer.points : undefined;
  };
  const retreat = road(camp.center, home);
  if (retreat === undefined || !routeClearsDisks([camp.center, ...retreat], disks)) return undefined;
  for (const turn of CREEP_STAGING_TURNS) {
    const raw = stagingPoint(camp, from, turn);
    const projected = planningPoint?.(raw);
    if (projected && projected.status !== 'known') continue;
    const staging = projected?.status === 'known' ? projected.point : walkableGoal(snapshot.map, raw.x, raw.y);
    if (!stagingClear(staging, all, camp)) continue;
    const returning = road(staging, home);
    if (returning === undefined || !routeClearsDisks([staging, ...returning], disks)) continue;
    const roads = group.map(unit => {
      if (!planningRoute) return { unit, points: groundApproachRoute(snapshot.map, unit, staging),
        distance: walkingDistance(snapshot.map, unit, staging, 'land') };
      const answer = planningRoute(unit, staging);
      return { unit, points: answer.status === 'known' ? answer.points : undefined,
        distance: answer.status === 'known' ? answer.distance : undefined };
    });
    if (roads.some(road => road.points === undefined || road.distance === undefined
      || !routeClearsDisks([road.unit, ...road.points], disks))) continue;
    return { staging, travelDistance: roads.reduce((sum, road) => sum + road.distance!, 0) / roads.length };
  }
  return undefined;
}

/** The same native staging/return/approach checks for an already bound point.
 * No target-camp safety is promised: the subsequent attack is still priced by
 * its battle model. Planning callers must supply both geometry readers. */
export function bootstrapCampStaging(snapshot: GameSnapshot, home: Point, group: readonly Unit[], camp: Camp, staging: Point,
  all: readonly Camp[], planningRoute: CampApproachRouteReader, planningPoint: CampApproachPointReader) {
  const projected = planningPoint(staging);
  if (projected.status !== 'known' || Math.hypot(projected.point.x - staging.x, projected.point.y - staging.y) > 1e-6
    || !group.length || Math.hypot(staging.x - camp.center.x, staging.y - camp.center.y) < camp.reach
    || !stagingClear(staging, [...all], camp)) return false;
  const disks = all.filter(other => other !== camp).flatMap(other => other.creeps.map(creep => ({ x: creep.x, y: creep.y, radius: CREEP_ROUTE_CLEARANCE })));
  const retreat = planningRoute(camp.center, home), returning = planningRoute(staging, home);
  if (retreat.status !== 'known' || returning.status !== 'known'
    || !routeClearsDisks([camp.center, ...retreat.points], disks) || !routeClearsDisks([staging, ...returning.points], disks)) return false;
  return group.every(unit => {
    const road = planningRoute(unit, staging);
    return road.status === 'known' && routeClearsDisks([unit, ...road.points], disks);
  });
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
