import { detCos, detSin } from './det-math';
import { polygonRadius } from './navigation-math';
import { shipProfile } from './ship-geometry';
import type { ShipPose } from './ship-navigation';
import { footprintHalf } from './terrain';
import type { Building, GameMap } from './types';
import type { Unit } from './types';

const OUTWARD_STEPS = [0, 32, 64] as const;
const LAUNCH_GAP = 4;
type Point = { x: number; y: number };

/** The native pier's twenty contacts, in face/offset order. They bound the
 * possible water components without a route, traffic or best-pose query. */
export function shipLaunchAnchors(map: GameMap, dock: Building): Point[] {
  const half = map.terrain ? footprintHalf(dock.radius, map.terrain.cell) : dock.radius;
  const anchors: Point[] = [];
  for (let face = 0; face < 4; face++) for (const offset of [0, -half / 2, half / 2, -half, half]) {
    const tangent = Math.max(-half + 1, Math.min(half - 1, offset));
    anchors.push(face === 0 ? { x: dock.x + half + 1, y: dock.y + tangent }
      : face === 1 ? { x: dock.x - half - 1, y: dock.y + tangent }
      : face === 2 ? { x: dock.x + tangent, y: dock.y + half + 1 }
      : { x: dock.x + tangent, y: dock.y - half - 1 });
  }
  return anchors;
}

/** Pure preparation of the original native candidates. Enumeration and all
 * hull/water/passage checks remain with the caller's budget. This helper has
 * no steering, world entities, traffic, rally ranking or mutable world cache. */
export function shipLaunchCandidates(map: GameMap, dock: Building, ship: Unit) {
  const profile = shipProfile(ship)!, half = map.terrain ? footprintHalf(dock.radius, map.terrain.cell) : dock.radius;
  const offsets = [0, -half / 2, half / 2, -half, half], anchors = shipLaunchAnchors(map, dock);
  const bounds = new Map<number, { left: number; right: number; top: number; bottom: number }>();
  return { count: 16 * 4 * 5 * OUTWARD_STEPS.length,
    reach: half + polygonRadius(profile.hull) + 64 + (map.terrain?.cell ?? 0),
    at(index: number): { pose: ShipPose; entry: ShipPose; anchor: Point; outward: number } {
      const direction = Math.floor(index / 60), contact = Math.floor(index / 3) % 20;
      const face = Math.floor(contact / 5), offset = offsets[contact % 5]!, outward = OUTWARD_STEPS[index % 3]!;
      const heading = direction * Math.PI / 8;
      let box = bounds.get(direction);
      if (!box) {
        const c = detCos(heading), s = detSin(heading);
        const hull = profile.hull.map(point => ({ x: point.x * c - point.y * s, y: point.x * s + point.y * c }));
        box = { left: Math.min(...hull.map(point => point.x)), right: Math.max(...hull.map(point => point.x)),
          top: Math.min(...hull.map(point => point.y)), bottom: Math.max(...hull.map(point => point.y)) };
        bounds.set(direction, box);
      }
      const gap = LAUNCH_GAP + outward;
      const point = face === 0 ? { x: dock.x + half - box.left + gap, y: dock.y + offset }
        : face === 1 ? { x: dock.x - half - box.right - gap, y: dock.y + offset }
        : face === 2 ? { x: dock.x + offset, y: dock.y + half - box.top + gap }
        : { x: dock.x + offset, y: dock.y - half - box.bottom - gap };
      return { pose: { ...point, heading }, anchor: anchors[contact]!, outward,
        entry: { x: point.x - (face === 0 ? outward : face === 1 ? -outward : 0),
          y: point.y - (face === 2 ? outward : face === 3 ? -outward : 0), heading } };
    },
  };
}
