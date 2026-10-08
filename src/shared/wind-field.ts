import { detCos, detSin } from './det-math';
import { seedHash } from './environment/noise';
import { seconds } from './time';
import type { GameMap } from './types';

/** World-space air velocity points toward direction, in world distance per second. */
export const DEFAULT_WIND = { direction: Math.PI / 4, speed: 80 } as const;
export const WIND_CHANGE_INTERVAL_TICKS = seconds(8 * 60);

const angleDifference = (from: number, to: number) => ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

/** The current field is uniform. Both the chart and hull propulsion sample this
 * position-aware boundary so regional fields can later use the same callers. */
export function windAt(map: Pick<GameMap, 'wind'>, _point: { x: number; y: number }) {
  const source = map.wind ?? DEFAULT_WIND;
  const direction = angleDifference(0, Number.isFinite(source.direction) ? source.direction : DEFAULT_WIND.direction);
  const speed = Number.isFinite(source.speed) ? Math.max(0, source.speed) : DEFAULT_WIND.speed;
  return { direction, speed, x: speed * detCos(direction), y: speed * detSin(direction),
    from: angleDifference(0, direction + Math.PI), key: `${direction}:${speed}` };
}

/** Compatibility for callers that intentionally ask for the uniform field. */
export function getWind(map: Pick<GameMap, 'wind'>) {
  return windAt(map, { x: 0, y: 0 });
}

/** Apply weather only at simulation boundaries. No wall clock, random stream or
 * unrecorded timer participates: a restored old-format save without event fields
 * keeps its authored wind until the next boundary. Repeating one tick is harmless. */
export function updateWindField(map: Pick<GameMap, 'id' | 'terrain' | 'wind'>, tick: number): boolean {
  if (!Number.isSafeInteger(tick) || tick <= 0 || tick % WIND_CHANGE_INTERVAL_TICKS !== 0
    || (map.wind?.changedAtTick ?? -1) >= tick) return false;
  const previous = getWind(map), round = tick / WIND_CHANGE_INTERVAL_TICKS;
  const seed = `${map.id}:${map.terrain?.ecology?.seed ?? ''}:${round}`;
  const hash = seedHash(`${seed}:direction`);
  // Sixteen compass points, offset by 3–5 points to either side. The first
  // authored direction may lie between points; even then the change is 56–124°.
  const pointAngle = Math.PI / 8, previousPoint = Math.round(previous.direction / pointAngle);
  const nextPoint = previousPoint + (3 + hash % 3) * (hash & 8 ? -1 : 1);
  const direction = angleDifference(0, nextPoint * pointAngle);
  const speed = [40, 60, 80][seedHash(`${seed}:speed`) % 3]!;
  map.wind = { direction, speed, changedAtTick: tick, fromDirection: previous.direction, fromSpeed: previous.speed };
  return true;
}
