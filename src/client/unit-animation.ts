import type { UnitActionCue } from "../story/stage";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, Unit, WorldEffect } from "../shared/types";

export type UnitAnimationFrame = { mode: "idle" | "walk" | "attack" | "cast" | "work"; frame: number; variant?: number; aim?: number; direction?: Readonly<{x:number;y:number;height?:number}> };
export const IDLE_FRAME: UnitAnimationFrame = Object.freeze({ mode: "idle", frame: 0 });
const TICK_MS = 1000 / SIM_TICKS_PER_SECOND;
const WALK_FRAMES = 8;
const ACTION_FRAMES = 6;
const ATTACK_MS = 300;
const CAST_MS = 500;
const MINING_STROKE_TICKS = 13;
// Finite display states are shared by every unit and renderer. No per-frame
// object allocation, and the variant participates in sprite cache identity.
const idleFrames = Array.from({ length: WALK_FRAMES }, (_, frame) => Object.freeze({ mode: "idle" as const, frame }));
const walkFrames = Array.from({ length: WALK_FRAMES }, (_, frame) => Object.freeze({ mode: "walk" as const, frame }));
const actionFrames = {
  cast: Array.from({ length: ACTION_FRAMES }, (_, frame) => Object.freeze({ mode: "cast" as const, frame })),
  work: Array.from({ length: ACTION_FRAMES }, (_, frame) => Object.freeze({ mode: "work" as const, frame })),
  attack: Array.from({ length: 3 }, (_, variant) => Array.from({ length: ACTION_FRAMES }, (_, frame) => Object.freeze({ mode: "attack" as const, frame, variant }))),
};

type Action = { mode: "attack" | "cast" | "work"; tick: number; durationMs?: number; mining?: true; variant?: number; releaseId?: string; direction?:Readonly<{x:number;y:number;height?:number}>; frames?:UnitAnimationFrame[] };
type Track = {
  x: number; y: number; cooldown: number;
  deck?: NonNullable<Unit['deck']>;
  abilities: NonNullable<Unit["abilityCooldowns"]>;
  cueTick?: number;
  releaseTick?: number;
  releaseId?: string;
  phase: number; speed: number; moving: boolean; still: boolean;
  mining?: { resourceId: string; timer: number; workTicks: number };
  action?: Action;
};

/** Presentation only: observed displacement drives feet; a cooldown *increase*
 * triggers an actual strike/cast. An attack order alone must never start a swing.
 * Time advances with snapshots plus at most one interpolated tick, so a paused
 * match or stalled network does not leave soldiers marching or casting forever. */
export class UnitAnimationTracker {
  private tracks = new Map<string, Track>();
  private tick: number | undefined;
  private receivedAt = 0;
  private releaseEffects: readonly WorldEffect[] | undefined;
  private releaseEffectCount = -1;

  update(snapshot: Pick<GameSnapshot, "tick" | "units"> & Partial<Pick<GameSnapshot, "effects">>, now: number, cues: readonly UnitActionCue[] = []) {
    const sameTick = snapshot.tick === this.tick;
    if (sameTick && snapshot.effects === this.releaseEffects && (snapshot.effects?.length ?? 0) === this.releaseEffectCount) { this.applyCues(cues, snapshot.tick); return; }
    this.releaseEffects = snapshot.effects;
    this.releaseEffectCount = snapshot.effects?.length ?? 0;
    const gap = this.tick === undefined ? 0 : snapshot.tick - this.tick;
    const continuous = gap > 0 && gap <= 10;
    // Construction and repair need a real pulse. Mining instead exposes actual
    // progress in its gather timer; merely waiting at the entrance is not work.
    const work = new Map((snapshot.effects ?? []).filter(effect => effect.type === "repair" && effect.unitId && effect.remaining > 0).map(effect => [effect.unitId!, effect]));
    const releases=new Map<string,Action>();
    for(const effect of snapshot.effects??[]) {
      if(!effect.sourceId||!effect.actionMode)continue;
      const tick=effect.actionTick??snapshot.tick-Math.max(0,effect.duration-effect.remaining);
      if(snapshot.tick-tick>SIM_TICKS_PER_SECOND)continue;
      const previous=releases.get(effect.sourceId);
      if(previous&&(previous.tick>tick||previous.tick===tick&&previous.mode==='cast'&&effect.actionMode!=='cast'))continue;
      const direction=releaseDirection(effect);
      releases.set(effect.sourceId,{mode:effect.actionMode,tick,releaseId:effect.id,...(effect.actionMode==='attack'?{variant:variantFor(effect.sourceId,tick)}:{}),...(direction?{direction}:{})});
    }
    if (sameTick) {
      // Commands and story strikes can append releases between two draws of the
      // same simulation tick. Consume them without advancing gait or the clock.
      for (const unit of snapshot.units) {
        const track=this.tracks.get(unit.id),release=releases.get(unit.id);
        if(!track||!release||track.releaseId===release.releaseId||release.tick<(track.releaseTick??-1))continue;
        track.releaseTick=release.tick;track.releaseId=release.releaseId!;
        // The command may already have raised these cooldowns. Record that
        // observation so the next tick does not invent a second release.
        track.cooldown=unit.cooldown;track.abilities={...unit.abilityCooldowns};
        if(track.still||unit.hp<=0||unit.effects.some(effect=>effect.type==='stun')||track.action&&track.action.tick>release.tick)continue;
        track.action=release;
      }
      this.applyCues(cues,snapshot.tick);return;
    }
    const next = new Map<string, Track>();
    for (const unit of snapshot.units) {
      const previous = continuous ? this.tracks.get(unit.id) : undefined;
      const distance = !previous ? 0 : unit.deck || previous.deck
        ? unit.deck?.shipId===previous.deck?.shipId ? Math.hypot(unit.deck!.x-previous.deck!.x,unit.deck!.y-previous.deck!.y) : 0
        : Math.hypot(unit.x - previous.x, unit.y - previous.y);
      // Teleports and forced slides are not walking. Charge still has a gallop.
      const moving = Boolean(previous && distance / gap > 0.25 && distance / gap < 32 && unit.pushX === undefined && unit.pushY === undefined);
      const phase = (previous?.phase ?? phaseFor(unit.id)) + (moving ? distance / 28 : 0);
      let action = previous?.action;
      if (previous) {
        if (unit.cooldown > previous.cooldown && unit.order.type !== "repair" && unit.order.type !== "repairUnit" && unit.order.type !== "repairShip") action = { mode: "attack", tick: snapshot.tick, variant: variantFor(unit.id, snapshot.tick) };
        const cast = Object.entries(unit.abilityCooldowns ?? {}).some(([ability, ticks]) =>
          ability !== "charge" && ticks! > (previous.abilities[ability as keyof Track["abilities"]] ?? 0));
        if (cast) action = { mode: "cast", tick: snapshot.tick };
      }
      const release=releases.get(unit.id);
      if(release&&(!action||release.tick>action.tick||release.tick===action.tick&&(!action.direction||release.mode==='cast'&&action.mode!=='cast')
        ||action!==previous?.action&&release.tick===this.tick&&release.tick>(previous?.releaseTick??-1)))action=release;
      const pulse = unit.kind === "worker" && unit.order.type !== "mine" && !moving ? work.get(unit.id) : undefined;
      const gathering = unit.kind === "worker" && unit.order.type === "mine" && unit.order.phase === "gather" && unit.order.timer > 0
        ? unit.order : undefined;
      const oldMining = gathering && previous?.mining?.resourceId === gathering.resourceId ? previous.mining : undefined;
      const minedTicks = gathering && oldMining ? Math.max(0, oldMining.timer - gathering.timer) : 0;
      const workTicks = ((oldMining?.workTicks ?? 0) + minedTicks) % MINING_STROKE_TICKS;
      if (pulse) action = { mode: "work", tick: snapshot.tick - pulse.duration + pulse.remaining, durationMs: pulse.duration * TICK_MS };
      else if (minedTicks > 0 && !moving && unit.hp > 0 && unit.pushX === undefined && unit.pushY === undefined) {
        // Count timer progress, rather than wall time or an order's age, so a
        // held miner cannot keep swinging and a network pause freezes the pose.
        action = { mode: "work", tick: snapshot.tick - workTicks, durationMs: MINING_STROKE_TICKS * TICK_MS, mining: true };
      } else if (action?.mining || (moving || unit.order.type === "mine") && action?.mode === "work") action = undefined;
      if (unit.effects.some((effect) => effect.type === "stun")) action = undefined;
      const track: Track = {
        x: unit.x, y: unit.y, cooldown: unit.cooldown,
        abilities: { ...unit.abilityCooldowns }, phase: phase % 1,
        speed: moving ? distance / gap / 28 : 0,
        moving: moving && !unit.effects.some((effect) => effect.type === "stun"),
        still: unit.hp <= 0 || unit.pushX !== undefined || unit.pushY !== undefined || unit.effects.some(effect => effect.type === "stun"),
        ...(gathering ? { mining: { resourceId: gathering.resourceId, timer: gathering.timer, workTicks } } : {}),
        ...(unit.deck ? {deck:{...unit.deck}} : {}),
        ...(action ? { action } : {}),
        ...(release||previous?.releaseTick!==undefined?{releaseTick:Math.max(release?.tick??-1,previous?.releaseTick??-1)}:{}),
        ...(release?.releaseId??previous?.releaseId?{releaseId:release?.releaseId??previous!.releaseId!}:{}),
        ...(previous?.cueTick !== undefined ? { cueTick: previous.cueTick } : {}),
      };
      next.set(unit.id, track);
    }
    this.tracks = next;
    this.tick = snapshot.tick;
    this.receivedAt = now;
    this.applyCues(cues, snapshot.tick);
  }

  private applyCues(cues: readonly UnitActionCue[], tick: number) {
    for (const cue of cues) {
      const track = this.tracks.get(cue.unitId);
      if (!track || cue.tick > tick || tick - cue.tick > SIM_TICKS_PER_SECOND || cue.tick <= (track.cueTick ?? -1)) continue;
      track.cueTick = cue.tick;
      if (track.still || track.action && track.action.tick > cue.tick) continue;
      const direction=releaseDirection(cue);
      track.action = { mode: cue.mode, tick: cue.tick, ...(direction?{direction}:{}), ...(cue.mode === "attack" ? { variant: variantFor(cue.unitId, cue.tick) } : {}) };
    }
  }

  frame(unit: Pick<Unit, "id">, now: number): UnitAnimationFrame {
    const track = this.tracks.get(unit.id);
    if (!track || this.tick === undefined || track.still) return IDLE_FRAME;
    const fraction = Math.max(0, Math.min(1, (now - this.receivedAt) / TICK_MS));
    if (track.action) {
      const duration = track.action.durationMs ?? (track.action.mode === "cast" ? CAST_MS : ATTACK_MS);
      const progress = ((this.tick - track.action.tick + fraction) * TICK_MS) / duration;
      if (progress >= 0 && (progress < 1 || track.action.mining)) {
        const frame = Math.min(ACTION_FRAMES - 1, Math.floor(progress * ACTION_FRAMES));
        const base=track.action.mode === "attack" ? actionFrames.attack[track.action.variant ?? 0]![frame]! : actionFrames[track.action.mode][frame]!;
        if(!track.action.direction)return base;
        track.action.frames??=[];
        return track.action.frames[frame]??=(Object.freeze({...base,direction:track.action.direction}));
      }
    }
    return track.moving
      ? walkFrames[Math.floor(((track.phase + track.speed * fraction) % 1) * WALK_FRAMES)]!
      : idleFrames[Math.floor(((this.tick + fraction) / (SIM_TICKS_PER_SECOND * 3) + phaseFor(unit.id)) % 1 * WALK_FRAMES)]!;
  }
}

function phaseFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  return (hash % WALK_FRAMES) / WALK_FRAMES;
}

/** Stateless presentation choice: independent of RNG, render frequency and
 * tracker lifetime. Replaying the same hit produces the same contact pose. */
function variantFor(id: string, tick: number) {
  let hash = tick >>> 0;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash >>> 0) % 3;
}


function releaseDirection(cue:{fromX?:number;fromY?:number;toX?:number;toY?:number;fromHeight?:number;toHeight?:number;actionToX?:number;actionToY?:number}):Readonly<{x:number;y:number;height?:number}>|undefined {
  if(!Number.isFinite(cue.fromX)||!Number.isFinite(cue.fromY)||!Number.isFinite(cue.toX)||!Number.isFinite(cue.toY))return;
  const x=(cue.actionToX??cue.toX!)-cue.fromX!,y=(cue.actionToY??cue.toY!)-cue.fromY!;
  const height=Number.isFinite(cue.fromHeight)&&Number.isFinite(cue.toHeight)?cue.toHeight!-cue.fromHeight!:undefined;
  return Math.hypot(x,y,height??0)>1e-6?Object.freeze({x,y,...(height?{height}:{})}):undefined;
}


/** The exact contact/release pose used both by the actor and its visual weapon
 * socket. Missing older launch metadata is deliberately not reconstructed. */
const releasePoses=new WeakMap<WorldEffect,UnitAnimationFrame>();
export function releasePoseForEffect(effect:WorldEffect):UnitAnimationFrame|undefined {
  if(!effect.sourceId||!effect.actionMode||effect.actionTick===undefined)return;
  let pose=releasePoses.get(effect);
  if(!pose) {
    const base=effect.actionMode==='cast'?actionFrames.cast[0]!:actionFrames.attack[variantFor(effect.sourceId,effect.actionTick)]![0]!;
    const direction=releaseDirection(effect);
    pose=direction?Object.freeze({...base,direction}):base;
    releasePoses.set(effect,pose);
  }
  return pose;
}
