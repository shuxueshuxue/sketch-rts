import { createGrandThirtyRoom, createRoom, finishRoom, joinFirstOpenSlot, leaveUserSlot, lobbyVisibleRooms, resizeRoomSlots, roomToGameSetup, updateRoomMap, updateRoomSlot, type CreateRoomInput, type GrandStressRoomOptions, type SlotPatch } from "../shared/rooms";
import { createSaveGameRecord, restoreGameFromSave, type SaveGameInput, type SaveGameRecord } from "../shared/savegame";
import { createAiRuntime, createPresetAiRuntimeFramePlanner, type AiRuntimeFramePlannerState, type AiRuntimeState } from "../ai/runtime";
import type { AiScript, AiScriptVersion } from "../ai/policy";
import { createGame, snapshotGame, type Game } from "../shared/sim";
import { CommandFrameRuntime } from "../shared/sim/command-frame-runtime";
import { checksumGame } from "../shared/sim/checksum";
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

export type HostedRoomFrameEvent = {
  frame: CommandFrame;
  source: ReplayCommandSource;
  room: RoomState;
  snapshot: GameSnapshot;
  checksum: string;
};

export type HostedRoomFrameListener = (event: HostedRoomFrameEvent) => void;

export type RoomResetResult = {
  room: RoomState;
  snapshot: GameSnapshot;
};

type HostedRoom = {
  room: RoomState;
  game?: Game;
  aiRuntime?: AiRuntimeState;
  frameRuntime?: CommandFrameRuntime<AiRuntimeFramePlannerState>;
  debugReplay?: DebugReplayTrace;
  frameListeners?: Set<HostedRoomFrameListener>;
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

  function getLiveGame(roomId: string): { hosted: HostedRoom; game: Game; frameRuntime: CommandFrameRuntime<AiRuntimeFramePlannerState> } {
    const hosted = getHosted(roomId);
    if (hosted.room.status !== "inMatch" || !hosted.game) throw new Error(`Room ${roomId} is not in a live match`);
    hosted.frameRuntime ??= createHostedFrameRuntime(hosted, hosted.game);
    return { hosted, game: hosted.game, frameRuntime: hosted.frameRuntime };
  }

  function putRoom(room: RoomState, game?: Game, aiRuntime?: AiRuntimeState): RoomState {
    const storedRoom = { ...room, autoTick: defaultAutoTick };
    const hosted: HostedRoom = { room: storedRoom };
    if (game) {
      hosted.game = game;
      if (aiRuntime) hosted.aiRuntime = aiRuntime;
      hosted.frameRuntime = createHostedFrameRuntime(hosted, game);
    }
    rooms.set(storedRoom.id, hosted);
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

    observeRoomFrames(roomId: string, listener: HostedRoomFrameListener): () => void {
      const hosted = getHosted(roomId);
      hosted.frameListeners ??= new Set();
      hosted.frameListeners.add(listener);
      return () => hosted.frameListeners?.delete(listener);
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
      hosted.frameRuntime = createHostedFrameRuntime(hosted, hosted.game);
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
      hosted.frameRuntime = createHostedFrameRuntime(hosted, hosted.game);
      const { result: _result, ...roomWithoutResult } = hosted.room;
      hosted.room = { ...roomWithoutResult, mapId, status: "inMatch" };
      return { room: hosted.room, snapshot: snapshotGame(hosted.game) };
    },

    snapshot(roomId: string): GameSnapshot {
      return snapshotGame(getLiveGame(roomId).game);
    },

    checksumRoom(roomId: string): string {
      return checksumGame(getLiveGame(roomId).game);
    },

    commandRoom(roomId: string, playerId: PlayerId, command: GameCommand): GameSnapshot {
      const { hosted, game, frameRuntime } = getLiveGame(roomId);
      const commands = [{ playerId, command }];
      frameRuntime.admit(commands);
      applyHostedCommandFrame(hosted, frameRuntime, "browser", commands);
      return snapshotGame(game);
    },

    admitCommands(roomId: string, commands: CommandEnvelope[]): void {
      const { frameRuntime } = getLiveGame(roomId);
      frameRuntime.admit(commands);
    },

    commandRooms(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[]): GameSnapshot {
      const { hosted, game, frameRuntime } = getLiveGame(roomId);
      frameRuntime.admit(commands);
      applyHostedCommandFrame(hosted, frameRuntime, "browser", commands);
      return snapshotGame(game);
    },

    commandTickRoom(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[], ticks: number): RoomTickResult {
      const { hosted, game, frameRuntime } = getLiveGame(roomId);
      frameRuntime.admit(commands);
      return tickHostedRoom(hosted, game, ticks, { initialCommands: commands, initialSource: "sdk-agent" });
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
      const game = restoreGameFromSave(save);
      const hosted: HostedRoom = { room, game, aiRuntime: createHostedAiRuntime(save.runtime.aiPlayers, save.runtime.aiVersions) };
      hosted.frameRuntime = createHostedFrameRuntime(hosted, game);
      rooms.set(room.id, hosted);
      return room;
    },

    tickActiveRooms(ticks = 1, options: { excludeRoomIds?: Set<string> } = {}): RoomState[] {
      const changed: RoomState[] = [];
      for (const hosted of rooms.values()) {
        if (options.excludeRoomIds?.has(hosted.room.id)) continue;
        if (hosted.room.status !== "inMatch" || !hosted.game) continue;
        if (!hosted.room.autoTick) continue;
        const game = hosted.game;
        for (let i = 0; i < ticks; i += 1) {
          advanceHostedRoomTick(hosted, game, { source: "internal-ai" });
          if (game.match.winner) break;
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

function tickHostedRoom(hosted: HostedRoom, game: Game, ticks: number, options: { initialCommands?: CommandEnvelope[]; initialSource?: ReplayCommandSource } = {}): RoomTickResult {
  if (!Number.isInteger(ticks) || ticks < 1) throw new Error("ticks must be a positive integer");
  const memoryStarted = process.memoryUsage();
  const cpuStarted = process.cpuUsage();
  const started = performance.now();
  hosted.frameRuntime ??= createHostedFrameRuntime(hosted, game);
  for (let i = 0; i < ticks; i += 1) {
    const commands = i === 0 ? options.initialCommands ?? [] : [];
    const source = commands.length > 0 ? options.initialSource ?? "browser" : "internal-ai";
    advanceHostedRoomTick(hosted, game, { commands, source });
    if (game.match.winner) break;
  }
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStarted);
  const memory = process.memoryUsage();
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
  hosted.frameRuntime ??= createHostedFrameRuntime(hosted, game);
  const completedFrame = advanceHostedRoomTick(hosted, game, { frame, source });
  if (!completedFrame) throw new Error(`Hosted room ${hosted.room.id} advanced without a command frame`);
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStarted);
  const memory = process.memoryUsage();
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

function advanceHostedRoomTick(hosted: HostedRoom, game: Game, input: { commands?: CommandEnvelope[]; frame?: CommandFrame; source: ReplayCommandSource }): CommandFrame | undefined {
  hosted.frameRuntime ??= createHostedFrameRuntime(hosted, game);
  const commands = input.commands ?? input.frame?.commands ?? [];
  const frameOptions = input.frame ? { frame: input.frame } : {};
  const completedFrame = hosted.frameRuntime.tick(commands, { ...frameOptions, onFrame: (frame) => recordHostedReplayFrame(hosted, input.source, frame) });
  recordHostedReplayCheckpoint(hosted, game);
  const snapshot = snapshotGame(game);
  if (game.match.winner) finishHostedRoom(hosted, snapshot);
  if (completedFrame) notifyHostedFrameListeners(hosted, { frame: completedFrame, source: input.source, room: hosted.room, snapshot, checksum: checksumGame(game) });
  return completedFrame;
}

function finishHostedRoom(hosted: HostedRoom, snapshot: GameSnapshot) {
  hosted.room = finishRoom(hosted.room, snapshot);
  delete hosted.game;
  delete hosted.aiRuntime;
  delete hosted.frameRuntime;
}

function notifyHostedFrameListeners(hosted: HostedRoom, event: HostedRoomFrameEvent) {
  for (const listener of [...(hosted.frameListeners ?? [])]) listener(event);
}

function applyHostedCommandFrame(hosted: HostedRoom, frameRuntime: CommandFrameRuntime<AiRuntimeFramePlannerState>, source: ReplayCommandSource, commands: CommandEnvelope[]) {
  frameRuntime.completeAndApply(commands, { includeAi: false, onFrame: (frame) => recordHostedReplayFrame(hosted, source, frame) });
}

function createHostedFrameRuntime(hosted: HostedRoom, game: Game): CommandFrameRuntime<AiRuntimeFramePlannerState> {
  return new CommandFrameRuntime({
    game,
    roomId: hosted.room.id,
    rejectionLabel: "Hosted command rejected",
    ...(hosted.aiRuntime ? { aiPlanner: createPresetAiRuntimeFramePlanner(game, hosted.aiRuntime) } : {}),
  });
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
