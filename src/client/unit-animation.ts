import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, Unit } from "../shared/types";

export type UnitAnimationFrame = { mode: "idle" | "walk" | "attack" | "cast"; frame: number };
export const IDLE_FRAME: UnitAnimationFrame = Object.freeze({ mode: "idle", frame: 0 });
const TICK_MS = 1000 / SIM_TICKS_PER_SECOND;
const WALK_FRAMES = 8;
const ACTION_FRAMES = 6;
const ATTACK_MS = 300;
const CAST_MS = 500;

type Track = {
  x: number; y: number; cooldown: number;
  deck?: NonNullable<Unit['deck']>;
  abilities: NonNullable<Unit["abilityCooldowns"]>;
  phase: number; speed: number; moving: boolean;
  action?: { mode: "attack" | "cast"; tick: number };
};

/** Presentation only: observed displacement drives feet; a cooldown *increase*
 * triggers an actual strike/cast. An attack order alone must never start a swing.
 * Time advances with snapshots plus at most one interpolated tick, so a paused
 * match or stalled network does not leave soldiers marching or casting forever. */
export class UnitAnimationTracker {
  private tracks = new Map<string, Track>();
  private tick: number | undefined;
  private receivedAt = 0;

  update(snapshot: Pick<GameSnapshot, "tick" | "units">, now: number) {
    if (snapshot.tick === this.tick) return;
    const gap = this.tick === undefined ? 0 : snapshot.tick - this.tick;
    const continuous = gap > 0 && gap <= 10;
    const next = new Map<string, Track>();
    for (const unit of snapshot.units) {
      const previous = continuous ? this.tracks.get(unit.id) : undefined;
      const distance = !previous ? 0 : unit.deck || previous.deck
        ? unit.deck?.shipId===previous.deck?.shipId ? Math.hypot(unit.deck!.x-previous.deck!.x,unit.deck!.y-previous.deck!.y) : 0
        : Math.hypot(unit.x - previous.x, unit.y - previous.y);
      // Teleports and forced slides are not walking. Charge still has a gallop.
      const moving = Boolean(previous && distance / gap > 0.25 && distance / gap < 32 && unit.pushX === undefined);
      const phase = (previous?.phase ?? phaseFor(unit.id)) + (moving ? distance / 28 : 0);
      let action = previous?.action;
      if (previous) {
        if (unit.cooldown > previous.cooldown && unit.order.type !== "repair" && unit.order.type !== "repairShip") action = { mode: "attack", tick: snapshot.tick };
        const cast = Object.entries(unit.abilityCooldowns ?? {}).some(([ability, ticks]) =>
          ability !== "charge" && ticks! > (previous.abilities[ability as keyof Track["abilities"]] ?? 0));
        if (cast) action = { mode: "cast", tick: snapshot.tick };
      }
      if (unit.effects.some((effect) => effect.type === "stun")) action = undefined;
      const track: Track = {
        x: unit.x, y: unit.y, cooldown: unit.cooldown,
        abilities: { ...unit.abilityCooldowns }, phase: phase % 1,
        speed: moving ? distance / gap / 28 : 0,
        moving: moving && !unit.effects.some((effect) => effect.type === "stun"),
        ...(unit.deck ? {deck:{...unit.deck}} : {}),
        ...(action ? { action } : {}),
      };
      next.set(unit.id, track);
    }
    this.tracks = next;
    this.tick = snapshot.tick;
    this.receivedAt = now;
  }

  frame(unit: Pick<Unit, "id">, now: number): UnitAnimationFrame {
    const track = this.tracks.get(unit.id);
    if (!track || this.tick === undefined) return IDLE_FRAME;
    const fraction = Math.max(0, Math.min(1, (now - this.receivedAt) / TICK_MS));
    if (track.action) {
      const duration = track.action.mode === "cast" ? CAST_MS : ATTACK_MS;
      const progress = ((this.tick - track.action.tick + fraction) * TICK_MS) / duration;
      if (progress >= 0 && progress < 1) return { mode: track.action.mode, frame: Math.min(ACTION_FRAMES - 1, Math.floor(progress * ACTION_FRAMES)) };
    }
    return track.moving
      ? { mode: "walk", frame: Math.floor(((track.phase + track.speed * fraction) % 1) * WALK_FRAMES) }
      : IDLE_FRAME;
  }
}

function phaseFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  return (hash % WALK_FRAMES) / WALK_FRAMES;
}
