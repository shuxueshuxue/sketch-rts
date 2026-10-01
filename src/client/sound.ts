// @@@sound - The game's sounds, heard on the client only: the simulation never hears them, so a game plays the same with
// or without them. Recorded sounds (Kenney's CC0 packs, see public/audio/SOURCES.md) are fetched once and decoded; the
// bow, the cannon, the gallop and the spells are made here with WebAudio. Each sound belongs to a group with its own
// volume (effects, interface, music) under one mute, kept in the browser. A sound heard too often in a short while is
// dropped, and no more than a few dozen play at once, so a melee of forty is a din and not a roar.

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
  | "hover"
  | "select"
  | "confirm"
  | "back"
  | "error";
export type SoundSettings = { effects: number; ui: number; music: number; muted: boolean };
// Where a battlefield sound falls: -1 left to 1 right, and how loud for its distance from the middle of the view.
export type SoundPlace = { pan: number; gain: number };

type Synth = (ctx: AudioContext, out: AudioNode, at: number, noise: AudioBuffer) => void;
type Recipe = { group: SoundGroup; files?: readonly string[]; synth?: Synth; gain: number; limit: readonly [count: number, windowMs: number] };

const IMPACT = "kenney-impact-sounds/";
const RPG = "kenney-rpg-audio/";
const INTERFACE = "kenney-interface-sounds/";
const UI = "kenney-ui-audio/";
const range = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(3, "0")}.ogg`);

const RECIPES: Record<SoundId, Recipe> = {
  melee: { group: "effects", files: range(`${IMPACT}impactMetal_medium_`, 5), gain: 0.42, limit: [5, 220] },
  buildingBlow: { group: "effects", files: range(`${IMPACT}impactWood_medium_`, 3), gain: 0.4, limit: [3, 220] },
  arrowShot: { group: "effects", synth: bow, gain: 0.5, limit: [4, 220] },
  cannonShot: { group: "effects", synth: cannon, gain: 0.6, limit: [2, 300] },
  spellBolt: { group: "effects", synth: bolt, gain: 0.35, limit: [3, 220] },
  arrowHit: { group: "effects", files: range(`${IMPACT}impactSoft_heavy_`, 3), gain: 0.32, limit: [4, 220] },
  death: { group: "effects", files: [...range(`${IMPACT}impactPunch_heavy_`, 3), `${RPG}dropLeather.ogg`], gain: 0.5, limit: [3, 300] },
  buildingDown: { group: "effects", files: [`${IMPACT}impactPlank_medium_000.ogg`], gain: 0.7, limit: [2, 600] },
  built: { group: "effects", files: [`${IMPACT}impactBell_heavy_000.ogg`], gain: 0.45, limit: [1, 800] },
  trained: { group: "effects", files: [`${RPG}beltHandle1.ogg`], gain: 0.6, limit: [2, 400] },
  charge: { group: "effects", synth: gallop, gain: 0.7, limit: [2, 500] },
  chargeImpact: { group: "effects", files: range(`${IMPACT}impactPunch_heavy_`, 3), gain: 0.7, limit: [2, 300] },
  heal: { group: "effects", files: [`${INTERFACE}glass_001.ogg`], synth: shimmer, gain: 0.4, limit: [2, 400] },
  summon: { group: "effects", synth: swell, gain: 0.55, limit: [2, 600] },
  curse: { group: "effects", synth: hex, gain: 0.5, limit: [2, 500] },
  click: { group: "ui", files: [`${INTERFACE}click_001.ogg`], gain: 0.55, limit: [3, 120] },
  hover: { group: "ui", files: [`${UI}rollover2.ogg`], gain: 0.25, limit: [2, 90] },
  select: { group: "ui", files: [`${INTERFACE}select_001.ogg`], gain: 0.5, limit: [3, 120] },
  confirm: { group: "ui", files: [`${INTERFACE}confirmation_001.ogg`], gain: 0.5, limit: [1, 300] },
  back: { group: "ui", files: [`${INTERFACE}back_001.ogg`], gain: 0.5, limit: [2, 150] },
  error: { group: "ui", files: [`${INTERFACE}error_004.ogg`], gain: 0.45, limit: [1, 400] },
};

export const SOUND_IDS = Object.keys(RECIPES) as SoundId[];
export const SOUND_FILES = [...new Set(Object.values(RECIPES).flatMap((recipe) => recipe.files ?? []))];

const SETTINGS_KEY = "sketch-rts-sound";
const DEFAULT_SETTINGS: SoundSettings = { effects: 0.7, ui: 0.5, music: 0.5, muted: false };
const MAX_VOICES = 24;

export class Soundboard {
  settings: SoundSettings = loadSettings();
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private groups = new Map<SoundGroup, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private noise: AudioBuffer | undefined;
  private recent = new Map<SoundId, number[]>();
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
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const group of ["effects", "ui", "music"] as const) {
      const node = ctx.createGain();
      node.connect(this.master);
      this.groups.set(group, node);
    }
    this.noise = whiteNoise(ctx);
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
    if (this.voices >= MAX_VOICES || !this.allow(id, recipe, ctx.currentTime * 1000)) return;
    const out = ctx.createGain();
    out.gain.value = recipe.gain * place.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, place.pan));
    out.connect(panner).connect(group);
    const at = ctx.currentTime;
    const file = recipe.files?.[Math.floor(Math.random() * recipe.files.length)];
    const buffer = file ? this.buffers.get(file) : undefined;
    let ends = at + 0.2;
    if (buffer) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // A little play in the pitch, so the tenth blow is not the first one again.
      source.playbackRate.value = 0.94 + Math.random() * 0.12;
      source.connect(out);
      source.start(at);
      ends = Math.max(ends, at + buffer.duration / source.playbackRate.value);
    }
    if (recipe.synth && this.noise) {
      recipe.synth(ctx, out, at, this.noise);
      ends = Math.max(ends, at + 1.2);
    }
    this.voices += 1;
    window.setTimeout(() => {
      this.voices -= 1;
      out.disconnect();
      panner.disconnect();
    }, (ends - at) * 1000 + 50);
  }

  private allow(id: SoundId, recipe: Recipe, now: number) {
    const [count, windowMs] = recipe.limit;
    const times = (this.recent.get(id) ?? []).filter((time) => now - time < windowMs);
    if (times.length >= count) {
      this.recent.set(id, times);
      return false;
    }
    times.push(now);
    this.recent.set(id, times);
    return true;
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

function loadSettings(): SoundSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<SoundSettings> | null;
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function whiteNoise(ctx: AudioContext) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

// ---------------------------------------------------------------- made sounds

function envelope(ctx: AudioContext, out: AudioNode, at: number, peak: number, attack: number, release: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  gain.connect(out);
  return gain;
}

function noiseBurst(ctx: AudioContext, noise: AudioBuffer, into: AudioNode, at: number, length: number) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.connect(into);
  source.start(at, Math.random() * 0.5);
  source.stop(at + length);
}

function tone(ctx: AudioContext, into: AudioNode, at: number, type: OscillatorType, from: number, to: number, length: number) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  osc.connect(into);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

// A bowstring's twang and the arrow's hiss.
function bow(ctx: AudioContext, out: AudioNode, at: number, noise: AudioBuffer) {
  const hiss = ctx.createBiquadFilter();
  hiss.type = "bandpass";
  hiss.Q.value = 1.4;
  hiss.frequency.setValueAtTime(3200, at);
  hiss.frequency.exponentialRampToValueAtTime(700, at + 0.14);
  hiss.connect(envelope(ctx, out, at, 0.5, 0.006, 0.14));
  noiseBurst(ctx, noise, hiss, at, 0.16);
  tone(ctx, envelope(ctx, out, at, 0.3, 0.003, 0.16), at, "triangle", 230, 140, 0.16);
}

// A ship's gun: a low boom under a crack.
function cannon(ctx: AudioContext, out: AudioNode, at: number, noise: AudioBuffer) {
  const body = ctx.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.setValueAtTime(1400, at);
  body.frequency.exponentialRampToValueAtTime(180, at + 0.5);
  body.connect(envelope(ctx, out, at, 0.8, 0.004, 0.6));
  noiseBurst(ctx, noise, body, at, 0.65);
  tone(ctx, envelope(ctx, out, at, 0.6, 0.004, 0.45), at, "sine", 110, 42, 0.45);
}

// A caster's bolt: a rising whistle.
function bolt(ctx: AudioContext, out: AudioNode, at: number, noise: AudioBuffer) {
  tone(ctx, envelope(ctx, out, at, 0.25, 0.01, 0.2), at, "sine", 520, 1100, 0.2);
  const air = ctx.createBiquadFilter();
  air.type = "bandpass";
  air.frequency.value = 2400;
  air.connect(envelope(ctx, out, at, 0.12, 0.01, 0.12));
  noiseBurst(ctx, noise, air, at, 0.14);
}

// Hooves at the gallop and the rush of the charge.
function gallop(ctx: AudioContext, out: AudioNode, at: number, noise: AudioBuffer) {
  for (let beat = 0; beat < 6; beat += 1) {
    const when = at + beat * 0.11 + (beat % 2) * 0.02;
    tone(ctx, envelope(ctx, out, when, 0.55, 0.003, 0.09), when, "sine", 100, 52, 0.09);
    const clod = ctx.createBiquadFilter();
    clod.type = "lowpass";
    clod.frequency.value = 900;
    clod.connect(envelope(ctx, out, when, 0.2, 0.002, 0.04));
    noiseBurst(ctx, noise, clod, when, 0.05);
  }
  const rush = ctx.createBiquadFilter();
  rush.type = "bandpass";
  rush.Q.value = 0.8;
  rush.frequency.setValueAtTime(500, at);
  rush.frequency.exponentialRampToValueAtTime(1600, at + 0.7);
  rush.connect(envelope(ctx, out, at, 0.15, 0.3, 0.45));
  noiseBurst(ctx, noise, rush, at, 0.8);
}

// A heal: bright notes climbing over the chime.
function shimmer(ctx: AudioContext, out: AudioNode, at: number) {
  [659.25, 830.61, 987.77, 1318.5].forEach((frequency, index) => {
    const when = at + index * 0.07;
    tone(ctx, envelope(ctx, out, when, 0.13, 0.02, 0.6), when, "sine", frequency, frequency * 1.002, 0.65);
  });
}

// A summoning: a wind drawn up out of nothing and a voice rising through it.
function swell(ctx: AudioContext, out: AudioNode, at: number, noise: AudioBuffer) {
  const wind = ctx.createBiquadFilter();
  wind.type = "lowpass";
  wind.frequency.setValueAtTime(200, at);
  wind.frequency.exponentialRampToValueAtTime(2600, at + 0.7);
  wind.connect(envelope(ctx, out, at, 0.3, 0.45, 0.35));
  noiseBurst(ctx, noise, wind, at, 0.85);
  tone(ctx, envelope(ctx, out, at, 0.16, 0.4, 0.4), at, "sine", 220, 660, 0.8);
}

// A curse: two low notes rubbing against each other, trembling.
function hex(ctx: AudioContext, out: AudioNode, at: number) {
  const dark = ctx.createBiquadFilter();
  dark.type = "lowpass";
  dark.frequency.value = 520;
  const shake = ctx.createGain();
  shake.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 8;
  const depth = ctx.createGain();
  depth.gain.value = 0.4;
  lfo.connect(depth).connect(shake.gain);
  lfo.start(at);
  lfo.stop(at + 1);
  dark.connect(shake).connect(envelope(ctx, out, at, 0.35, 0.08, 0.85));
  tone(ctx, dark, at, "sawtooth", 98, 92, 0.95);
  tone(ctx, dark, at, "sawtooth", 103.8, 97, 0.95);
}
