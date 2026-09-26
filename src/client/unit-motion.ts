import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, Unit } from "../shared/types";

type Point = { x: number; y: number };

type Glide = { from: Point; to: Point; start: number; span: number; dashing: boolean };

// A snapshot gap longer than this is a new game or a resync, not motion: nothing glides across it.
const MAX_GLIDE_TICKS = 10;

/**
 * @@@unit-motion - Where to draw a charging rider between snapshots. A rider walks a few world units a tick, but a
 * charge covers dashSpeed (30) a tick: drawn at its snapshot spot it would jump every tick, three or more frames apart at
 * 60 fps. So while a unit charges, and for the step it lands on, it glides from where it was drawn when a new tick
 * arrived to where that tick put it, over the tick's time; every other unit is drawn where the snapshot puts it. The
 * clock is the frame's `now` (the page's clock, or a recording's video time), never the wall clock.
 */
export class UnitMotionSmoother {
  private glides = new Map<string, Glide>();
  private lastSeen = new Map<string, Point>();
  private lastTick: number | undefined;

  constructor(private readonly tickMs = 1000 / SIM_TICKS_PER_SECOND) {}

  /** Takes up a snapshot; a snapshot already taken up (the same tick drawn again) changes nothing. */
  update(snapshot: Pick<GameSnapshot, "tick" | "units">, now: number) {
    if (snapshot.tick === this.lastTick) return;
    const ticks = this.lastTick === undefined ? 0 : snapshot.tick - this.lastTick;
    const glides = new Map<string, Glide>();
    if (ticks > 0 && ticks <= MAX_GLIDE_TICKS) {
      for (const unit of snapshot.units) {
        const dashing = unit.order.type === "charge";
        const previous = this.glides.get(unit.id);
        if (!dashing && !previous?.dashing) continue;
        const from = previous ? glidePoint(previous, now) : (this.lastSeen.get(unit.id) ?? unit);
        glides.set(unit.id, { from: { x: from.x, y: from.y }, to: { x: unit.x, y: unit.y }, start: now, span: ticks * this.tickMs, dashing });
      }
    }
    this.glides = glides;
    this.lastSeen = new Map(snapshot.units.map((unit) => [unit.id, { x: unit.x, y: unit.y }]));
    this.lastTick = snapshot.tick;
  }

  /** Where to draw the unit at `now`. */
  position(unit: Pick<Unit, "id" | "x" | "y">, now: number): Point {
    const glide = this.glides.get(unit.id);
    return glide ? glidePoint(glide, now) : { x: unit.x, y: unit.y };
  }
}

function glidePoint(glide: Glide, now: number): Point {
  const t = glide.span > 0 ? Math.max(0, Math.min(1, (now - glide.start) / glide.span)) : 1;
  return { x: glide.from.x + (glide.to.x - glide.from.x) * t, y: glide.from.y + (glide.to.y - glide.from.y) * t };
}
