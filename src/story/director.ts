import type { CommandEnvelope } from "../shared/net/types";
import { createGame, restoreSnapshotIntoGame, snapshotGame, type Game } from "../shared/sim";
import { checksumGame } from "../shared/sim/checksum";
import { CommandFrameRuntime } from "../shared/sim/command-frame-runtime";
import type { GameCommand, GameSnapshot, PlayerId } from "../shared/types";
import type { StoryEvent } from "./events";
import { Kernel, suspend, type Operation, type Task } from "./kernel";
import { Clock, type StoryClock } from "./ops";
import { Stage, type StageMemory } from "./stage";
import { instant, type Instant } from "./time";
import { WorldWatch } from "./watch";

// @@@story-director - Runs a story alongside a game, one tick at a time:
//
//   1. the player's commands for this tick are applied and the sim steps (the same command-frame runtime as a match);
//   2. the story phase: the player's other inputs (choices) are taken, the stage moves on, timers that are due fire,
//      then every event the tick produced is offered to the waiting scripts one at a time (each event is a turn: the
//      scripts it wakes run until they wait again before the next event is offered, so a loop that waits on `on(...)`
//      sees every event, in order), then the conditions are asked.
//
// Two kernels run on this one clock: the story's, which may do anything to the world, and the player's (a human's inputs,
// or the self-playing pilot that plays a recording), which can only issue commands and answer choices, as a human could.
//
// Saves: a coroutine's continuation is not data, so a save does not try to write one down. Everything a script does
// follows from the game state it started from and the inputs it was given (it may not read a clock, a random source or
// anything outside the world), so the script's state is rebuilt by running it again: a save is the checkpoint the
// story last took (a chapter's start: game state, story variables, random state) plus every input since, and loading
// replays them. This is how durable workflow engines (Temporal, Azure Durable Functions) resume generator code; here it
// is also the proof of determinism, since the replayed game must hash to the saved one.

export type StoryInput = { type: "answer"; choice: string; option: string };

export type LoggedInput = { tick: number; commands?: CommandEnvelope[]; inputs?: StoryInput[] };

// The game as a checkpoint keeps it: its snapshot (the variants included) and what the runtime adds.
export type GameState = {
  snapshot: GameSnapshot;
  nextId: number;
  activePlayers: PlayerId[];
  teams: Record<PlayerId, string>;
};

export type Checkpoint<Vars> = { label: string; tick: number; game: GameState; vars: Vars; random: number; stage: StageMemory };

export type StorySave<Vars> = { story: string; checkpoint: Checkpoint<Vars>; inputs: LoggedInput[]; tick: number; checksum: string };

// What the player's side may do: what a human at the keyboard could.
export type PlayerControls = {
  readonly owner: PlayerId;
  readonly game: Readonly<Game>;
  readonly stage: Stage;
  command(command: GameCommand): void;
  answer(choice: string, option: string): void;
};

export type DirectorOptions<Vars> = {
  id: string;
  game: Game;
  player: PlayerId;
  vars: Vars;
  // The story's root script. `resumeAt` is the checkpoint label it resumes from when a save is loaded.
  story: (director: Director<Vars>, resumeAt: string | undefined) => Operation<void>;
  // The player's side when it is scripted (a recording's pilot).
  pilot?: (controls: PlayerControls, resumeAt: string | undefined) => Operation<void>;
  seed?: number;
};

type Timer = { due: number; seq: number; fire: () => void };

export class Director<Vars = unknown> {
  readonly stage: Stage;
  readonly game: Game;
  readonly vars: Vars;
  private readonly kernel = new Kernel();
  private readonly pilotKernel = new Kernel();
  private readonly runtime: CommandFrameRuntime;
  private readonly watch: WorldWatch;
  private readonly timers: Timer[] = [];
  private readonly conditions = new Map<number, { test: () => boolean; fire: () => void }>();
  private readonly listeners = new Map<number, { accept: (event: StoryEvent) => boolean; fire: (event: StoryEvent) => void }>();
  private readonly announced: StoryEvent[] = [];
  private seq = 0;
  private queuedCommands: CommandEnvelope[] = [];
  private queuedInputs: StoryInput[] = [];
  private log: LoggedInput[] = [];
  private checkpointTaken: Checkpoint<Vars>;
  private randomState: number;
  private root?: Task<void>;
  private pilotTask?: Task<void>;
  private replaying?: LoggedInput[];
  private pendingCheckpoint?: { label: string; resume: () => void };

  constructor(private readonly options: DirectorOptions<Vars>, resume?: Checkpoint<Vars>) {
    this.game = options.game;
    this.game.scriptedVictory = true;
    this.game.variants ??= {};
    this.vars = options.vars;
    this.randomState = resume?.random ?? (options.seed ?? 1) >>> 0;
    this.watch = new WorldWatch(this.game);
    this.game.observer = this.watch;
    this.runtime = new CommandFrameRuntime({ game: this.game, roomId: `story-${options.id}`, rejectionLabel: `Story ${options.id}: player command rejected` });
    this.stage = new Stage(this.game, () => this.now());
    if (resume) this.stage.restore(resume.stage);
    this.checkpointTaken = resume ?? this.capture("start");
  }

  // Starts the story (and the pilot) from the beginning, or from the checkpoint the director was built on.
  begin(resumeAt?: string) {
    const clock = this.clock();
    this.root = this.kernel.start(() => withClock(clock, this.options.story(this, resumeAt)), "story");
    if (this.options.pilot && !this.replaying) this.startPilot(resumeAt);
    this.settle();
    this.failLoudly();
  }

  get tick() {
    return this.game.tick;
  }

  get finished() {
    return this.root?.state === "done";
  }

  now(): Instant {
    return instant(this.game.tick);
  }

  // One tick of game and story.
  advance() {
    this.takeCheckpoint();
    const replay = this.replaying?.[0]?.tick === this.game.tick ? this.replaying.shift() : undefined;
    const commands = this.replaying ? (replay?.commands ?? []) : this.queuedCommands.splice(0);
    const inputs = this.replaying ? (replay?.inputs ?? []) : this.queuedInputs.splice(0);
    if (commands.length > 0 || inputs.length > 0) this.log.push({ tick: this.game.tick, ...(commands.length > 0 ? { commands } : {}), ...(inputs.length > 0 ? { inputs } : {}) });
    this.runtime.tick(commands);
    for (const input of inputs) this.take(input);
    this.stage.tick();
    this.stage.releaseHolds();
    this.fireTimers();
    this.settle();
    this.dispatch(this.watch.collect(this.game));
    this.askConditions();
    this.failLoudly();
  }

  // Deterministic randomness for scripts: part of the story's state, saved with each checkpoint.
  random(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let t = this.randomState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // A chapter's start: what a save made from here on restores before replaying the inputs since. The story waits here
  // until the next tick begins, when nothing is half done: the state is taken before anything else happens in that tick,
  // and a loaded save starts the story at `label` at exactly that point.
  *checkpoint(label: string): Operation<void> {
    yield* suspend<void>((wake) => {
      this.pendingCheckpoint = { label, resume: () => wake.resume(undefined) };
      return () => {
        if (this.pendingCheckpoint?.label === label) delete this.pendingCheckpoint;
      };
    });
  }

  private takeCheckpoint() {
    const pending = this.pendingCheckpoint;
    if (!pending) return;
    // A blow struck between ticks is still on its way to the scripts; a checkpoint waits until the world is quiet.
    if (!this.watch.quiet || !this.stage.quiet) return;
    delete this.pendingCheckpoint;
    this.checkpointTaken = this.capture(pending.label);
    this.log = [];
    pending.resume();
    this.settle();
    this.failLoudly();
  }

  save(): StorySave<Vars> {
    return clone({ story: this.options.id, checkpoint: this.checkpointTaken, inputs: this.log, tick: this.game.tick, checksum: checksumGame(this.game) });
  }

  // Rebuilds a story from a save: the checkpoint's game, the story resumed at the checkpoint's label, and the inputs
  // replayed up to the saved tick. The replayed game must hash to the saved one, or the save belongs to another version
  // of the story (or the story is not deterministic) and loading fails.
  static load<Vars>(options: Omit<DirectorOptions<Vars>, "game" | "vars">, save: StorySave<Vars>): Director<Vars> {
    if (save.story !== options.id) throw new Error(`Save belongs to story ${save.story}, not ${options.id}`);
    const game = reviveGame(save.checkpoint.game);
    const director = new Director<Vars>({ ...options, game, vars: clone(save.checkpoint.vars) }, clone(save.checkpoint));
    director.replaying = clone(save.inputs);
    director.begin(save.checkpoint.label);
    while (director.game.tick < save.tick) director.advance();
    delete director.replaying;
    const checksum = checksumGame(director.game);
    if (checksum !== save.checksum) throw new Error(`Save of ${save.story} does not replay: tick ${save.tick} hashes ${checksum}, the save says ${save.checksum}`);
    if (options.pilot) director.startPilot(save.checkpoint.label);
    director.settle();
    return director;
  }

  // ---- The player's side.

  command(command: GameCommand) {
    this.queuedCommands.push({ playerId: this.options.player, command });
  }

  answer(choice: string, option: string) {
    this.queuedInputs.push({ type: "answer", choice, option });
  }

  controls(): PlayerControls {
    return { owner: this.options.player, game: this.game, stage: this.stage, command: (command) => this.command(command), answer: (choice, option) => this.answer(choice, option) };
  }

  // ---- Services for the scripts (see ops).

  private clock(): StoryClock {
    return {
      now: () => this.now(),
      timer: (due, fire) => this.addTimer(due, fire),
      condition: (test, fire) => this.register(this.conditions, { test, fire }),
      listen: (accept, fire) => this.register(this.listeners, { accept, fire }),
      announce: (event) => void this.announced.push(event),
    };
  }

  private startPilot(resumeAt: string | undefined) {
    const pilot = this.options.pilot;
    if (!pilot) return;
    const clock = this.clock();
    const controls = this.controls();
    this.pilotTask = this.pilotKernel.start(() => withClock(clock, pilot(controls, resumeAt)), "pilot");
  }

  private take(input: StoryInput) {
    const choice = this.stage.openChoice;
    this.stage.answer(input.choice, input.option);
    this.announced.push({ type: "chose", at: this.now(), prompt: typeof choice?.prompt === "string" ? choice.prompt : (choice?.prompt.zh ?? input.choice), option: input.option });
  }

  private addTimer(due: number, fire: () => void) {
    const timer: Timer = { due, seq: this.seq++, fire };
    let index = this.timers.length;
    while (index > 0 && this.timers[index - 1]!.due > due) index -= 1;
    this.timers.splice(index, 0, timer);
    return () => {
      const at = this.timers.indexOf(timer);
      if (at >= 0) this.timers.splice(at, 1);
    };
  }

  private register<E>(registry: Map<number, E>, entry: E) {
    const id = this.seq++;
    registry.set(id, entry);
    return () => void registry.delete(id);
  }

  private fireTimers() {
    const now = this.game.tick;
    while (this.timers.length > 0 && this.timers[0]!.due <= now) this.timers.shift()!.fire();
  }

  private dispatch(events: StoryEvent[]) {
    const queue = [...this.announced.splice(0), ...events];
    for (let event = queue.shift(); event; event = queue.shift()) {
      for (const [id, listener] of [...this.listeners]) {
        if (!this.listeners.has(id) || !listener.accept(event)) continue;
        listener.fire(event);
      }
      this.settle();
      queue.push(...this.announced.splice(0));
    }
  }

  private askConditions() {
    for (const [id, condition] of [...this.conditions]) {
      if (this.conditions.has(id) && condition.test()) condition.fire();
    }
    this.settle();
    this.dispatch([]);
  }

  // Runs both kernels until neither has anything left to run.
  private settle() {
    while (!this.kernel.idle || !this.pilotKernel.idle) {
      this.kernel.drain();
      this.pilotKernel.drain();
    }
  }

  private failLoudly() {
    for (const task of [this.root, this.pilotTask]) {
      if (task?.state === "failed" && task.outcome && !task.outcome.ok) throw task.outcome.error;
    }
  }

  private capture(label: string): Checkpoint<Vars> {
    return clone({ label, tick: this.game.tick, game: captureGame(this.game), vars: this.vars, random: this.randomState, stage: this.stage.memory() });
  }
}

function* withClock(clock: StoryClock, body: Operation<void>): Operation<void> {
  yield* Clock.provide(clock);
  yield* body;
}

export function captureGame(game: Game): GameState {
  return clone({ snapshot: snapshotGame(game), nextId: game.nextId, activePlayers: game.activePlayers, teams: game.teams });
}

export function reviveGame(state: GameState): Game {
  const races = Object.fromEntries(state.activePlayers.map((owner) => [owner, state.snapshot.players[owner]?.race ?? "grove"]));
  const game = createGame(state.snapshot.map.id, { players: state.activePlayers, aiPlayers: [], teams: state.teams, races, scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true } });
  restoreSnapshotIntoGame(game, state.snapshot, state.nextId);
  game.activePlayers = [...state.activePlayers];
  return game;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
