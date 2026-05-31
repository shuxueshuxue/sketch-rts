import { createGrandThirtyRoom, createRoom, finishRoom, joinFirstOpenSlot, leaveUserSlot, roomToGameSetup, updateRoomMap, updateRoomSlot, type CreateRoomInput, type GrandStressRoomOptions, type SlotPatch } from "../shared/rooms";
import { createSaveGameRecord, restoreGameFromSave, type SaveGameInput, type SaveGameRecord } from "../shared/savegame";
import { createAiRuntime, runPresetAiRuntime, type AiRuntimeState } from "../shared/ai-runtime";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type Game } from "../shared/sim";
import { createDebugReplayTrace, extractReplayFrameSave, recordReplayBatch, recordReplayCheckpoint, replaySnapshotToTick, type DebugReplayTrace, type ReplayCommandSource } from "../shared/replay";
import type { GameCommand, GameSetupOptions, GameSnapshot, LocalUserProfile, MapId, PlayerId, RoomState } from "../shared/types";

export type RoomTickResult = {
  ticks: number;
  elapsedMs: number;
  cpuMs: number;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapDeltaBytes: number;
  };
  snapshot: GameSnapshot;
  room: RoomState;
};

export type RoomResetResult = {
  room: RoomState;
  snapshot: GameSnapshot;
};

type HostedRoom = {
  room: RoomState;
  game?: Game;
  aiRuntime?: AiRuntimeState;
  debugReplay?: DebugReplayTrace;
};

const REPLAY_CHECKPOINT_INTERVAL_TICKS = 120;

export function createRoomHost() {
  const rooms = new Map<string, HostedRoom>();
  const saves = new Map<string, SaveGameRecord>();

  function getHosted(roomId: string): HostedRoom {
    const hosted = rooms.get(roomId);
    if (!hosted) throw new Error(`Unknown room ${roomId}`);
    return hosted;
  }

  function getLiveGame(roomId: string): { hosted: HostedRoom; game: Game } {
    const hosted = getHosted(roomId);
    if (hosted.room.status !== "inMatch" || !hosted.game) throw new Error(`Room ${roomId} is not in a live match`);
    return { hosted, game: hosted.game };
  }

  function putRoom(room: RoomState, game?: Game, aiRuntime?: AiRuntimeState): RoomState {
    rooms.set(room.id, game ? (aiRuntime ? { room, game, aiRuntime } : { room, game }) : { room });
    return room;
  }

  return {
    listRooms(): RoomState[] {
      return [...rooms.values()].map((hosted) => hosted.room);
    },

    listSaves(): SaveGameRecord[] {
      return [...saves.values()];
    },

    readSave(saveId: string): SaveGameRecord {
      const save = saves.get(saveId);
      if (!save) throw new Error(`Unknown savegame ${saveId}`);
      return save;
    },

    getRoom(roomId: string): RoomState {
      return getHosted(roomId).room;
    },

    createRoom(input: CreateRoomInput): RoomState {
      if (rooms.has(input.id)) throw new Error(`Room ${input.id} already exists`);
      return putRoom(createRoom(input));
    },

    createGrandThirtyRoom(id: string, host: LocalUserProfile, options: GrandStressRoomOptions = {}): RoomState {
      if (rooms.has(id)) throw new Error(`Room ${id} already exists`);
      return putRoom(createGrandThirtyRoom(id, host, options));
    },

    joinRoom(roomId: string, user: LocalUserProfile): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = joinFirstOpenSlot(hosted.room, user);
      return hosted.room;
    },

    leaveRoom(roomId: string, userId: string): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = leaveUserSlot(hosted.room, userId);
      return hosted.room;
    },

    updateSlot(roomId: string, slotId: string, patch: SlotPatch): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = updateRoomSlot(hosted.room, slotId, patch);
      return hosted.room;
    },

    updateMap(roomId: string, mapId: RoomState["mapId"]): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = updateRoomMap(hosted.room, mapId);
      return hosted.room;
    },

    startRoom(roomId: string): RoomState {
      const hosted = getHosted(roomId);
      const setup = roomToGameSetup(hosted.room);
      hosted.game = createGame(setup.mapId, setup.options);
      hosted.aiRuntime = createAiRuntime(setup.options.aiPlayers ?? [], setup.options.aiVersions ? { versions: setup.options.aiVersions } : {});
      hosted.room = { ...hosted.room, status: "inMatch" };
      return hosted.room;
    },

    resetRoom(roomId: string, mapId: MapId, options: GameSetupOptions = {}): RoomResetResult {
      const hosted = getHosted(roomId);
      const setup = roomToGameSetup({ ...hosted.room, status: "open", mapId });
      const mergedOptions: GameSetupOptions = {
        ...(options.scenario ? { scenario: options.scenario } : {}),
        ...(options.players ?? setup.options.players ? { players: options.players ?? setup.options.players } : {}),
        ...(options.aiPlayers ?? setup.options.aiPlayers ? { aiPlayers: options.aiPlayers ?? setup.options.aiPlayers } : {}),
        ...(options.aiVersions ?? setup.options.aiVersions ? { aiVersions: options.aiVersions ?? setup.options.aiVersions } : {}),
        ...(options.teams ?? setup.options.teams ? { teams: options.teams ?? setup.options.teams } : {}),
        ...(options.races ?? setup.options.races ? { races: options.races ?? setup.options.races } : {}),
      };
      hosted.game = createGame(mapId, mergedOptions);
      hosted.aiRuntime = createAiRuntime(mergedOptions.aiPlayers ?? [], mergedOptions.aiVersions ? { versions: mergedOptions.aiVersions } : {});
      const { result: _result, ...roomWithoutResult } = hosted.room;
      hosted.room = { ...roomWithoutResult, mapId, status: "inMatch" };
      return { room: hosted.room, snapshot: snapshotGame(hosted.game) };
    },

    snapshot(roomId: string): GameSnapshot {
      return snapshotGame(getLiveGame(roomId).game);
    },

    commandRoom(roomId: string, playerId: PlayerId, command: GameCommand): GameSnapshot {
      const { hosted, game } = getLiveGame(roomId);
      recordHostedReplayBatch(hosted, game.tick, "browser", [{ playerId, command }]);
      issuePlayerCommand(game, playerId, command);
      return snapshotGame(game);
    },

    commandRooms(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[]): GameSnapshot {
      const { hosted, game } = getLiveGame(roomId);
      recordHostedReplayBatch(hosted, game.tick, "browser", commands);
      for (const entry of commands) issuePlayerCommand(game, entry.playerId, entry.command);
      return snapshotGame(game);
    },

    commandTickRoom(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[], ticks: number): RoomTickResult {
      const { hosted, game } = getLiveGame(roomId);
      recordHostedReplayBatch(hosted, game.tick, "sdk-agent", commands);
      for (const entry of commands) issuePlayerCommand(game, entry.playerId, entry.command);
      return tickHostedRoom(hosted, game, ticks);
    },

    tickRoom(roomId: string, ticks: number): RoomTickResult {
      const { hosted, game } = getLiveGame(roomId);
      return tickHostedRoom(hosted, game, ticks);
    },

    saveRoom(roomId: string, input: SaveGameInput): SaveGameRecord {
      const { hosted, game } = getLiveGame(roomId);
      const save = createSaveGameRecord(game, hosted.room, input, new Date(), hosted.aiRuntime?.controlledPlayers ?? [], hosted.aiRuntime?.versions ?? {});
      saves.set(save.id, save);
      return save;
    },

    enableDebugReplay(roomId: string, input: SaveGameInput): DebugReplayTrace {
      const { hosted, game } = getLiveGame(roomId);
      const initialSave = createSaveGameRecord(game, hosted.room, input, new Date(), hosted.aiRuntime?.controlledPlayers ?? [], hosted.aiRuntime?.versions ?? {});
      hosted.debugReplay = createDebugReplayTrace({ id: input.id, ...(input.label ? { label: input.label } : {}), initialSave });
      return hosted.debugReplay;
    },

    readDebugReplay(roomId: string): DebugReplayTrace {
      const trace = getHosted(roomId).debugReplay;
      if (!trace) throw new Error(`Room ${roomId} is not recording a debug replay`);
      return trace;
    },

    replayDebugToTick(roomId: string, tick: number): GameSnapshot {
      const trace = this.readDebugReplay(roomId);
      return replaySnapshotToTick(trace, tick);
    },

    extractDebugReplayFrameSave(roomId: string, tick: number, input: SaveGameInput): SaveGameRecord {
      const trace = this.readDebugReplay(roomId);
      const save = extractReplayFrameSave(trace, tick, input);
      saves.set(save.id, save);
      return save;
    },

    continueSave(saveId: string, saveInput?: SaveGameRecord, options: { roomId?: string } = {}): RoomState {
      const save = saveInput ?? this.readSave(saveId);
      saves.set(save.id, save);
      const room = { ...save.room, id: options.roomId ?? save.room.id, status: "inMatch" as const };
      if (rooms.has(room.id)) throw new Error(`Room ${room.id} already exists`);
      rooms.set(room.id, { room, game: restoreGameFromSave(save), aiRuntime: createAiRuntime(save.runtime.aiPlayers, save.runtime.aiVersions ? { versions: save.runtime.aiVersions } : {}) });
      return room;
    },

    tickActiveRooms(ticks = 1): RoomState[] {
      const changed: RoomState[] = [];
      for (const hosted of rooms.values()) {
        if (hosted.room.status !== "inMatch" || !hosted.game) continue;
        for (let i = 0; i < ticks; i += 1) {
          runHostedAiFrame(hosted, hosted.game);
          stepGame(hosted.game);
          recordHostedReplayCheckpoint(hosted, hosted.game);
          if (hosted.game.match.winner) break;
        }
        if (hosted.game.match.winner) {
          hosted.room = finishRoom(hosted.room, snapshotGame(hosted.game));
          delete hosted.game;
          delete hosted.aiRuntime;
        }
        changed.push(hosted.room);
      }
      return changed;
    },
  };
}

function tickHostedRoom(hosted: HostedRoom, game: Game, ticks: number): RoomTickResult {
  const memoryStarted = process.memoryUsage();
  const cpuStarted = process.cpuUsage();
  const started = performance.now();
  for (let i = 0; i < ticks; i += 1) {
    runHostedAiFrame(hosted, game);
    stepGame(game);
    recordHostedReplayCheckpoint(hosted, game);
    if (game.match.winner) break;
  }
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStarted);
  const memory = process.memoryUsage();
  if (game.match.winner) {
    hosted.room = finishRoom(hosted.room, snapshotGame(game));
    delete hosted.game;
    delete hosted.aiRuntime;
  }
  return {
    ticks,
    elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapDeltaBytes: memory.heapUsed - memoryStarted.heapUsed,
    },
    snapshot: snapshotGame(game),
    room: hosted.room,
  };
}

function runHostedAiFrame(hosted: HostedRoom, game: Game) {
  if (!hosted.aiRuntime) return;
  // @@@hosted-ai-replay - Autoplay and SDK fast-forward must record the same AI command stream.
  const result = runPresetAiRuntime(game, hosted.aiRuntime);
  recordHostedReplayBatch(hosted, game.tick, "internal-ai", result.commands);
}

function recordHostedReplayBatch(hosted: HostedRoom, tick: number, source: ReplayCommandSource, commands: { playerId: PlayerId; command: GameCommand }[]) {
  if (!hosted.debugReplay) return;
  recordReplayBatch(hosted.debugReplay, { tick, source, commands });
}

function recordHostedReplayCheckpoint(hosted: HostedRoom, game: Game) {
  if (!hosted.debugReplay) return;
  if (!game.match.winner && game.tick % REPLAY_CHECKPOINT_INTERVAL_TICKS !== 0) return;
  recordReplayCheckpoint(hosted.debugReplay, game);
}
