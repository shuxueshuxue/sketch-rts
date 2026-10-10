import type { Point } from './ship-geometry';
import { walkingDistance, type Mover } from './terrain';
import type { GameMap } from './types';

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
