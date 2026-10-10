import { routeClearsDisks } from '../../shared/route-selection';
import { walkableGoal, walkingDistance, walkRoute } from '../../shared/terrain';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { chooseCreepCamp, CREEP_ROUTE_CLEARANCE, CREEP_STAGING_TURNS, stagingClear, stagingPoint, type chooseV7Camp, type startV7Creep } from '../policy/v7/creep';

/** Every fighter's terrain road must clear other camps; selection pays the actual approach distance. */
export const chooseBootstrapCamp: typeof chooseV7Camp = (snapshot, front, camps, candidates, options, expansionMine) =>
  chooseCreepCamp(snapshot, front, camps, candidates, options, (camp, from, all) => {
    const disks = all.filter(other => other !== camp).flatMap(other => other.creeps.map(creep =>
      ({ x: creep.x, y: creep.y, radius: CREEP_ROUTE_CLEARANCE })));
    for (const turn of CREEP_STAGING_TURNS) {
      const raw = stagingPoint(camp, from, turn);
      const staging = walkableGoal(snapshot.map, raw.x, raw.y);
      if (!stagingClear(staging, all, camp)) continue;
      const roads = front.map(unit => ({ unit, points: walkRoute(snapshot.map, unit, staging),
        distance: walkingDistance(snapshot.map, unit, staging, 'land') }));
      if (roads.some(road => road.points === undefined || road.distance === undefined
        || !routeClearsDisks([road.unit, ...road.points], disks))) continue;
      return { staging, travelDistance: roads.reduce((sum, road) => sum + road.distance!, 0) / roads.length };
    }
    return undefined;
  }, expansionMine);

/** Execute the selected geometry without recomputing it against a different camp collection. */
export const startBootstrapCamp: typeof startV7Creep = (snapshot, front, choice, options) => {
  const memory = v6Memory(options);
  memory.creep = { center: choice.camp.center, reach: choice.camp.reach, staging: choice.staging,
    stage: 'gather', since: snapshot.tick, group: front.map(unit => unit.id) };
  recordPlay(memory, choice.why === 'expansion' ? 'general:clearExpansion' : 'general:creep');
};
