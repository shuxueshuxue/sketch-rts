import { createGrandThirtyRoom, createRoom, finishRoom, joinFirstOpenSlot, leaveUserSlot, lobbyVisibleRooms, resizeRoomSlots, roomToGameSetup, updateRoomMap, updateRoomSlot, type CreateRoomInput, type GrandStressRoomOptions, type SlotPatch } from "../shared/rooms";
import { createSaveGameRecord, restoreGameFromSave, type SaveGameInput, type SaveGameRecord } from "../shared/savegame";
import { createAiRuntime, planPresetAiRuntimeCommands, type AiRuntimeState } from "../ai/runtime";
import type { AiScript, AiScriptVersion } from "../ai/policy";
import { createGame, snapshotGame, stepGame, type Game } from "../shared/sim";
import { commandValidationError } from "../shared/sim/command-validation";
import { applyCommandFrame, commandWithCurrentIssuers } from "../shared/sim/frame";
import { createDebugReplayTrace, extractReplayFrameSave, recordReplayFrame, recordReplayCheckpoint, replaySnapshotToTick, type DebugReplayTrace, type ReplayCommandSource } from "../shared/replay";
import type { CheckpointFrame, CommandEnvelope, CommandFrame } from "../shared/net/types";
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

export type RoomFrameTickResult = RoomTickResult & {
  frame: CommandFrame;
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
  nextFrameSequence: number;
};

export type RoomHostOptions = {
  autoTick?: boolean;
  aiScripts?: AiScript[];
};

const REPLAY_CHECKPOINT_INTERVAL_TICKS = 120;

export function createRoomHost(options: RoomHostOptions = {}) {
  const defaultAutoTick = options.autoTick ?? true;
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
    const storedRoom = { ...room, autoTick: defaultAutoTick };
    rooms.set(storedRoom.id, game ? (aiRuntime ? { room: storedRoom, game, aiRuntime, nextFrameSequence: 0 } : { room: storedRoom, game, nextFrameSequence: 0 }) : { room: storedRoom, nextFrameSequence: 0 });
    return storedRoom;
  }

  return {
    listRooms(viewerUserId?: string): RoomState[] {
      return lobbyVisibleRooms(
        [...rooms.values()].map((hosted) => hosted.room),
        viewerUserId,
      );
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

    hasRoom(roomId: string): boolean {
      return rooms.has(roomId);
    },

    pauseRoom(roomId: string): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = { ...hosted.room, autoTick: false };
      return hosted.room;
    },

    resumeRoom(roomId: string): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = { ...hosted.room, autoTick: true };
      return hosted.room;
    },

    closeRoom(roomId: string, userId: string): RoomState {
      const hosted = getHosted(roomId);
      if (hosted.room.hostUserId !== userId) throw new Error("Only the room host can close this room");
      const closed: RoomState = { ...hosted.room, status: "closed" };
      rooms.delete(roomId);
      return closed;
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

    resizeSlots(roomId: string, humanCount: number, aiCount: number): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = resizeRoomSlots(hosted.room, humanCount, aiCount);
      return hosted.room;
    },

    startRoom(roomId: string): RoomState {
      const hosted = getHosted(roomId);
      const setup = roomToGameSetup(hosted.room);
      hosted.game = createGame(setup.mapId, setup.options);
      hosted.aiRuntime = createHostedAiRuntime(setup.options.aiPlayers ?? [], setup.options.aiVersions);
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
      hosted.aiRuntime = createHostedAiRuntime(mergedOptions.aiPlayers ?? [], mergedOptions.aiVersions);
      const { result: _result, ...roomWithoutResult } = hosted.room;
      hosted.room = { ...roomWithoutResult, mapId, status: "inMatch" };
      return { room: hosted.room, snapshot: snapshotGame(hosted.game) };
    },

    snapshot(roomId: string): GameSnapshot {
      return snapshotGame(getLiveGame(roomId).game);
    },

    commandRoom(roomId: string, playerId: PlayerId, command: GameCommand): GameSnapshot {
      const { hosted, game } = getLiveGame(roomId);
      applyHostedCommandFrame(hosted, game, "browser", [{ playerId, command }]);
      return snapshotGame(game);
    },

    commandRooms(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[]): GameSnapshot {
      const { hosted, game } = getLiveGame(roomId);
      applyHostedCommandFrame(hosted, game, "browser", commands);
      return snapshotGame(game);
    },

    commandTickRoom(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[], ticks: number): RoomTickResult {
      const { hosted, game } = getLiveGame(roomId);
      applyHostedCommandFrame(hosted, game, "sdk-agent", commands);
      return tickHostedRoom(hosted, game, ticks);
    },

    tickRoom(roomId: string, ticks: number): RoomTickResult {
      const { hosted, game } = getLiveGame(roomId);
      return tickHostedRoom(hosted, game, ticks);
    },

    tickRoomFrame(roomId: string, frame: CommandFrame, source: ReplayCommandSource = "browser"): RoomFrameTickResult {
      const { hosted, game } = getLiveGame(roomId);
      if (frame.roomId !== roomId) throw new Error(`Command frame room ${frame.roomId} does not match ${roomId}`);
      return tickHostedFrame(hosted, game, frame, source);
    },

    checkpointRoom(roomId: string): CheckpointFrame {
      const { game } = getLiveGame(roomId);
      return { roomId, tick: game.tick, snapshot: snapshotGame(game), nextId: game.nextId };
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
      const room = { ...save.room, id: options.roomId ?? save.room.id, status: "inMatch" as const, autoTick: defaultAutoTick };
      if (rooms.has(room.id)) throw new Error(`Room ${room.id} already exists`);
      rooms.set(room.id, { room, game: restoreGameFromSave(save), aiRuntime: createHostedAiRuntime(save.runtime.aiPlayers, save.runtime.aiVersions), nextFrameSequence: 0 });
      return room;
    },

    tickActiveRooms(ticks = 1, options: { excludeRoomIds?: Set<string> } = {}): RoomState[] {
      const changed: RoomState[] = [];
      for (const hosted of rooms.values()) {
        if (options.excludeRoomIds?.has(hosted.room.id)) continue;
        if (hosted.room.status !== "inMatch" || !hosted.game) continue;
        if (!hosted.room.autoTick) continue;
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

  function createHostedAiRuntime(aiPlayers: PlayerId[], versions?: Partial<Record<PlayerId, AiScriptVersion>>): AiRuntimeState {
    return createAiRuntime(aiPlayers, {
      ...(versions ? { versions } : {}),
      ...(options.aiScripts ? { scripts: options.aiScripts } : {}),
    });
  }
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

function tickHostedFrame(hosted: HostedRoom, game: Game, frame: CommandFrame, source: ReplayCommandSource): RoomFrameTickResult {
  const memoryStarted = process.memoryUsage();
  const cpuStarted = process.cpuUsage();
  const started = performance.now();
  const completedFrame = completeHostedCommandFrame(hosted, game, frame);
  recordHostedReplayFrame(hosted, source, completedFrame);
  applyCommandFrame(game, completedFrame);
  stepGame(game);
  recordHostedReplayCheckpoint(hosted, game);
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStarted);
  const memory = process.memoryUsage();
  if (game.match.winner) {
    hosted.room = finishRoom(hosted.room, snapshotGame(game));
    delete hosted.game;
    delete hosted.aiRuntime;
  }
  return {
    ticks: 1,
    elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapDeltaBytes: memory.heapUsed - memoryStarted.heapUsed,
    },
    snapshot: snapshotGame(game),
    room: hosted.room,
    frame: completedFrame,
  };
}

function completeHostedCommandFrame(hosted: HostedRoom, game: Game, frame: CommandFrame): CommandFrame {
  validateHostedFrameEntries(game, frame.commands);
  if (!hosted.aiRuntime) return frame;
  // @@@lockstep-ai-frame - Connected rooms must broadcast AI commands in the same authoritative frame clients apply.
  const aiCommands = planHostedAiCommands(hosted, game);
  if (aiCommands.length === 0) return frame;
  return { ...frame, commands: [...frame.commands, ...aiCommands] };
}

function runHostedAiFrame(hosted: HostedRoom, game: Game) {
  if (!hosted.aiRuntime) return;
  // @@@hosted-ai-frame - Internal AI plans only; the room host owns the authoritative frame application.
  applyHostedCommandFrame(hosted, game, "internal-ai", planHostedAiCommands(hosted, game));
}

function applyHostedCommandFrame(hosted: HostedRoom, game: Game, source: ReplayCommandSource, commands: CommandEnvelope[]) {
  if (commands.length === 0) return;
  validateHostedFrameEntries(game, commands);
  const frame = createHostedCommandFrame(hosted, game, commands);
  recordHostedReplayFrame(hosted, source, frame);
  applyCommandFrame(game, frame);
}

function planHostedAiCommands(hosted: HostedRoom, game: Game): CommandEnvelope[] {
  if (!hosted.aiRuntime) return [];
  const runtimeLastThink = { ...hosted.aiRuntime.lastThink };
  try {
    const result = planPresetAiRuntimeCommands(game, hosted.aiRuntime);
    const commands = result.commands.map((entry) => ({ playerId: entry.playerId, command: entry.command }));
    validateHostedFrameEntries(game, commands);
    return commands;
  } catch (error) {
    hosted.aiRuntime.lastThink = runtimeLastThink;
    throw error;
  }
}

function validateHostedFrameEntries(game: Game, commands: CommandEnvelope[]) {
  const snapshot = snapshotGame(game);
  for (const entry of commands) {
    const currentCommand = commandWithCurrentIssuers(game, entry.playerId, entry.command);
    if (!currentCommand) continue;
    const error = commandValidationError(snapshot, entry.playerId, currentCommand);
    if (error) throw new Error(`Hosted command rejected: ${error}`);
  }
}

function createHostedCommandFrame(hosted: HostedRoom, game: Game, commands: CommandEnvelope[]): CommandFrame {
  const frame = {
    roomId: hosted.room.id,
    tick: game.tick,
    sequence: hosted.nextFrameSequence,
    commands,
  };
  hosted.nextFrameSequence += 1;
  return frame;
}

function recordHostedReplayFrame(hosted: HostedRoom, source: ReplayCommandSource, frame: CommandFrame) {
  if (!hosted.debugReplay) return;
  recordReplayFrame(hosted.debugReplay, { source, frame });
}

function recordHostedReplayCheckpoint(hosted: HostedRoom, game: Game) {
  if (!hosted.debugReplay) return;
  if (!game.match.winner && game.tick % REPLAY_CHECKPOINT_INTERVAL_TICKS !== 0) return;
  recordReplayCheckpoint(hosted.debugReplay, game);
}
