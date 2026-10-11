import { groundApproachRoute, routeClearsDisks } from '../../shared/route-selection';
import { walkableGoal, walkingDistance } from '../../shared/terrain';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { withinRangeOf, type Point } from '../policy/spatial';
import { chooseCreepCamp, creepForce, CREEP_ASSEMBLED_RANGE, CREEP_ROUTE_CLEARANCE, CREEP_STAGING_TURNS, stagingClear, stagingPoint, type chooseV7Camp, type startV7Creep } from '../policy/v7/creep';

/** Every fighter's approach and the camp's return road must clear other camps. */
export const chooseBootstrapCamp = (home: Point, ...args: Parameters<typeof chooseV7Camp>) => {
  const [snapshot, front, camps, candidates, options, expansionMine] = args;
  if (front.length === 0) return undefined;
  const nearby = withinRangeOf(front, CREEP_ASSEMBLED_RANGE);
  const group = front.map(nearby).sort((a, b) => creepForce(b) - creepForce(a))[0]!;
  return chooseCreepCamp(snapshot, group, camps, candidates, options, (camp, from, all) => {
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
  }, expansionMine);
};

/** Execute the selected geometry without recomputing it against a different camp collection. */
export const startBootstrapCamp: typeof startV7Creep = (snapshot, front, choice, options) => {
  const memory = v6Memory(options);
  memory.creep = { center: choice.camp.center, reach: choice.camp.reach, staging: choice.staging,
    stage: 'gather', since: snapshot.tick, group: choice.group.map(unit => unit.id) };
  recordPlay(memory, choice.why === 'expansion' ? 'general:clearExpansion' : 'general:creep');
};
