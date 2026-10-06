import { UNIT_DEFS } from "../shared/catalog";
import { resources,type ResourcePhase } from './resources';
import type { UnitKind } from "../shared/types";

// @@@sound - The game's sounds, heard on the client only: the simulation never hears them, so a game plays the same with
// or without them. What a game sounds like is a sound pack's (see @@@sound-packs): for each event below, the recording
// it plays (one, or one per unit kind of who caused it, so a blow sounds as its striker's weapon), how loud, how far its
// pitch may stray, and how many of it may sound at once. With no pack chosen, or a pack without an event, it is silent.
// Each play strays a little in pitch and level, so the tenth blow is not the first again. Events belong to a group with
// its own volume (effects, interface) under one mute; the choices are kept in the browser. The battlefield goes through
// a compressor, a sound already playing is quieter for each copy of it, and no more than a dozen play at once.

export type SoundGroup = "effects" | "ui";
export type SoundEvent = "impact" | "melee" | "arrowShot" | "arrowHit" | "death" | "construction" | "built" | "buildingDown" | "click" | "menu" | "shipShot" | "shipHit" | "shipSink" | "spell" | "board" | "unload" | "select" | "order" | "cannonShot" | "mortarShot" | "boltShot" | "flameShot" | "stoneShot" | "spellShot" | "grapeshotShot";
export const SOUND_EVENTS: readonly SoundEvent[] = ["impact", "melee", "arrowShot", "arrowHit", "death", "construction", "built", "buildingDown", "click", "menu", "shipShot", "shipHit", "shipSink", "spell", "board", "unload", "select", "order", "cannonShot", "mortarShot", "boltShot", "flameShot", "stoneShot", "spellShot", "grapeshotShot"];
const EVENT_GROUPS: Record<SoundEvent, SoundGroup> = {
  cannonShot: "effects", mortarShot: "effects", boltShot: "effects", flameShot: "effects", stoneShot: "effects", spellShot: "effects", grapeshotShot: "effects",
  impact: "effects",
  melee: "effects",
  arrowShot: "effects",
  arrowHit: "effects",
  death: "effects",
  construction: "effects",
  built: "effects",
  buildingDown: "effects",
  click: "ui",
  menu: "ui",
  shipShot: "effects", shipHit: "effects", shipSink: "effects", spell: "effects",
  board: "effects", unload: "effects", select: "ui", order: "ui",
};

// One recording as a pack plays it: its file in the pack's folder and the address it is fetched from, its volume (1 as
// recorded), and how far a play may stray in pitch (0.05 is 5% up or down).
export type PackClip = { file: string; url: string; volume: number; pitch: number; variants?: { file: string; url: string }[] };
// An event's sound in a pack: the clip it plays, one per unit kind named in kinds (the event's own clip, if any, for
// the kinds not named), and how many plays of it may sound at once.
export type PackSound = { clip?: PackClip; kinds: Partial<Record<UnitKind, PackClip>>; max: number };
export type SoundPack = { id: string; name: string; sounds: Partial<Record<SoundEvent, PackSound>> };
export type SoundSettings = { effects: number; ui: number; muted: boolean; pack?: string };
// Where a battlefield sound falls: -1 left to 1 right, and how loud for its distance from the middle of the view.
export type SoundPlace = { pan: number; gain: number };

export const NO_SOUND_PACK = "none";
const SETTINGS_KEY = "sketch-rts-sound";
const DEFAULT_SETTINGS: SoundSettings = { effects: 0.7, ui: 0.5, muted: false };
const MAX_VOICES = 12;

// A pack from its pack.json and the addresses of the files in its folder; a manifest that does not hold throws, naming
// what is wrong.
export function readSoundPack(id: string, manifest: unknown, urls: Readonly<Record<string, string>>): SoundPack {
  const fail = (problem: string) => new Error(`Sound pack ${id}: ${problem}`);
  if (!isRecord(manifest) || typeof manifest.name !== "string" || !isRecord(manifest.sounds)) throw fail("pack.json needs a name and sounds");
  // A clip's file, volume and pitch play, the volume and pitch falling back to its event's.
  const readClip = (label: string, entry: Record<string, unknown>, base: { volume: unknown; pitch: unknown }): PackClip => {
    if (typeof entry.file !== "string") throw fail(`${label} needs a file`);
    const url = urls[entry.file];
    if (!url) throw fail(`${label} plays ${entry.file}, which is not in the pack`);
    const volume = entry.volume ?? base.volume;
    const pitch = entry.pitch ?? base.pitch;
    if (typeof volume !== "number" || !(volume > 0 && volume <= 4)) throw fail(`${label} volume must be above 0 and at most 4`);
    if (typeof pitch !== "number" || !(pitch >= 0 && pitch <= 0.5)) throw fail(`${label} pitch must be from 0 to 0.5`);
    if (entry.variants !== undefined && (!Array.isArray(entry.variants) || !entry.variants.every(file => typeof file === "string" && urls[file]))) throw fail(`${label} variants must name files in the pack`);
    return { file: entry.file, url, volume, pitch, ...(Array.isArray(entry.variants) ? { variants: entry.variants.map(file => ({ file, url: urls[file]! })) } : {}) };
  };
  const sounds: SoundPack["sounds"] = {};
  for (const [event, entry] of Object.entries(manifest.sounds)) {
    if (!SOUND_EVENTS.includes(event as SoundEvent)) throw fail(`no event ${event} (events: ${SOUND_EVENTS.join(", ")})`);
    if (!isRecord(entry)) throw fail(`${event} needs a file or kinds`);
    const base = { volume: entry.volume ?? 1, pitch: entry.pitch ?? 0 };
    const max = entry.max ?? 4;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1) throw fail(`${event} max must be a whole number of at least 1`);
    const kinds: PackSound["kinds"] = {};
    if (entry.kinds !== undefined) {
      if (!isRecord(entry.kinds)) throw fail(`${event} kinds must map unit kinds to files`);
      for (const [kind, kindEntry] of Object.entries(entry.kinds)) {
        if (!(kind in UNIT_DEFS)) throw fail(`${event} names no unit kind ${kind}`);
        if (!isRecord(kindEntry)) throw fail(`${event}.${kind} needs a file`);
        kinds[kind as UnitKind] = readClip(`${event}.${kind}`, kindEntry, base);
      }
    }
    if (entry.file === undefined && Object.keys(kinds).length === 0) throw fail(`${event} needs a file or kinds`);
    sounds[event as SoundEvent] = { ...(entry.file === undefined ? {} : { clip: readClip(event, entry, base) }), kinds, max };
  }
  return { id, name: manifest.name, sounds };
}

export class Soundboard {
  settings: SoundSettings = loadSettings();
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private groups = new Map<SoundGroup, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | undefined>>();
  private failed = new Set<string>();
  private playing = new Map<SoundEvent, number>();
  private voices = 0;
  private activeEffects = new Set<() => void>();

  stopEffects() { for (const stop of [...this.activeEffects]) stop(); }

  /** `packs` are the packs to choose from; `fallback` is the one played until the player chooses (none: silence). */
  constructor(
    public packs: readonly SoundPack[],
    private fallback?: string,
  ) {}

  // More packs to choose from (those the server offers, see @@@served-sound-packs), and the one to play until the player
  // chooses when none was named before; a pack already here keeps its place.
  addPacks(packs: readonly SoundPack[], fallback?: string) {
    this.packs = [...this.packs, ...packs.filter((pack) => !this.packs.some((known) => known.id === pack.id))];
    this.fallback ??= fallback;
    this.loadPack();
  }

  // The chosen pack, or none: the player's choice, else the fallback, else silence.
  get pack(): SoundPack | undefined {
    const id = this.settings.pack ?? this.fallback;
    return this.packs.find((pack) => pack.id === id);
  }

  // A browser lets a page make sound only after a person's gesture: the first click or key opens it.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const ctx = new Context();
    this.ctx = ctx;
    // The last guard before the speakers: nothing past full scale, however many sounds meet.
    const limiter = compressor(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1 });
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    for (const group of ["effects", "ui"] as const) {
      const node = ctx.createGain();
      // A battle's many sounds are pressed together, so a crowd of them swells less than it adds up.
      if (group === "effects") node.connect(compressor(ctx, { threshold: -24, knee: 12, ratio: 4, attack: 0.004, release: 0.3 })).connect(this.master);
      else node.connect(this.master);
      this.groups.set(group, node);
    }
    this.applySettings();
    this.loadPack();
  }

  update(change: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...change };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Without storage the choice lasts this visit.
    }
    this.applySettings();
    this.loadPack();
  }

  /** `kind` is the unit kind of who caused the event, for a pack that sounds it per kind. */
  play(event: SoundEvent, place: SoundPlace = { pan: 0, gain: 1 }, kind?: UnitKind) {
    // Older packs may advertise these voiced acknowledgements. They have no
    // place in this game's generic feedback, even when a pack is still cached.
    if (event === 'select' || event === 'order') return;
    const fallback = event === "cannonShot" ? "shipShot" : event === "shipShot" ? "impact" : event === "shipHit" ? "impact" : event === "shipSink" ? "buildingDown" : event === "impact" ? "arrowHit" : undefined;
    const sound = this.pack?.sounds[event] ?? (fallback && this.pack?.sounds[fallback]);
    const clip = sound && ((kind && sound.kinds[kind]) || sound.clip);
    if (!sound || !clip || !this.ctx || this.settings.muted) return;
    const url = clip.url;
    const buffer = this.buffers.get(url);
    if (buffer) return this.playClip(event, sound, clip, buffer, place);
    const pack = this.pack, requestedAt = this.ctx.currentTime;
    void this.loadClip(url,EVENT_GROUPS[event]==='ui'?'home':'match').then(buffer => {
      // Do not play a delayed battle or a previous pack's voice after settings change.
      if (buffer && this.pack === pack && this.ctx && this.ctx.currentTime - requestedAt < .35) this.playClip(event, sound, clip, buffer, place);
    });
  }

  private playClip(event: SoundEvent, sound: PackSound, clip: PackClip, buffer: AudioBuffer, place: SoundPlace) {
    const ctx = this.ctx;
    const groupName = EVENT_GROUPS[event];
    const group = this.groups.get(groupName);
    if (!ctx || !sound || !clip || !group || ctx.state !== "running" || this.settings.muted || this.settings[groupName] <= 0 || place.gain <= 0.02) return;
    const playing = this.playing.get(event) ?? 0;
    if (this.voices >= MAX_VOICES || playing >= sound.max) return;
    const out = ctx.createGain();
    // Each copy of a sound already playing is quieter, and every play a little louder or softer (±0.6 dB).
    out.gain.value = ((clip.volume * place.gain) / Math.sqrt(1 + playing)) * (groupName === 'ui' ? 1 : 10 ** ((Math.random() - 0.5) * 0.06));
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, place.pan));
    out.connect(panner).connect(group);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = groupName === 'ui' ? 1 : (event === "impact" ? .78 : 1) * (1 + (Math.random() * 2 - 1) * clip.pitch);
    source.connect(out);
    source.start();
    this.voices += 1;
    this.playing.set(event, playing + 1);
    let ended = false;
    const cleanup = () => {
      if (ended) return; ended = true;
      this.activeEffects.delete(stop);
      this.voices -= 1;
      this.playing.set(event, (this.playing.get(event) ?? 1) - 1);
      out.disconnect();
      panner.disconnect();
    };
    const stop = () => { source.stop(); cleanup(); };
    if (groupName === "effects") this.activeEffects.add(stop);
    source.onended = cleanup;
  }

  private applySettings() {
    if (!this.master) return;
    this.master.gain.value = this.settings.muted ? 0 : 1;
    for (const [group, node] of this.groups) node.gain.value = this.settings[group];
  }

  // Homepage gestures only warm interface clips; combat waits for a match.
  private loadPack() {
    if (!this.ctx) return;
    for(const event of ['click','menu'] as const){const clip=this.pack?.sounds[event]?.clip;if(clip)void this.loadClip(clip.url,'home');}
  }

  async prepareMatch(){if(!this.ctx)return;const clips=Object.entries(this.pack?.sounds??{}).filter(([event])=>EVENT_GROUPS[event as SoundEvent]==='effects').flatMap(([,sound])=>sound.clip?[sound.clip]:[]);await Promise.all(clips.slice(0,8).map(clip=>this.loadClip(clip.url,'match')));}

  private loadClip(url: string,phase:ResourcePhase='match'): Promise<AudioBuffer | undefined> {
    const ctx = this.ctx;
    if (!ctx || this.failed.has(url)) return Promise.resolve(undefined);
    const buffer = this.buffers.get(url);
    if (buffer) return Promise.resolve(buffer);
    const pending = this.loading.get(url);
    if (pending) return pending;
    const request = resources.bytes(url,`audio/${url.split('/').slice(-2).join('/')}`,phase).then(data => ctx.decodeAudioData(data.slice(0))).then(buffer => {
      this.buffers.set(url, buffer); return buffer;
    }).catch(() => { this.failed.add(url); return undefined; }).finally(() => this.loading.delete(url));
    this.loading.set(url, request);
    return request;
  }
}

function compressor(ctx: AudioContext, settings: { threshold: number; knee: number; ratio: number; attack: number; release: number }) {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = settings.threshold;
  node.knee.value = settings.knee;
  node.ratio.value = settings.ratio;
  node.attack.value = settings.attack;
  node.release.value = settings.release;
  return node;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadSettings(): SoundSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<SoundSettings> | null;
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
