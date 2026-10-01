// @@@sound - The game's sounds, heard on the client only: the simulation never hears them, so a game plays the same with
// or without them. What a game sounds like is a sound pack's (see @@@sound-packs): for each event below, the one
// recording it plays, how loud, how far its pitch may stray, and how many of it may sound at once. With no pack chosen,
// or a pack without an event, it is silent. Each play strays a little in pitch and level, so the tenth blow is not the
// first again. Events belong to a group with its own volume (effects, interface) under one mute; the choices are kept in
// the browser. The battlefield goes through a compressor, a sound already playing is quieter for each copy of it, and
// no more than a dozen play at once.

export type SoundGroup = "effects" | "ui";
export type SoundEvent = "melee" | "arrowShot" | "arrowHit" | "death" | "built" | "buildingDown" | "click";
export const SOUND_EVENTS: readonly SoundEvent[] = ["melee", "arrowShot", "arrowHit", "death", "built", "buildingDown", "click"];
const EVENT_GROUPS: Record<SoundEvent, SoundGroup> = {
  melee: "effects",
  arrowShot: "effects",
  arrowHit: "effects",
  death: "effects",
  built: "effects",
  buildingDown: "effects",
  click: "ui",
};

// An event's sound in a pack: its file in the pack's folder, its volume (1 as recorded), how far a play may stray in
// pitch (0.05 is 5% up or down), and how many plays of it may sound at once.
export type PackSound = { file: string; volume: number; pitch: number; max: number };
export type SoundPack = { id: string; name: string; sounds: Partial<Record<SoundEvent, PackSound & { url: string }>> };
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
  const sounds: SoundPack["sounds"] = {};
  for (const [event, entry] of Object.entries(manifest.sounds)) {
    if (!SOUND_EVENTS.includes(event as SoundEvent)) throw fail(`no event ${event} (events: ${SOUND_EVENTS.join(", ")})`);
    if (!isRecord(entry) || typeof entry.file !== "string") throw fail(`${event} needs a file`);
    const url = urls[entry.file];
    if (!url) throw fail(`${event} plays ${entry.file}, which is not in the pack`);
    const volume = entry.volume ?? 1;
    const pitch = entry.pitch ?? 0;
    const max = entry.max ?? 4;
    if (typeof volume !== "number" || !(volume > 0 && volume <= 4)) throw fail(`${event} volume must be above 0 and at most 4`);
    if (typeof pitch !== "number" || !(pitch >= 0 && pitch <= 0.5)) throw fail(`${event} pitch must be from 0 to 0.5`);
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1) throw fail(`${event} max must be a whole number of at least 1`);
    sounds[event as SoundEvent] = { file: entry.file, volume, pitch, max, url };
  }
  return { id, name: manifest.name, sounds };
}

export class Soundboard {
  settings: SoundSettings = loadSettings();
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private groups = new Map<SoundGroup, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private playing = new Map<SoundEvent, number>();
  private voices = 0;

  /** `packs` are the packs to choose from; `fallback` is the one played until the player chooses (none: silence). */
  constructor(
    readonly packs: readonly SoundPack[],
    private readonly fallback?: string,
  ) {}

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

  play(event: SoundEvent, place: SoundPlace = { pan: 0, gain: 1 }) {
    const ctx = this.ctx;
    const sound = this.pack?.sounds[event];
    const groupName = EVENT_GROUPS[event];
    const group = this.groups.get(groupName);
    if (!ctx || !sound || !group || ctx.state !== "running" || this.settings.muted || this.settings[groupName] <= 0 || place.gain <= 0.02) return;
    const playing = this.playing.get(event) ?? 0;
    if (this.voices >= MAX_VOICES || playing >= sound.max) return;
    const buffer = this.buffers.get(sound.url);
    if (!buffer) return;
    const out = ctx.createGain();
    // Each copy of a sound already playing is quieter, and every play a little louder or softer (±0.6 dB).
    out.gain.value = ((sound.volume * place.gain) / Math.sqrt(1 + playing)) * 10 ** ((Math.random() - 0.5) * 0.06);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, place.pan));
    out.connect(panner).connect(group);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * sound.pitch;
    source.connect(out);
    source.start();
    this.voices += 1;
    this.playing.set(event, playing + 1);
    source.onended = () => {
      this.voices -= 1;
      this.playing.set(event, (this.playing.get(event) ?? 1) - 1);
      out.disconnect();
      panner.disconnect();
    };
  }

  private applySettings() {
    if (!this.master) return;
    this.master.gain.value = this.settings.muted ? 0 : 1;
    for (const [group, node] of this.groups) node.gain.value = this.settings[group];
  }

  // The chosen pack's recordings, each fetched and decoded once.
  private loadPack() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const sound of Object.values(this.pack?.sounds ?? {})) {
      if (this.buffers.has(sound.url)) continue;
      void fetch(sound.url)
        .then((response) => response.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.buffers.set(sound.url, buffer))
        .catch(() => {
          // A sound that did not load is not heard; the game goes on.
        });
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

function isRecord(value: unknown): value is Record<string, unknown> {
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
