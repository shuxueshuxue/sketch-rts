import type { Point } from './ship-geometry';
import { walkingDistance, type Mover } from './terrain';
import type { GameMap } from './types';
import { SIM_TICKS_PER_SECOND } from './time';

/** Terrain travel at a supplied constant speed; excludes body detours and ship turning. */
export function routeTravelTicks(map: Pick<GameMap, 'terrain'>, from: Point, to: Point, mover: Mover, speed: number): number | undefined {
  const road = walkingDistance(map, from, to, mover);
  return road === undefined ? undefined : Math.ceil(road / speed * SIM_TICKS_PER_SECOND);
}

/** Shortest terrain route to one destination. Unreachable candidates do not compete.
 * Building detours, body clearance and sailing time belong to movement planning.
 * A single destination reuses the terrain's distance field for every candidate. */
export function nearestByRoute<T extends Point>(map: Pick<GameMap, 'terrain'>, candidates: readonly T[], destination: Point, mover: Mover): T | undefined {
  let best: T | undefined;
  let shortest = Infinity;
  for (const candidate of candidates) {
    const route = walkingDistance(map, candidate, destination, mover);
    if (route !== undefined && route < shortest) {
      best = candidate;
      shortest = route;
    }
  }
  return best;
}
