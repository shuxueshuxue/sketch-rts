import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, Unit } from "../shared/types";
import { headingDifference } from '../shared/ship-navigation';

type Point = { x: number; y: number; heading?:number };

type Glide = { from: Point; to: Point; start: number; span: number; dashing: boolean };

// A snapshot gap longer than this is a new game or a resync, not motion: nothing glides across it.
const MAX_GLIDE_TICKS = 10;

/**
 * @@@unit-motion - Where to draw a charging rider, or any unit a shove sends sliding (see @@@push), between snapshots. A
 * unit walks a few world units a tick, but a slide covers up to 24 a tick: drawn at its snapshot spot it would jump every
 * tick, several frames apart at 60 fps. So while a unit charges or slides, and for the step it stops on, it glides from
 * where it was drawn when a new tick arrived to where that tick put it, over the tick's time; every other unit is drawn
 * where the snapshot puts it. The
 * clock is the frame's `now` (the page's clock, or a recording's video time), never the wall clock.
 */
export class UnitMotionSmoother {
  private glides = new Map<string, Glide>();
  private spareGlides = new Map<string, Glide>();
  private lastSeen = new Map<string, Point>();
  private spareLastSeen = new Map<string, Point>();
  private lastTick: number | undefined;

  constructor(private readonly tickMs = 1000 / SIM_TICKS_PER_SECOND) {}

  /** Takes up a snapshot; a snapshot already taken up (the same tick drawn again) changes nothing. */
  update(snapshot: Pick<GameSnapshot, "tick" | "units">, now: number) {
    if (snapshot.tick === this.lastTick) return;
    const ticks = this.lastTick === undefined ? 0 : snapshot.tick - this.lastTick;
    const glides = this.spareGlides;
    glides.clear();
    if (ticks > 0 && ticks <= MAX_GLIDE_TICKS) {
      for (const unit of snapshot.units) {
        const dashing = unit.order.type === "charge" || unit.pushX !== undefined || Boolean(unit.deck) || Boolean(unit.sailing);
        const previous = this.glides.get(unit.id);
        if (!dashing && !previous?.dashing) continue;
        const from = previous ? glidePoint(previous, now) : (this.lastSeen.get(unit.id) ?? unit);
        glides.set(unit.id, { from: { ...from }, to: { x: unit.x, y: unit.y,...(unit.sailing?{heading:unit.sailing.heading}:{}) }, start: now, span: ticks * this.tickMs, dashing });
      }
    }
    this.spareGlides = this.glides;
    this.glides = glides;
    const lastSeen = this.spareLastSeen;
    lastSeen.clear();
    // Finish reading all previous positions above before reusing their records.
    // Glide endpoints own copies, so later snapshots cannot move an active glide.
    for (const unit of snapshot.units) {
      const point = this.lastSeen.get(unit.id) ?? { x: unit.x, y: unit.y };
      point.x = unit.x;
      point.y = unit.y;
      if (unit.sailing) point.heading = unit.sailing.heading;
      else delete point.heading;
      lastSeen.set(unit.id, point);
    }
    this.spareLastSeen = this.lastSeen;
    this.lastSeen = lastSeen;
    this.lastTick = snapshot.tick;
  }

  /** The current glide's full path, for broad-phase viewport queries. Endpoints
   * are owned by the glide and remain valid until the next accepted tick. */
  bounds(unit: Pick<Unit, 'id'>): Readonly<{ from: Point; to: Point }> | undefined {
    return this.glides.get(unit.id);
  }

  /** Where to draw the unit at `now`. */
  position(unit: Pick<Unit, "id" | "x" | "y">, now: number): Point {
    const glide = this.glides.get(unit.id);
    const point=glide ? glidePoint(glide, now) : unit;
    return{x:point.x,y:point.y};
  }
  heading(unit:Pick<Unit,'id'|'sailing'>,now:number) {
    const glide=this.glides.get(unit.id);
    return (glide ? glidePoint(glide,now).heading : undefined) ?? unit.sailing?.heading ?? 0;
  }
}

function glidePoint(glide: Glide, now: number): Point {
  const t = glide.span > 0 ? Math.max(0, Math.min(1, (now - glide.start) / glide.span)) : 1;
  return { x: glide.from.x + (glide.to.x - glide.from.x) * t, y: glide.from.y + (glide.to.y - glide.from.y) * t,
    ...(glide.from.heading!==undefined && glide.to.heading!==undefined?{heading:glide.from.heading+headingDifference(glide.from.heading,glide.to.heading)*t}:{}) };
}
