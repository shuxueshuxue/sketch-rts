import type { Point } from './ship-geometry';
import { groundUnder } from './terrain';
import { SIM_TICKS_PER_SECOND } from './time';
import type { GameMap } from './types';

/** Local straight travel through walkable terrain at the engine's per-tick ground pace.
 * Positive speed and a clear segment are caller contracts; excludes status and body detours. */
export function groundSegmentTravelTicks(map: Pick<GameMap, 'terrain'>, from: Point, to: Point, speed: number): number {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  let traveled = 0, ticks = 0;
  while (traveled < length) {
    const pace = groundUnder(map, from.x + dx * traveled / length, from.y + dy * traveled / length).pace;
    traveled += speed * pace / SIM_TICKS_PER_SECOND;
    ticks++;
  }
  return ticks;
}

/** A constant-speed segment stays outside a threat whose reach expands at speed * seconds.
 * This is a swept geometric test, not terrain routing or a prediction of the enemy's chosen path. */
export function segmentAvoidsExpandingDisk(from: Point, to: Point, disk: Point & { radius: number; speed: number }, seconds: number): boolean {
  const x = from.x - disk.x, y = from.y - disk.y, dx = to.x - from.x, dy = to.y - from.y;
  const growth = disk.speed * seconds;
  const a = dx * dx + dy * dy - growth * growth;
  const b = 2 * (x * dx + y * dy - disk.radius * growth);
  const c = x * x + y * y - disk.radius * disk.radius;
  if (c <= 0 || a + b + c <= 0) return false;
  if (a <= 0) return true; // A concave quadratic has its minimum at an endpoint.
  const at = Math.max(0, Math.min(1, -b / (2 * a)));
  return (a * at + b) * at + c > 0;
}
