import { SIM_TICKS_PER_SECOND } from '../shared/time';
import type { GameMap, GameSnapshot } from '../shared/types';
import { windAt } from '../shared/wind-field';
import type { Point, Rect, WorldSize } from './minimap';

export type DisplayWind = { direction: number; speed: number };
export type WindSampler = (map: GameMap, point: Point) => DisplayWind;
type WindSnapshot = Pick<GameSnapshot, 'tick' | 'map'>;
type Brush = CanvasRenderingContext2D;

const TURN_MS = 1500;
const NOTICE_MS = 2600;
const EVENT_FRESHNESS_TICKS = 2 * SIM_TICKS_PER_SECOND;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const shortestAngle = (from: number, to: number) => ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const ease = (value: number) => value * value * (3 - 2 * value);

/** Shared by the wind button and the map, so cursor samples and map arrows agree.
 * Wall time affects only this display; simulation wind is already in the snapshot. */
export class WindMapDisplay {
  private map: GameMap | undefined;
  private lastTick: number | undefined;
  private lastEventTick: number | undefined;
  private transition: { from: GameMap; startedAt: number } | undefined;
  private readonly sampler: WindSampler;
  private reducedMotion: boolean;

  constructor(options: { reducedMotion?: boolean; sampler?: WindSampler } = {}) {
    this.sampler = options.sampler ?? windAt;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  reset() {
    this.map = undefined;
    this.lastTick = undefined;
    this.lastEventTick = undefined;
    this.transition = undefined;
  }

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
  }

  update(snapshot: WindSnapshot, now: number) {
    const { map, tick } = snapshot;
    const eventTick = map.wind?.changedAtTick;
    const reset = this.lastTick === undefined || tick < this.lastTick || map.id !== this.map?.id;
    if (reset) {
      // Loading a game, joining a match and seeking backwards are not new weather events.
      this.transition = undefined;
      this.lastEventTick = eventTick;
    } else if (eventTick !== undefined && eventTick !== this.lastEventTick &&
      this.lastTick! < eventTick && eventTick <= tick) {
      this.lastEventTick = eventTick;
      this.transition = undefined;
      if (tick - eventTick <= EVENT_FRESHNESS_TICKS && map.wind?.fromDirection !== undefined && map.wind.fromSpeed !== undefined) {
        this.transition = {
          from: { ...map, wind: { ...map.wind, direction: map.wind.fromDirection, speed: map.wind.fromSpeed } },
          startedAt: now,
        };
      }
    }
    // A caller may reuse its map object for later snapshots. Keep this displayed field stable.
    this.map = { ...map, ...(map.wind ? { wind: { ...map.wind } } : {}) };
    this.lastTick = tick;
  }

  sample(point: Point, now: number): DisplayWind {
    if (!this.map) return { direction: 0, speed: 0 };
    const target = this.sampler(this.map, point);
    if (!this.transition || this.reducedMotion) return target;
    const progress = ease(clamp((now - this.transition.startedAt) / TURN_MS, 0, 1));
    if (progress >= 1) return target;
    const from = this.sampler(this.transition.from, point);
    return {
      direction: from.direction + shortestAngle(from.direction, target.direction) * progress,
      speed: from.speed + (target.speed - from.speed) * progress,
    };
  }

  /** A brief highlight also works when the player has left the wind map closed. */
  pulse(now: number): number {
    if (!this.transition) return 0;
    const elapsed = now - this.transition.startedAt;
    if (elapsed < 0 || elapsed >= NOTICE_MS) return 0;
    if (this.reducedMotion) return 1;
    const progress = elapsed / NOTICE_MS;
    return clamp(elapsed / 140, 0, 1) * (1 - progress) * (.78 + .22 * Math.cos(progress * Math.PI * 4));
  }

  draw(ctx: Brush, rect: Rect, now: number) {
    if (!this.map) return;
    const progress = this.transition ? clamp((now - this.transition.startedAt) / NOTICE_MS, 0, 1) : 1;
    drawMinimapWind(ctx, this.map, rect, (point) => this.sample(point, now), {
      pulse: this.pulse(now), sweep: this.reducedMotion ? undefined : progress,
    });
  }
}

/** Project a world-XY airflow into the minimap, including non-square map scales. */
export function projectWindDirection(direction: number, world: WorldSize, rect: Rect): number {
  return Math.atan2(Math.sin(direction) * rect.height / world.height, Math.cos(direction) * rect.width / world.width);
}

/** Each arrow samples its own world position; a future regional field uses the same path. */
export function drawMinimapWind(ctx: Brush, world: WorldSize, rect: Rect,
  sample: (point: Point) => DisplayWind, options: { pulse?: number; sweep?: number | undefined } = {}) {
  if (rect.width <= 0 || rect.height <= 0 || world.width <= 0 || world.height <= 0) return;
  const columns = clamp(Math.round(rect.width / 55), 3, 7);
  const rows = clamp(Math.round(rect.height / 55), 3, 7);
  const cellWidth = rect.width / columns, cellHeight = rect.height / rows;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.fillStyle = 'rgba(17, 39, 48, 0.20)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const u = (column + .5) / columns, v = (row + .5) / rows;
      const wind = sample({ x: u * world.width, y: v * world.height });
      const x = rect.x + u * rect.width, y = rect.y + v * rect.height;
      const direction = projectWindDirection(wind.direction, world, rect);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(direction);
      ctx.beginPath();
      if (wind.speed <= 1e-7) {
        ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
      } else {
        const length = Math.min(cellWidth, cellHeight) * (.25 + .21 * clamp(wind.speed / 80, 0, 1.5));
        const tail = -length * .5, tip = length * .5, wing = Math.min(5, length * .25);
        ctx.moveTo(tail, 0);
        ctx.lineTo(tip, 0);
        ctx.moveTo(tip - wing, -wing);
        ctx.lineTo(tip, 0);
        ctx.lineTo(tip - wing, wing);
      }
      ctx.strokeStyle = 'rgba(19, 39, 49, 0.82)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = wind.speed <= 1e-7 ? 'rgba(218, 238, 231, 0.60)' : 'rgba(228, 246, 229, 0.88)';
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.restore();
    }
  }
  // One quiet sweep acknowledges new weather; there is no looping map animation.
  if ((options.pulse ?? 0) > 0 && options.sweep !== undefined && options.sweep < 1) {
    const center = { x: world.width / 2, y: world.height / 2 };
    const direction = projectWindDirection(sample(center).direction, world, rect);
    const radius = Math.hypot(rect.width, rect.height) / 2;
    const offset = (options.sweep * 2 - 1) * radius;
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.rotate(direction);
    const halfWidth = radius * .18;
    const light = ctx.createLinearGradient(offset - halfWidth, 0, offset + halfWidth, 0);
    light.addColorStop(0, 'rgba(216, 245, 226, 0)');
    light.addColorStop(.5, `rgba(216, 245, 226, ${.20 * options.pulse!})`);
    light.addColorStop(1, 'rgba(216, 245, 226, 0)');
    ctx.fillStyle = light;
    ctx.fillRect(offset - halfWidth, -radius, halfWidth * 2, radius * 2);
  }
  ctx.restore();
}
