// @@@sound - The game's sounds, heard on the client only: the simulation never hears them, so a game plays the same with
// or without them. Every sound is recorded (Freesound, CC0 and CC BY, see public/audio/SOURCES.md) in a few takes, cut
// and levelled against each other beforehand; a sound plays a take other than its last, a little higher or lower each
// time, so the tenth blow is not the first again. Each sound belongs to a group with its own volume (effects, interface,
// music) under one mute, kept in the browser. The battlefield goes through a compressor; a sound heard again in a short
// while is quieter each time, and dropped once heard too often in it; no more than a few dozen play at once: a melee of
// forty is a din, not a roar.

export type SoundGroup = "effects" | "ui" | "music";
export type SoundId =
  | "melee"
  | "buildingBlow"
  | "arrowShot"
  | "cannonShot"
  | "spellBolt"
  | "arrowHit"
  | "death"
  | "buildingDown"
  | "built"
  | "trained"
  | "charge"
  | "chargeImpact"
  | "heal"
  | "summon"
  | "curse"
  | "click"
  | "select"
  | "confirm"
  | "back"
  | "error";
export type SoundSettings = { effects: number; ui: number; music: number; muted: boolean };
// Where a battlefield sound falls: -1 left to 1 right, and how loud for its distance from the middle of the view.
export type SoundPlace = { pan: number; gain: number };

// A sound's takes are public/audio/<id>-1.ogg to <id>-<takes>.ogg; pitch is how far a play may stray up or down (0.05 is
// 5%); limit is how many plays a window of milliseconds lets through.
type Recipe = { group: SoundGroup; takes: number; pitch: number; limit: readonly [count: number, windowMs: number] };

const RECIPES: Record<SoundId, Recipe> = {
  melee: { group: "effects", takes: 6, pitch: 0.08, limit: [5, 220] },
  buildingBlow: { group: "effects", takes: 4, pitch: 0.07, limit: [3, 220] },
  arrowShot: { group: "effects", takes: 3, pitch: 0.06, limit: [4, 220] },
  cannonShot: { group: "effects", takes: 4, pitch: 0.05, limit: [2, 300] },
  spellBolt: { group: "effects", takes: 3, pitch: 0.05, limit: [3, 220] },
  arrowHit: { group: "effects", takes: 5, pitch: 0.08, limit: [4, 220] },
  death: { group: "effects", takes: 6, pitch: 0.05, limit: [3, 300] },
  buildingDown: { group: "effects", takes: 3, pitch: 0.05, limit: [2, 600] },
  built: { group: "effects", takes: 2, pitch: 0.03, limit: [1, 800] },
  trained: { group: "effects", takes: 2, pitch: 0.04, limit: [2, 400] },
  charge: { group: "effects", takes: 3, pitch: 0.03, limit: [2, 500] },
  chargeImpact: { group: "effects", takes: 3, pitch: 0.06, limit: [2, 300] },
  heal: { group: "effects", takes: 2, pitch: 0.03, limit: [2, 400] },
  summon: { group: "effects", takes: 2, pitch: 0.04, limit: [2, 600] },
  curse: { group: "effects", takes: 2, pitch: 0.04, limit: [2, 500] },
  click: { group: "ui", takes: 2, pitch: 0.03, limit: [3, 120] },
  select: { group: "ui", takes: 2, pitch: 0.04, limit: [3, 120] },
  confirm: { group: "ui", takes: 2, pitch: 0.02, limit: [1, 300] },
  back: { group: "ui", takes: 1, pitch: 0.03, limit: [2, 150] },
  error: { group: "ui", takes: 2, pitch: 0.02, limit: [1, 400] },
};

export const SOUND_IDS = Object.keys(RECIPES) as SoundId[];
const takeFiles = (id: SoundId) => Array.from({ length: RECIPES[id].takes }, (_, index) => `${id}-${index + 1}.ogg`);
export const SOUND_FILES = SOUND_IDS.flatMap(takeFiles);

const SETTINGS_KEY = "sketch-rts-sound";
const DEFAULT_SETTINGS: SoundSettings = { effects: 0.7, ui: 0.5, music: 0.5, muted: false };
const MAX_VOICES = 24;

export class Soundboard {
  settings: SoundSettings = loadSettings();
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private groups = new Map<SoundGroup, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private recent = new Map<SoundId, number[]>();
  private lastTake = new Map<SoundId, number>();
  private voices = 0;

  /** `url` turns a file's name under public/audio into the address it is fetched from. */
  constructor(private readonly url: (file: string) => string) {}

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
    for (const group of ["effects", "ui", "music"] as const) {
      const node = ctx.createGain();
      // A battle's many sounds are pressed together, so a crowd of them swells less than it adds up.
      if (group === "effects") node.connect(compressor(ctx, { threshold: -24, knee: 12, ratio: 4, attack: 0.004, release: 0.3 })).connect(this.master);
      else node.connect(this.master);
      this.groups.set(group, node);
    }
    this.applySettings();
    for (const file of SOUND_FILES) void this.load(ctx, file);
  }

  update(change: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...change };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Without storage the choice lasts this visit.
    }
    this.applySettings();
  }

  play(id: SoundId, place: SoundPlace = { pan: 0, gain: 1 }) {
    const ctx = this.ctx;
    const recipe = RECIPES[id];
    const group = this.groups.get(recipe.group);
    if (!ctx || !group || ctx.state !== "running" || this.settings.muted || this.settings[recipe.group] <= 0 || place.gain <= 0.02) return;
    if (this.voices >= MAX_VOICES) return;
    const earlier = this.admit(id, recipe, ctx.currentTime * 1000);
    if (earlier === undefined) return;
    const buffer = this.buffers.get(takeFiles(id)[this.nextTake(id, recipe)]!);
    if (!buffer) return;
    const out = ctx.createGain();
    // Each play after others of the sound in its window is quieter, and every play a little louder or softer (±0.6 dB).
    out.gain.value = (place.gain / Math.sqrt(1 + earlier)) * 10 ** ((Math.random() - 0.5) * 0.06);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, place.pan));
    out.connect(panner).connect(group);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * recipe.pitch;
    source.connect(out);
    source.start();
    this.voices += 1;
    source.onended = () => {
      this.voices -= 1;
      out.disconnect();
      panner.disconnect();
    };
  }

  // How many plays of the sound the window already holds, or undefined when it is full and this one is dropped.
  private admit(id: SoundId, recipe: Recipe, now: number) {
    const [count, windowMs] = recipe.limit;
    const times = (this.recent.get(id) ?? []).filter((time) => now - time < windowMs);
    this.recent.set(id, times);
    if (times.length >= count) return undefined;
    times.push(now);
    return times.length - 1;
  }

  // Any take but the last one played.
  private nextTake(id: SoundId, recipe: Recipe) {
    const last = this.lastTake.get(id);
    let take = Math.floor(Math.random() * recipe.takes);
    if (recipe.takes > 1 && take === last) take = (take + 1 + Math.floor(Math.random() * (recipe.takes - 1))) % recipe.takes;
    this.lastTake.set(id, take);
    return take;
  }

  private applySettings() {
    if (!this.master) return;
    this.master.gain.value = this.settings.muted ? 0 : 1;
    for (const [group, node] of this.groups) node.gain.value = this.settings[group];
  }

  private async load(ctx: AudioContext, file: string) {
    try {
      const response = await fetch(this.url(file));
      this.buffers.set(file, await ctx.decodeAudioData(await response.arrayBuffer()));
    } catch {
      // A sound that did not load is not heard; the game goes on.
    }
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

function loadSettings(): SoundSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<SoundSettings> | null;
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
