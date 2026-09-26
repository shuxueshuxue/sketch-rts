import type { CommandEnvelope } from "../shared/net/types";
import type { Game } from "../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { AiScriptVersion, PlayerId, UnitKind } from "../shared/types";

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
