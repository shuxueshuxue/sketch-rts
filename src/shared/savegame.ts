import { createGame, type Game } from "./sim";
import type { AiScriptVersion, GameSnapshot, PlayerId, RoomState } from "./types";

export const SAVEGAME_SCHEMA_VERSION = 1;

export type SaveGameRecord = {
  schemaVersion: typeof SAVEGAME_SCHEMA_VERSION;
  id: string;
  label?: string;
  createdAt: string;
  room: RoomState;
  snapshot: GameSnapshot;
  runtime: {
    nextId: number;
    activePlayers: PlayerId[];
    teams: Record<PlayerId, string>;
    aiPlayers: PlayerId[];
    aiVersions?: Partial<Record<PlayerId, AiScriptVersion>>;
  };
};

export type SaveGameInput = {
  id: string;
  label?: string;
};

export function createSaveGameRecord(game: Game, room: RoomState, input: SaveGameInput, now = new Date(), aiPlayers: PlayerId[] = [], aiVersions: Partial<Record<PlayerId, AiScriptVersion>> = {}): SaveGameRecord {
  if (room.status !== "inMatch") throw new Error("Only live room matches can be saved");
  return {
    schemaVersion: SAVEGAME_SCHEMA_VERSION,
    id: input.id,
    ...(input.label ? { label: input.label } : {}),
    createdAt: now.toISOString(),
    room: clone(room),
    snapshot: clone(game),
    runtime: {
      nextId: game.nextId,
      activePlayers: [...game.activePlayers],
      teams: { ...game.teams },
      aiPlayers: [...aiPlayers],
      aiVersions: { ...aiVersions },
    },
  };
}

export function restoreGameFromSave(save: SaveGameRecord): Game {
  assertSaveGame(save);
  const races = Object.fromEntries(save.runtime.activePlayers.map((owner) => [owner, save.snapshot.players[owner]?.race ?? "grove"]));
  const options = {
    players: save.runtime.activePlayers,
    aiPlayers: save.runtime.aiPlayers,
    teams: save.runtime.teams,
    races,
    ...(save.runtime.aiVersions ? { aiVersions: save.runtime.aiVersions } : {}),
  };
  const game = createGame(save.snapshot.map.id, options);
  game.tick = save.snapshot.tick;
  game.match = clone(save.snapshot.match);
  game.map = clone(save.snapshot.map);
  game.players = clone(save.snapshot.players);
  game.units = clone(save.snapshot.units);
  game.buildings = clone(save.snapshot.buildings);
  game.resources = clone(save.snapshot.resources);
  game.mercenaryCamps = clone(save.snapshot.mercenaryCamps);
  game.effects = clone(save.snapshot.effects);
  game.nextId = save.runtime.nextId;
  game.activePlayers = [...save.runtime.activePlayers];
  game.teams = { ...save.runtime.teams };
  return game;
}

export function assertSaveGame(save: SaveGameRecord) {
  if (save.schemaVersion !== SAVEGAME_SCHEMA_VERSION) throw new Error(`Unsupported savegame schema ${save.schemaVersion}`);
  if (save.room.status !== "inMatch") throw new Error("Savegame does not contain a live match");
  if (save.snapshot.map.id !== save.room.mapId) throw new Error("Savegame room/map mismatch");
  for (const owner of save.runtime.activePlayers) {
    if (!save.snapshot.players[owner]) throw new Error(`Savegame missing player state for ${owner}`);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
