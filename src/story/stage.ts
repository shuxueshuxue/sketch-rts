import type { Game } from "../shared/sim";
import type { Unit } from "../shared/types";
import { ensure, suspend, type Operation } from "./kernel";
import { later, seconds, ticks, type Duration, type Instant } from "./time";

// @@@story-stage - Everything the story shows that is not the battle itself: speech bubbles over the units who speak,
// narration, chapter titles, the objectives list, a choice put to the player, markers on the ground, floating words,
// the heroes' panel, letterbox and fades, and where the camera should look. The stage is plain data that the renderer
// draws (see client/story-renderer) the same way in the browser and in a recording; scripts change it through
// operations that wait as long as what they show lasts (`yield* say(...)` returns when the line has been read).
//
// Speech is queued per speaker: a unit says one line at a time and the next waits its turn, so two scenes talking over
// each other never stack one unit's bubbles. A line belongs to the task that said it: halt the scene and its bubble goes.
// A speaker who dies mid-queue says nothing more.

export type Text = string | { zh: string; en?: string };
export type Tone = "say" | "shout" | "whisper" | "think";

export function textIn(text: Text, locale: "zh" | "en"): string {
  if (typeof text === "string") return text;
  return locale === "en" ? (text.en ?? text.zh) : text.zh;
}

export type SpeakerCard = { name: Text; color: string; title?: Text };

export type LineView = { id: number; speakerId: string; name: Text; color: string; text: Text; tone: Tone; start: number; end: number };
export type TimedText = { text: Text; subtitle?: Text; start: number; end: number };
export type ObjectiveView = { id: number; key?: string; text: Text; state: "active" | "done" | "failed"; optional: boolean; progress?: string; since: number };
export type ChoiceView = { id: string; prompt: Text; speakerId?: string; options: { id: string; text: Text }[]; opened: number; picked?: string; pickedAt?: number };
// quest: go here; rally: hold here; target: strike this; danger: a blow is about to fall here; relic: something to take;
// snare: a unit held fast; place: a name on the map, asking nothing.
export type MarkerKind = "quest" | "danger" | "relic" | "rally" | "target" | "snare" | "place";
export type MarkerView = { id: number; kind: MarkerKind; x: number; y: number; unitId?: string; radius: number; label?: Text; start: number; end?: number };
export type FloaterView = { id: number; text: Text; color: string; x: number; y: number; unitId?: string; start: number; end: number; size: number };
// Scenery a story sets on the map (a hut, a boat, a campfire), drawn by the campaign's own painters; `state` lets a
// painter show it otherwise ("burning", "ruined"), and `since` is when that state began.
export type PropView = { id: number; kind: string; x: number; y: number; scale: number; flip: boolean; state?: string; since: number };
export type NoticeView = { id: number; text: Text; tone: "gain" | "quest" | "warn" | "info"; start: number; end: number };
export type CameraView =
  | { mode: "auto"; zoom?: number }
  | { mode: "follow"; unitIds: string[]; zoom?: number }
  | { mode: "point"; x: number; y: number; zoom?: number };
export type PartyMember = {
  unitId: string;
  name: Text;
  color: string;
  level: number;
  xp: number;
  xpFloor: number;
  xpNext?: number;
  hp: number;
  maxHp: number;
  skills: { name: Text; ready: number }[];
  gear: Text[];
};
export type PartyView = { members: PartyMember[]; gold?: number };

export type StageView = {
  tick: number;
  lines: LineView[];
  narration?: TimedText;
  title?: TimedText;
  objectives: ObjectiveView[];
  choice?: ChoiceView;
  letterbox: { on: boolean; since: number };
  fade: { from: number; to: number; start: number; end: number };
  markers: MarkerView[];
  props: PropView[];
  floaters: FloaterView[];
  notices: NoticeView[];
  nameplates: Record<string, { name: Text; color: string; level?: number }>;
  party?: PartyView;
  camera: CameraView;
  shake?: { amount: number; start: number; end: number };
  chapter?: string;
  // The unit whose line the camera should favour (the last to speak while the letterbox is down).
  focusId?: string;
};

// What of the stage outlives a chapter and is kept with a checkpoint: who is who, and how the screen is framed.
export type StageMemory = {
  cards: [string, SpeakerCard][];
  props: PropView[];
  chapter?: string;
  letterbox: { on: boolean; since: number };
  fade: { from: number; to: number; start: number; end: number };
  camera: CameraView;
};

type Pending = { line: Omit<LineView, "start" | "end">; span: Duration; done: () => void };
type Active = { view: LineView; done: () => void };

// How long a line stays up: long enough to read at an unhurried pace.
export function readingTime(text: Text): Duration {
  const words = typeof text === "string" ? text : text.zh;
  const chars = [...words].length;
  return seconds(Math.min(8, Math.max(2.2, 1.5 + chars * 0.17)));
}

const CHOICE_LINGER = seconds(1.2);
const OBJECTIVE_LINGER = seconds(5);
const NOTICE_SPAN = seconds(4);

export class Stage {
  private seq = 1;
  private readonly speaking = new Map<string, Active>();
  private readonly queues = new Map<string, Pending[]>();
  private readonly cards = new Map<string, SpeakerCard>();
  private narration?: TimedText;
  private titleCard?: TimedText;
  private readonly objectives: ObjectiveView[] = [];
  private choice?: ChoiceView & { wake?: (option: string) => void };
  private letterbox = { on: false, since: 0 };
  private fade = { from: 0, to: 0, start: 0, end: 0 };
  private readonly markers = new Map<number, MarkerView>();
  private readonly props = new Map<number, PropView>();
  chapter?: string;
  private readonly holds: { done: () => void; due: Instant }[] = [];
  private floaters: FloaterView[] = [];
  private notices: NoticeView[] = [];
  private camera: CameraView = { mode: "auto" };
  private shake?: { amount: number; start: number; end: number };
  private focusId?: string;
  partyView?: () => PartyView | undefined;
  levels?: (unitId: string) => number | undefined;

  constructor(private readonly game: Game, private readonly clock: () => Instant) {}

  // ---- Who speaks.

  // Gives a unit its name (on its bubbles and its nameplate).
  cast(unit: Unit | string, card: SpeakerCard) {
    this.cards.set(idOf(unit), card);
  }

  card(unit: Unit | string): SpeakerCard | undefined {
    return this.cards.get(idOf(unit));
  }

  // ---- Speech.

  // The unit says the line; returns when it has been read (at once if the unit is gone).
  *say(speaker: Unit | string, text: Text, options: { tone?: Tone; span?: Duration } = {}): Operation<void> {
    const speakerId = idOf(speaker);
    if (!this.alive(speakerId)) return;
    yield* suspend<void>((wake) => {
      const pending: Pending = { line: this.lineFor(speakerId, text, options.tone ?? "say"), span: options.span ?? readingTime(text), done: () => wake.resume(undefined) };
      this.queueOf(speakerId).push(pending);
      this.startNext(speakerId);
      return () => this.withdraw(speakerId, pending);
    });
  }

  // A line said in passing: queued like any other, but nobody waits for it.
  bark(speaker: Unit | string, text: Text, options: { tone?: Tone; span?: Duration } = {}) {
    const speakerId = idOf(speaker);
    if (!this.alive(speakerId)) return;
    this.queueOf(speakerId).push({ line: this.lineFor(speakerId, text, options.tone ?? "say"), span: options.span ?? readingTime(text), done: () => undefined });
    this.startNext(speakerId);
  }

  // Words from no one on the field, across the bottom of the screen.
  *narrate(text: Text, span: Duration = readingTime(text)): Operation<void> {
    const start = this.clock();
    const card: TimedText = { text, start, end: later(start, span) };
    this.narration = card;
    try {
      yield* this.hold(span);
    } finally {
      if (this.narration === card) delete this.narration;
    }
  }

  // A chapter's title across the middle of the screen.
  *title(text: Text, subtitle?: Text, span: Duration = seconds(4.5)): Operation<void> {
    const start = this.clock();
    const card: TimedText = { text, ...(subtitle !== undefined ? { subtitle } : {}), start, end: later(start, span) };
    this.titleCard = card;
    try {
      yield* this.hold(span);
    } finally {
      if (this.titleCard === card) delete this.titleCard;
    }
  }

  // ---- Objectives.

  // `key` names an objective that a later chapter settles (see settle).
  objective(text: Text, options: { optional?: boolean; key?: string } = {}): Objective {
    const view: ObjectiveView = { id: this.seq++, ...(options.key !== undefined ? { key: options.key } : {}), text, state: "active", optional: options.optional ?? false, since: this.clock() };
    this.objectives.push(view);
    this.notice(options.optional ? { zh: `支线：${plain(text)}`, en: `Side quest: ${plainEn(text)}` } : { zh: `新目标：${plain(text)}`, en: `New objective: ${plainEn(text)}` }, "quest");
    const settle = (state: "done" | "failed") => {
      if (view.state !== "active") return;
      view.state = state;
      view.since = this.clock();
      this.notice(state === "done" ? { zh: `完成：${plain(view.text)}`, en: `Done: ${plainEn(view.text)}` } : { zh: `失败：${plain(view.text)}`, en: `Failed: ${plainEn(view.text)}` }, state === "done" ? "gain" : "warn");
    };
    return {
      id: view.id,
      done: () => settle("done"),
      fail: () => settle("failed"),
      progress: (text) => {
        if (text === undefined) delete view.progress;
        else view.progress = text;
      },
      rename: (text) => {
        view.text = text;
      },
      get state() {
        return view.state;
      },
    };
  }

  // Settles an objective set earlier under a key (by a chapter that has no handle to it).
  settle(key: string, state: "done" | "failed") {
    const view = this.objectives.find((objective) => objective.key === key && objective.state === "active");
    if (!view) return;
    view.state = state;
    view.since = this.clock();
    this.notice(state === "done" ? { zh: `完成：${plain(view.text)}`, en: `Done: ${plainEn(view.text)}` } : { zh: `失败：${plain(view.text)}`, en: `Failed: ${plainEn(view.text)}` }, state === "done" ? "gain" : "warn");
  }

  // An objective that lasts as long as the current task: failed if the task ends before it is done.
  *goal(text: Text, options: { optional?: boolean } = {}): Operation<Objective> {
    const handle = this.objective(text, options);
    yield* ensure(() => {
      if (handle.state === "active") handle.fail();
    });
    return handle;
  }

  // ---- Choices.

  // Puts a choice to the player and waits for the answer (the option's id).
  *choose<const O extends string>(prompt: Text, options: readonly { id: O; text: Text }[], extra: { id?: string; speaker?: Unit | string } = {}): Operation<O> {
    if (this.choice) throw new Error("Only one choice can be open at a time");
    const id = extra.id ?? `choice-${this.seq++}`;
    const opened = this.clock();
    const answer = yield* suspend<O>((wake) => {
      this.choice = { id, prompt, options: options.map((option) => ({ id: option.id, text: option.text })), opened, ...(extra.speaker !== undefined ? { speakerId: idOf(extra.speaker) } : {}), wake: (option) => wake.resume(option) };
      return () => {
        if (this.choice?.id === id) delete this.choice;
      };
    });
    return answer;
  }

  // The player's answer to the open choice (an input: see director). The choice stays up a moment with the answer lit.
  answer(choiceId: string, option: string) {
    const choice = this.choice;
    if (!choice || choice.id !== choiceId) throw new Error(`No open choice ${choiceId}`);
    if (!choice.options.some((candidate) => candidate.id === option)) throw new Error(`Choice ${choiceId} has no option ${option}`);
    if (choice.picked) throw new Error(`Choice ${choiceId} was already answered`);
    choice.picked = option;
    choice.pickedAt = this.clock();
  }

  get openChoice(): ChoiceView | undefined {
    return this.choice ? stripWake(this.choice) : undefined;
  }

  // ---- The ground, the air and the corner of the screen.

  mark(kind: MarkerKind, at: { x: number; y: number } | Unit, options: { radius?: number; label?: Text; span?: Duration } = {}): Marker {
    const start = this.clock();
    const view: MarkerView = {
      id: this.seq++,
      kind,
      x: at.x,
      y: at.y,
      ...("order" in at ? { unitId: at.id } : {}),
      radius: options.radius ?? 60,
      ...(options.label !== undefined ? { label: options.label } : {}),
      start,
      ...(options.span !== undefined ? { end: later(start, options.span) } : {}),
    };
    this.markers.set(view.id, view);
    return { id: view.id, remove: () => void this.markers.delete(view.id), move: (to) => Object.assign(view, { x: to.x, y: to.y }) };
  }

  // A marker for as long as the current task runs.
  *marker(kind: MarkerKind, at: { x: number; y: number } | Unit, options: { radius?: number; label?: Text } = {}): Operation<Marker> {
    const handle = this.mark(kind, at, options);
    yield* ensure(handle.remove);
    return handle;
  }

  // Sets a piece of scenery on the map; it stays until removed.
  prop(kind: string, at: { x: number; y: number }, options: { scale?: number; flip?: boolean; state?: string } = {}): Prop {
    const view: PropView = { id: this.seq++, kind, x: at.x, y: at.y, scale: options.scale ?? 1, flip: options.flip ?? false, ...(options.state !== undefined ? { state: options.state } : {}), since: this.clock() };
    this.props.set(view.id, view);
    const props = this.props;
    const clock = this.clock;
    return {
      id: view.id,
      remove: () => void props.delete(view.id),
      move: (to) => {
        view.x = to.x;
        view.y = to.y;
      },
      set state(state: string | undefined) {
        if (state === view.state) return;
        if (state === undefined) delete view.state;
        else view.state = state;
        view.since = clock();
      },
      get state() {
        return view.state;
      },
    };
  }

  // Takes every prop of these kinds off the map (a chapter clearing the previous one's scenery).
  clearProps(kinds?: readonly string[]) {
    for (const [id, prop] of this.props) if (!kinds || kinds.includes(prop.kind)) this.props.delete(id);
  }

  float(text: Text, at: { x: number; y: number } | Unit, options: { color?: string; span?: Duration; size?: number } = {}) {
    const start = this.clock();
    this.floaters.push({ id: this.seq++, text, color: options.color ?? "#6b4a1f", x: at.x, y: at.y, ...("order" in at ? { unitId: at.id } : {}), start, end: later(start, options.span ?? seconds(1.8)), size: options.size ?? 16 });
  }

  notice(text: Text, tone: NoticeView["tone"] = "info") {
    const start = this.clock();
    this.notices.push({ id: this.seq++, text, tone, start, end: later(start, NOTICE_SPAN) });
  }

  // ---- Framing.

  look(camera: CameraView) {
    this.camera = camera;
  }

  // Looks as asked for as long as the current task runs, then as before.
  *framing(camera: CameraView): Operation<void> {
    const before = this.camera;
    this.camera = camera;
    yield* ensure(() => {
      if (this.camera === camera) this.camera = before;
    });
  }

  quake(amount: number, span: Duration) {
    const start = this.clock();
    this.shake = { amount, start, end: later(start, span) };
  }

  setLetterbox(on: boolean) {
    if (this.letterbox.on === on) return;
    this.letterbox = { on, since: this.clock() };
    if (!on) delete this.focusId;
  }

  // Letterbox for as long as the current task runs.
  *cinematic(): Operation<void> {
    this.setLetterbox(true);
    yield* ensure(() => this.setLetterbox(false));
  }

  *fadeTo(alpha: number, span: Duration): Operation<void> {
    const start = this.clock();
    this.fade = { from: this.fadeAlpha(start), to: alpha, start, end: later(start, span) };
    if (span > 0) yield* this.hold(span);
  }

  get cinematicOn() {
    return this.letterbox.on;
  }

  // ---- The Director's side.

  // Nobody is speaking or waiting to, no choice is open and nothing holds the story: a checkpoint can be taken.
  get quiet() {
    return this.speaking.size === 0 && this.queues.size === 0 && !this.choice && this.holds.length === 0;
  }

  memory(): StageMemory {
    return { cards: [...this.cards], props: [...this.props.values()].map((prop) => ({ ...prop })), ...(this.chapter !== undefined ? { chapter: this.chapter } : {}), letterbox: { ...this.letterbox }, fade: { ...this.fade }, camera: this.camera };
  }

  restore(memory: StageMemory) {
    this.cards.clear();
    for (const [unitId, card] of memory.cards) this.cards.set(unitId, card);
    this.props.clear();
    for (const prop of memory.props) this.props.set(prop.id, { ...prop });
    this.seq = Math.max(this.seq, ...memory.props.map((prop) => prop.id + 1));
    if (memory.chapter !== undefined) this.chapter = memory.chapter;
    this.letterbox = { ...memory.letterbox };
    this.fade = { ...memory.fade };
    this.camera = memory.camera;
  }

  // Once a tick: lines end and the next begin, the answered choice closes, the old words fade from the lists.
  tick() {
    const now = this.clock();
    for (const [speakerId, active] of [...this.speaking]) {
      if (active.view.end > now && this.alive(speakerId)) continue;
      this.speaking.delete(speakerId);
      active.done();
      this.startNext(speakerId);
    }
    for (const speakerId of [...this.queues.keys()]) this.startNext(speakerId);
    if (this.choice?.pickedAt !== undefined && now - this.choice.pickedAt >= CHOICE_LINGER) {
      const { wake, picked } = this.choice;
      delete this.choice;
      wake?.(picked!);
    }
    for (let index = this.objectives.length - 1; index >= 0; index -= 1) {
      const objective = this.objectives[index]!;
      if (objective.state !== "active" && now - objective.since >= OBJECTIVE_LINGER) this.objectives.splice(index, 1);
    }
    for (const [id, marker] of this.markers) if (marker.end !== undefined && marker.end <= now) this.markers.delete(id);
    this.floaters = this.floaters.filter((floater) => floater.end > now);
    this.notices = this.notices.filter((notice) => notice.end > now);
    if (this.shake && this.shake.end <= now) delete this.shake;
  }

  view(): StageView {
    const tick = this.clock();
    const nameplates: StageView["nameplates"] = {};
    for (const [unitId, card] of this.cards) {
      const level = this.levels?.(unitId);
      nameplates[unitId] = { name: card.name, color: card.color, ...(level !== undefined ? { level } : {}) };
    }
    const party = this.partyView?.();
    return {
      tick,
      lines: [...this.speaking.values()].map((active) => ({ ...active.view })),
      ...(this.narration ? { narration: { ...this.narration } } : {}),
      ...(this.titleCard ? { title: { ...this.titleCard } } : {}),
      objectives: this.objectives.map((objective) => ({ ...objective })),
      ...(this.choice ? { choice: stripWake(this.choice) } : {}),
      letterbox: { ...this.letterbox },
      fade: { ...this.fade },
      markers: [...this.markers.values()].map((marker) => this.placed(marker)),
      props: [...this.props.values()].map((prop) => ({ ...prop })),
      floaters: this.floaters.map((floater) => this.placed(floater)),
      notices: this.notices.map((notice) => ({ ...notice })),
      nameplates,
      ...(party ? { party } : {}),
      camera: this.camera,
      ...(this.shake ? { shake: { ...this.shake } } : {}),
      ...(this.focusId ? { focusId: this.focusId } : {}),
      ...(this.chapter !== undefined ? { chapter: this.chapter } : {}),
    };
  }

  fadeAlpha(at: number) {
    const { from, to, start, end } = this.fade;
    if (at >= end) return to;
    if (at <= start) return from;
    return from + ((to - from) * (at - start)) / Math.max(1, end - start);
  }

  // A marker or floater that follows a unit stands where the unit stands (or stood last).
  private placed<T extends { x: number; y: number; unitId?: string }>(item: T): T {
    if (!item.unitId) return { ...item };
    const unit = this.game.units.find((candidate) => candidate.id === item.unitId);
    if (unit) {
      item.x = unit.x;
      item.y = unit.y;
    }
    return { ...item };
  }

  private *hold(span: Duration): Operation<void> {
    const due = later(this.clock(), span);
    yield* suspend<void>((wake) => {
      const line = { done: () => wake.resume(undefined), due };
      this.holds.push(line);
      return () => {
        const index = this.holds.indexOf(line);
        if (index >= 0) this.holds.splice(index, 1);
      };
    });
  }

  // Wakes whatever holds for a span (titles, narration, fades) whose span is over. Called by the Director's tick.
  releaseHolds() {
    const now = this.clock();
    for (const hold of this.holds.filter((candidate) => candidate.due <= now)) hold.done();
  }

  private lineFor(speakerId: string, text: Text, tone: Tone): Omit<LineView, "start" | "end"> {
    const card = this.cards.get(speakerId);
    return { id: this.seq++, speakerId, name: card?.name ?? "", color: card?.color ?? "#5c4a32", text, tone };
  }

  private queueOf(speakerId: string) {
    let queue = this.queues.get(speakerId);
    if (!queue) {
      queue = [];
      this.queues.set(speakerId, queue);
    }
    return queue;
  }

  private startNext(speakerId: string) {
    if (this.speaking.has(speakerId)) return;
    const queue = this.queues.get(speakerId);
    if (!queue) return;
    if (!this.alive(speakerId)) {
      this.queues.delete(speakerId);
      for (const pending of queue) pending.done();
      return;
    }
    const next = queue.shift();
    if (queue.length === 0) this.queues.delete(speakerId);
    if (!next) return;
    const start = this.clock();
    this.speaking.set(speakerId, { view: { ...next.line, start, end: later(start, ticks(Math.max(1, next.span))) }, done: next.done });
    if (this.letterbox.on) this.focusId = speakerId;
  }

  // The task that said the line was halted: the line goes, whether it was waiting or showing.
  private withdraw(speakerId: string, pending: Pending) {
    const queue = this.queues.get(speakerId);
    const index = queue?.indexOf(pending) ?? -1;
    if (queue && index >= 0) {
      queue.splice(index, 1);
      return;
    }
    const active = this.speaking.get(speakerId);
    if (active && active.view.id === pending.line.id) {
      this.speaking.delete(speakerId);
      this.startNext(speakerId);
    }
  }

  private alive(unitId: string) {
    return this.game.units.some((unit) => unit.id === unitId && unit.hp > 0);
  }
}

export type Objective = {
  readonly id: number;
  done(): void;
  fail(): void;
  progress(text: string | undefined): void;
  rename(text: Text): void;
  readonly state: "active" | "done" | "failed";
};

export type Marker = { readonly id: number; remove(): void; move(to: { x: number; y: number }): void };

export type Prop = { readonly id: number; remove(): void; move(to: { x: number; y: number }): void; state: string | undefined };

function idOf(unit: Unit | string) {
  return typeof unit === "string" ? unit : unit.id;
}

function plain(text: Text) {
  return typeof text === "string" ? text : text.zh;
}

function plainEn(text: Text) {
  return typeof text === "string" ? text : (text.en ?? text.zh);
}

function stripWake(choice: ChoiceView & { wake?: unknown }): ChoiceView {
  const { wake: _wake, ...view } = choice;
  return { ...view, options: view.options.map((option) => ({ ...option })) };
}
