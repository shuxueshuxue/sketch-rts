import type { CommandEnvelope } from "../shared/net/types";
import type { Game } from "../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { AiScriptVersion, GameSnapshot, PlayerId, UnitKind } from "../shared/types";
import type { PropPainter, UnitModel } from "../story/cast";
import type { StageView } from "../story/stage";

/** Which units a following camera keeps in frame; every field narrows, and an empty selector means every player unit. */
export type UnitSelector = {
  owners?: PlayerId[];
  kinds?: UnitKind[];
  ids?: string[];
};

/**
 * `fixed` looks at one world point (the centre of the frame). `follow` keeps the centre of the selected units in the
 * middle of the frame, easing toward it with a lag of `lagSeconds`. `zoom` 2 shows the world twice as large.
 */
export type CameraSpec =
  | { type: "fixed"; x: number; y: number; zoom?: number }
  | { type: "follow"; select?: UnitSelector; zoom?: number; lagSeconds?: number };

export type RecordingDefaults = {
  seconds?: number;
  fps?: number;
  width?: number;
  height?: number;
  camera?: CameraSpec;
};

/**
 * A scene to film. `createGame` builds the opening state (usually `sketchScene(...).build().createGame()`); the match
 * then runs on the same command-frame runtime as a local match. Units can be seeded with orders; `commands` adds
 * scripted orders before each tick, and `ai` hands whole players to the preset AI.
 */
export type RecordingScene = {
  name: string;
  description?: string;
  createGame: () => Game;
  commands?: (game: Game) => CommandEnvelope[];
  ai?: { players: PlayerId[]; version?: AiScriptVersion };
  defaults?: RecordingDefaults;
  // A story to film instead of a plain match (see story/director): it runs the game, and its stage and camera are drawn.
  story?: () => StoryDriver;
};

/** A running story as the recorder sees it: one tick at a time, a stage to draw, the models of its own units. */
export type StoryDriver = {
  game: Game;
  advance(): void;
  readonly finished: boolean;
  view(): StageView;
  models(variant: string): UnitModel | undefined;
  props(kind: string): PropPainter | undefined;
  // Where the camera rests when the stage asks for nothing in particular (the party, usually).
  focus(snapshot: GameSnapshot): { x: number; y: number } | undefined;
};

export function defineRecordingScene(scene: RecordingScene): RecordingScene {
  return scene;
}

export type TimedCommands = { at: number; commands: (game: Game) => CommandEnvelope[] };

/** A command script of cues: each cue fires once, on the tick its time (in seconds of match time) falls on. */
export function timedCommands(cues: TimedCommands[]): (game: Game) => CommandEnvelope[] {
  return (game) => cues.filter((cue) => Math.round(cue.at * SIM_TICKS_PER_SECOND) === game.tick).flatMap((cue) => cue.commands(game));
}

/** Ids of one player's living units of the given kinds, for scripted orders. */
export function unitIdsOf(game: Game, owner: PlayerId, kinds?: UnitKind[]) {
  return game.units.filter((unit) => unit.owner === owner && (!kinds || kinds.includes(unit.kind))).map((unit) => unit.id);
}
