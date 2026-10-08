import { BUILDING_DEFS } from "./catalog";
import { isBuildPlacementClear, resourceBlocksPlacement } from "./build-placement";
import { isFootprintBuildable, sameGround, snapToFootprint } from "./terrain";
import type { GameSnapshot } from "./types";

type Point = { x: number; y: number };
const candidatesByMap = new WeakMap<object, Map<string, Point[]>>();

/** Search the mine's own land for a dry hall foundation with room for the haul lane. */
export function miningHallSite(snapshot: Pick<GameSnapshot, "map" | "buildings" | "resources" | "obstacles">, mine: Point, preferred: Point = mine): Point | undefined {
  const radius = BUILDING_DEFS.townHall.radius;
  const cell = snapshot.map.terrain?.cell ?? 16;
  let cache = candidatesByMap.get(snapshot.map);
  if (!cache) {
    cache = new Map();
    candidatesByMap.set(snapshot.map, cache);
  }
  const key = `${mine.x}:${mine.y}:${preferred.x}:${preferred.y}`;
  let points = cache.get(key);
  if (!points) {
    points = [];
    const center = snapToFootprint(snapshot.map, radius, mine);
    const steps = Math.ceil(300 / cell);
    for (let row = -steps; row <= steps; row++) {
      for (let col = -steps; col <= steps; col++) {
        const point = { x: center.x + col * cell, y: center.y + row * cell };
        if (Math.hypot(point.x - mine.x, point.y - mine.y) > 300) continue;
        if (point.x - radius < 0 || point.y - radius < 0 || point.x + radius > snapshot.map.width || point.y + radius > snapshot.map.height) continue;
        if (!isFootprintBuildable(snapshot.map, point.x, point.y, radius)) continue;
        if (resourceBlocksPlacement(snapshot.map, "townHall", point, mine)) continue;
        points.push(point);
      }
    }
    points.sort((a, b) => (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2 - ((b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2));
    cache.set(key, points);
  }
  // Only static terrain is cached: construction and destruction still change the available sites immediately.
  return points.find(point => sameGround(snapshot.map, point, mine) && isBuildPlacementClear(snapshot, "townHall", point));
}
