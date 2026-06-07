import { createGame, restoreSnapshotIntoGame, type Game } from "./sim";
import { checksumGame } from "./sim/checksum";
import { UPGRADE_KINDS } from "./catalog";
import type { AiScriptVersion, GameSnapshot, PlayerId, PlayerStateMap, RoomState, UpgradeLevels } from "./types";

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
    checksum?: string;
  };
};

export type SaveGameInput = {
  id: string;
  label?: string;
};

export function parseSaveGameInput(value: unknown): SaveGameInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || source.id.length === 0) return undefined;
  if (source.label !== undefined && typeof source.label !== "string") return undefined;
  return {
    id: source.id,
    ...(typeof source.label === "string" ? { label: source.label } : {}),
  };
}

export function assertSaveGameInput(value: unknown, label = "savegame input"): SaveGameInput {
  const input = parseSaveGameInput(value);
  if (!input) throw new Error(`Malformed ${label}`);
  return input;
}

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
      checksum: checksumGame(game),
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
  restoreSnapshotIntoGame(game, { ...save.snapshot, teams: save.runtime.teams, players: normalizeSavedPlayers(save.snapshot.players) }, save.runtime.nextId);
  game.activePlayers = [...save.runtime.activePlayers];
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

function normalizeSavedPlayers(players: PlayerStateMap): PlayerStateMap {
  const cloned = clone(players);
  for (const player of Object.values(cloned)) {
    player.upgrades = normalizeUpgradeLevels(player.upgrades);
  }
  return cloned;
}

function normalizeUpgradeLevels(upgrades: unknown): UpgradeLevels {
  if (!upgrades || typeof upgrades !== "object" || Array.isArray(upgrades)) throw new Error("Save upgrade levels must use the current upgrade map shape");
  return Object.fromEntries(
    UPGRADE_KINDS.map((upgradeKind) => {
      const value = (upgrades as Partial<Record<string, unknown>>)[upgradeKind];
      if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`Save upgrade ${upgradeKind} must be a non-negative integer`);
      return [upgradeKind, Number(value)];
    }),
  ) as UpgradeLevels;
}
