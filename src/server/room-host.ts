import { createRoomLifecycleHost } from "../shared/room-lifecycle";
import type { CreateRoomInput, GrandStressRoomOptions, SlotPatch } from "../shared/rooms";
import { createSaveGameRecord, restoreGameFromSave, type SaveGameInput, type SaveGameRecord } from "../shared/savegame";
import { createAiRuntime, createPresetAiRuntimeFramePlanner, type AiRuntimeFramePlannerState, type AiRuntimeState, type AiThinkExecutor, type AiThinkExecutorFactory } from "../ai/runtime";
import type { AiScript, AiScriptVersion } from "../ai/policy";
import { createGame, snapshotGame, warmGameCaches, type Game } from "../shared/sim";
import { CommandFrameRuntime } from "../shared/sim/command-frame-runtime";
import { checksumGame } from "../shared/sim/checksum";
import { LOCKSTEP_CHECKSUM_EVERY_TICKS } from "../shared/net/cadence";
import { prepareShipPlanningJobs } from "../shared/ship-planning-job";
import { extractReplayFrameSave, replaySnapshotToTick, type DebugReplayTrace, type ReplayCommandSource } from "../shared/replay";
import type { CheckpointFrame, CommandEnvelope, CommandFrame } from "../shared/net/types";
import type { GameCommand, GameSetupOptions, GameSnapshot, LocalUserProfile, MapId, PlayerId, RoomState } from "../shared/types";
import { RoomHistoryLog } from "./room-history";

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
  // The world's tick after the frame.
  tick: number;
  // The world's checksum after the frame, on the ticks lockstep clients report theirs and on the last one (see
  // @@@lockstep-cadence).
  checksum?: string;
};

export type HostedRoomFrameListener = (event: HostedRoomFrameEvent) => void;

export type HostedRoomLifecycleEvent = {
  room: RoomState;
  checkpoint?: CheckpointFrame;
};

export type HostedRoomLifecycleListener = (event: HostedRoomLifecycleEvent) => void;

export type RoomResetResult = {
  room: RoomState;
  snapshot: GameSnapshot;
};

type HostedRoom = {
  room: RoomState;
  history: RoomHistoryLog;
  finishRoom: (snapshot: GameSnapshot) => RoomState;
  game?: Game;
  aiRuntime?: AiRuntimeState;
  frameRuntime?: CommandFrameRuntime<AiRuntimeFramePlannerState>;
  // Where the frame runtime's AI thinks; it belongs to that runtime and is closed with it.
  thinkExecutor?: AiThinkExecutor;
  thinkExecutors?: AiThinkExecutorFactory;
  debugReplay?: { id: string; label?: string; initialSave: SaveGameRecord };
  frameListeners: Set<HostedRoomFrameListener>;
  lifecycleListeners: Set<HostedRoomLifecycleListener>;
};

export type RoomHostOptions = {
  autoTick?: boolean;
  aiScripts?: AiScript[];
  frameHistoryLimit?: number;
  // Where hosted matches' AI thinks (see @@@think-thread); on the room host's thread when absent.
  aiThinkExecutor?: AiThinkExecutorFactory;
};

export function createRoomHost(options: RoomHostOptions = {}) {
  const defaultAutoTick = options.autoTick ?? true;
  const lifecycle = createRoomLifecycleHost({ defaultAutoTick });
  const hostedRooms = new Map<string, HostedRoom>();
  const saves = new Map<string, SaveGameRecord>();
  const frameListeners = new Map<string, Set<HostedRoomFrameListener>>();
  const lifecycleListeners = new Map<string, Set<HostedRoomLifecycleListener>>();

  function getHosted(roomId: string): HostedRoom {
    const hosted = hostedRooms.get(roomId);
    if (!hosted) throw new Error(`Unknown room ${roomId}`);
    return hosted;
  }

  function getLiveGame(roomId: string): { hosted: HostedRoom; game: Game; frameRuntime: CommandFrameRuntime<AiRuntimeFramePlannerState> } {
    const hosted = getHosted(roomId);
    if (hosted.room.status !== "inMatch" || !hosted.game) throw new Error(`Room ${roomId} is not in a live match`);
    hosted.frameRuntime ??= createHostedFrameRuntime(hosted, hosted.game);
    return { hosted, game: hosted.game, frameRuntime: hosted.frameRuntime };
  }

  // Scripts given as functions cannot cross to another thread; a host given them thinks on its own.
  const thinkExecutors = options.aiScripts ? undefined : options.aiThinkExecutor;

  function putHostedRoom(room: RoomState, game?: Game, aiRuntime?: AiRuntimeState): RoomState {
    const hosted: HostedRoom = {
      room,
      history: createRoomHistory(),
      finishRoom: (snapshot) => lifecycle.finishRoom(room.id, snapshot),
      frameListeners: frameListenerSet(room.id),
      lifecycleListeners: lifecycleListenerSet(room.id),
      ...(thinkExecutors ? { thinkExecutors } : {}),
    };
    if (game) {
      hosted.game = game;
      if (aiRuntime) hosted.aiRuntime = aiRuntime;
      hosted.frameRuntime = createHostedFrameRuntime(hosted, game);
    }
    hostedRooms.set(room.id, hosted);
    return room;
  }

  function createRoomHistory() {
    return new RoomHistoryLog({ ...(options.frameHistoryLimit !== undefined ? { frameHistoryLimit: options.frameHistoryLimit } : {}) });
  }

  function frameListenerSet(roomId: string) {
    const listeners = frameListeners.get(roomId) ?? new Set<HostedRoomFrameListener>();
    frameListeners.set(roomId, listeners);
    return listeners;
  }

  function lifecycleListenerSet(roomId: string) {
    const listeners = lifecycleListeners.get(roomId) ?? new Set<HostedRoomLifecycleListener>();
    lifecycleListeners.set(roomId, listeners);
    return listeners;
  }

  function dropEmptyListenerSets(roomId: string) {
    if (hostedRooms.has(roomId)) return;
    if (frameListeners.get(roomId)?.size === 0) frameListeners.delete(roomId);
    if (lifecycleListeners.get(roomId)?.size === 0) lifecycleListeners.delete(roomId);
  }

  // When each room was last attended (see closeIdleRooms).
  const lastAttended = new Map<string, number>();

  function closeHostedRoom(roomId: string, userId: string): RoomState {
    const hosted = getHosted(roomId);
    const closed = lifecycle.closeRoom(roomId, userId);
    notifyHostedRoomLifecycle(hosted, { room: closed });
    releaseThinkExecutor(hosted);
    hostedRooms.delete(roomId);
    lastAttended.delete(roomId);
    dropEmptyListenerSets(roomId);
    return closed;
  }

  return {
    listRooms(viewerUserId?: string): RoomState[] {
      return lifecycle.listRooms(viewerUserId);
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
      return lifecycle.getRoom(roomId);
    },

    hasRoom(roomId: string): boolean {
      return lifecycle.hasRoom(roomId);
    },

    observeRoomFrames(roomId: string, listener: HostedRoomFrameListener): () => void {
      const listeners = frameListenerSet(roomId);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        dropEmptyListenerSets(roomId);
      };
    },

    observeRoomLifecycle(roomId: string, listener: HostedRoomLifecycleListener): () => void {
      const listeners = lifecycleListenerSet(roomId);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        dropEmptyListenerSets(roomId);
      };
    },

    setFrameHistoryLimit(roomId: string, frameHistoryLimit: number): void {
      getHosted(roomId).history.setFrameHistoryLimit(frameHistoryLimit);
    },

    pauseRoom(roomId: string): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.pauseRoom(roomId);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    resumeRoom(roomId: string): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.resumeRoom(roomId);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    closeRoom(roomId: string, userId: string): RoomState {
      return closeHostedRoom(roomId, userId);
    },

    // The same people play the room again (see @@@rematch); its next start builds a fresh game, as any start does.
    reopenRoom(roomId: string, userId: string): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.reopenRoom(roomId, userId);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    // @@@idle-room-reaper - A room nobody attends (no browser in it, no lobby watching it) for `idleMs` is closed as its
    // host would close it, and freed. Rooms used to stay for good, every abandoned game in memory, and when the game went
    // public the server ran out of heap within hours (10-02 22:08).
    closeIdleRooms(attended: (roomId: string) => boolean, now: number, idleMs: number): string[] {
      const closed: string[] = [];
      for (const [roomId, hosted] of [...hostedRooms]) {
        if (attended(roomId)) {
          lastAttended.set(roomId, now);
          continue;
        }
        const since = lastAttended.get(roomId) ?? now;
        lastAttended.set(roomId, since);
        if (now - since < idleMs) continue;
        closeHostedRoom(roomId, hosted.room.hostUserId);
        closed.push(roomId);
      }
      return closed;
    },

    createRoom(input: CreateRoomInput): RoomState {
      return putHostedRoom(lifecycle.createRoom(input));
    },

    createGrandThirtyRoom(id: string, host: LocalUserProfile, options: GrandStressRoomOptions = {}): RoomState {
      return putHostedRoom(lifecycle.createGrandThirtyRoom(id, host, options));
    },

    joinRoom(roomId: string, user: LocalUserProfile): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.joinRoom(roomId, user);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    leaveRoom(roomId: string, userId: string): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.leaveRoom(roomId, userId);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    updateSlot(roomId: string, slotId: string, patch: SlotPatch): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.updateSlot(roomId, slotId, patch);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    updateMap(roomId: string, mapId: RoomState["mapId"]): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.updateMap(roomId, mapId);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    resizeSlots(roomId: string, humanCount: number, aiCount: number): RoomState {
      const hosted = getHosted(roomId);
      hosted.room = lifecycle.resizeSlots(roomId, humanCount, aiCount);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room });
      return hosted.room;
    },

    startRoom(roomId: string): RoomState {
      const hosted = getHosted(roomId);
      const setup = lifecycle.prepareStartRoom(roomId);
      const game = warmedGame(createGame(setup.mapId, setup.options));
      const aiRuntime = createHostedAiRuntime(setup.options.aiPlayers ?? [], setup.options.aiVersions);
      const { room } = lifecycle.startRoom(roomId);
      hosted.room = room;
      hosted.game = game;
      hosted.aiRuntime = aiRuntime;
      hosted.frameRuntime = createHostedFrameRuntime(hosted, hosted.game);
      hosted.history = createRoomHistory();
      delete hosted.debugReplay;
      const checkpoint = createHostedCheckpoint(hosted, hosted.game);
      hosted.history.recordCheckpoint(checkpoint);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room, checkpoint });
      return hosted.room;
    },

    resetRoom(roomId: string, mapId: MapId, options: GameSetupOptions = {}): RoomResetResult {
      const hosted = getHosted(roomId);
      const setup = lifecycle.prepareResetRoom(roomId, mapId);
      const mergedOptions: GameSetupOptions = {
        ...(options.scenario ? { scenario: options.scenario } : {}),
        ...(options.players ?? setup.options.players ? { players: options.players ?? setup.options.players } : {}),
        ...(options.aiPlayers ?? setup.options.aiPlayers ? { aiPlayers: options.aiPlayers ?? setup.options.aiPlayers } : {}),
        ...(options.aiVersions ?? setup.options.aiVersions ? { aiVersions: options.aiVersions ?? setup.options.aiVersions } : {}),
        ...(options.teams ?? setup.options.teams ? { teams: options.teams ?? setup.options.teams } : {}),
        ...(options.races ?? setup.options.races ? { races: options.races ?? setup.options.races } : {}),
        ...(options.layout ?? setup.options.layout ? { layout: options.layout ?? setup.options.layout } : {}),
      };
      const game = warmedGame(createGame(mapId, mergedOptions));
      const aiRuntime = createHostedAiRuntime(mergedOptions.aiPlayers ?? [], mergedOptions.aiVersions);
      const { room } = lifecycle.resetRoom(roomId, mapId);
      hosted.room = room;
      hosted.game = game;
      hosted.aiRuntime = aiRuntime;
      hosted.frameRuntime = createHostedFrameRuntime(hosted, hosted.game);
      hosted.history = createRoomHistory();
      delete hosted.debugReplay;
      const checkpoint = createHostedCheckpoint(hosted, hosted.game);
      hosted.history.recordCheckpoint(checkpoint);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room, checkpoint });
      return { room: hosted.room, snapshot: snapshotGame(hosted.game) };
    },

    snapshot(roomId: string): GameSnapshot {
      return snapshotGame(getLiveGame(roomId).game);
    },

    currentTick(roomId: string): number {
      return getLiveGame(roomId).game.tick;
    },

    checksumRoom(roomId: string): string {
      return checksumGame(getLiveGame(roomId).game);
    },

    commandRoom(roomId: string, playerId: PlayerId, command: GameCommand): GameSnapshot {
      const { hosted, game, frameRuntime } = getLiveGame(roomId);
      const commands = [{ playerId, command }];
      frameRuntime.admit(commands);
      return tickHostedRoom(hosted, game, 1, { initialCommands: commands, initialSource: "browser" }).snapshot;
    },

    admitCommands(roomId: string, commands: CommandEnvelope[]): void {
      const { frameRuntime } = getLiveGame(roomId);
      frameRuntime.admit(commands);
    },

    commandRooms(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[]): GameSnapshot {
      const { hosted, game, frameRuntime } = getLiveGame(roomId);
      frameRuntime.admit(commands);
      return tickHostedRoom(hosted, game, 1, { initialCommands: commands, initialSource: "browser" }).snapshot;
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

    // Whether the room can tick now: its restored ship graphs are rebuilt. Its AI never holds it (see @@@planner-schedule).
    prepareRoomTick(roomId: string, maxSlices = 1): boolean {
      const { game } = getLiveGame(roomId);
      return prepareShipPlanningJobs(game, maxSlices);
    },

    tickRoomFrame(roomId: string, frame: CommandFrame, source: ReplayCommandSource = "browser"): RoomFrameTickResult {
      const { hosted, game } = getLiveGame(roomId);
      if (frame.roomId !== roomId) throw new Error(`Command frame room ${frame.roomId} does not match ${roomId}`);
      return tickHostedFrame(hosted, game, frame, source);
    },

    // The live ticker's step: the completed frame only, without the public snapshot and usage figures of tickRoomFrame.
    advanceRoomFrame(roomId: string, frame: CommandFrame, source: ReplayCommandSource = "browser"): CommandFrame {
      const { hosted, game } = getLiveGame(roomId);
      if (frame.roomId !== roomId) throw new Error(`Command frame room ${frame.roomId} does not match ${roomId}`);
      const completed = advanceHostedRoomTick(hosted, game, { frame, source });
      if (!completed) throw new Error(`Hosted room ${roomId} advanced without a command frame`);
      return completed;
    },

    checkpointRoom(roomId: string): CheckpointFrame {
      const { hosted, game } = getLiveGame(roomId);
      const checkpoint = createHostedCheckpoint(hosted, game);
      hosted.history.recordCheckpoint(checkpoint);
      return checkpoint;
    },

    checkpointAtOrBefore(roomId: string, tick: number): CheckpointFrame | undefined {
      return getHosted(roomId).history.checkpointAtOrBefore(tick);
    },

    framesFrom(roomId: string, tick: number): CommandFrame[] {
      return getHosted(roomId).history.framesFrom(tick);
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
      hosted.debugReplay = { id: input.id, ...(input.label ? { label: input.label } : {}), initialSave };
      hosted.history.retainFramesFrom(initialSave.snapshot.tick);
      hosted.history.recordCheckpoint(createHostedCheckpoint(hosted, game));
      return hosted.history.debugReplayTrace(hosted.debugReplay);
    },

    readDebugReplay(roomId: string): DebugReplayTrace {
      const hosted = getHosted(roomId);
      if (!hosted.debugReplay) throw new Error(`Room ${roomId} is not recording a debug replay`);
      return hosted.history.debugReplayTrace(hosted.debugReplay);
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
      const room = lifecycle.adoptRoom({ ...save.room, id: options.roomId ?? save.room.id, status: "inMatch" as const });
      const game = warmedGame(restoreGameFromSave(save));
      const hosted: HostedRoom = {
        room,
        history: createRoomHistory(),
        finishRoom: (snapshot) => lifecycle.finishRoom(room.id, snapshot),
        game,
        aiRuntime: createHostedAiRuntime(save.runtime.aiPlayers, save.runtime.aiVersions),
        frameListeners: frameListenerSet(room.id),
        lifecycleListeners: lifecycleListenerSet(room.id),
        ...(thinkExecutors ? { thinkExecutors } : {}),
      };
      hosted.frameRuntime = createHostedFrameRuntime(hosted, game);
      const replaced = hostedRooms.get(room.id);
      if (replaced) releaseThinkExecutor(replaced);
      hostedRooms.set(room.id, hosted);
      const checkpoint = createHostedCheckpoint(hosted, game);
      hosted.history.recordCheckpoint(checkpoint);
      notifyHostedRoomLifecycle(hosted, { room: hosted.room, checkpoint });
      return room;
    },

    tickActiveRooms(ticks = 1, options: { excludeRoomIds?: Set<string> } = {}): RoomState[] {
      const changed: RoomState[] = [];
      for (const hosted of hostedRooms.values()) {
        if (options.excludeRoomIds?.has(hosted.room.id)) continue;
        if (hosted.room.status !== "inMatch" || !hosted.game) continue;
        if (!hosted.room.autoTick || hosted.room.paused) continue;
        const game = hosted.game;
        // A continued save may need its disposable navigation graph rebuilt.
        // Reconstruct one prior slice per ticker turn before advancing truth.
        if (!prepareShipPlanningJobs(game, 1)) continue;
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
    // A tick asked for over the API is a step of a match driven from outside: it waits for the AI, so the driver gets
    // the same frames however busy the thinking thread is (see @@@planner-schedule).
    advanceHostedRoomTick(hosted, game, { commands, source, settleAi: true });
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

function advanceHostedRoomTick(hosted: HostedRoom, game: Game, input: { commands?: CommandEnvelope[]; frame?: CommandFrame; source: ReplayCommandSource; settleAi?: boolean }): CommandFrame | undefined {
  hosted.frameRuntime ??= createHostedFrameRuntime(hosted, game);
  const commands = input.commands ?? input.frame?.commands ?? [];
  // @@@hosted-every-tick - A hosted room's every tick is a frame, whoever advances it: the live ticker (the lockstep
  // coordinator's frame), the REST /tick, the SDK and the active-room ticker alike. A tick with no commands left no frame,
  // so a page joined to the room waited for that tick forever and the history skipped it, and a client restored from an
  // earlier checkpoint stalled at the gap.
  const frameOptions = { everyTick: true, ...(input.frame ? { frame: input.frame } : {}), ...(input.settleAi ? { settleAi: true } : {}) };
  // A whole copy of the world is kept only where the history wants one (see ROOM_CHECKPOINT_INTERVAL_TICKS), and the
  // whole world is hashed only on the ticks lockstep clients compare (see @@@lockstep-cadence), not on every tick.
  if (hosted.history.wantsCheckpoint(game.tick)) hosted.history.recordCheckpoint(createHostedCheckpoint(hosted, game));
  const completedFrame = hosted.frameRuntime.tick(commands, { ...frameOptions, onFrame: (frame) => hosted.history.recordFrame(input.source, frame) });
  const matchEnded = Boolean(game.match.winner);
  if (matchEnded) {
    hosted.history.recordCheckpoint(createHostedCheckpoint(hosted, game));
    finishHostedRoom(hosted, snapshotGame(game));
  }
  if (completedFrame && hosted.frameListeners.size > 0) {
    const checksum = matchEnded || game.tick % LOCKSTEP_CHECKSUM_EVERY_TICKS === 0 ? checksumGame(game) : undefined;
    notifyHostedFrameListeners(hosted, { frame: completedFrame, source: input.source, room: hosted.room, tick: game.tick, ...(checksum === undefined ? {} : { checksum }) });
  }
  if (matchEnded) notifyHostedRoomLifecycle(hosted, { room: hosted.room });
  return completedFrame;
}

function createHostedCheckpoint(hosted: HostedRoom, game: Game): CheckpointFrame {
  return { roomId: hosted.room.id, tick: game.tick, snapshot: snapshotGame(game), nextId: game.nextId };
}

function finishHostedRoom(hosted: HostedRoom, snapshot: GameSnapshot) {
  hosted.room = hosted.finishRoom(snapshot);
  delete hosted.game;
  delete hosted.aiRuntime;
  delete hosted.frameRuntime;
  releaseThinkExecutor(hosted);
}

// A hosted match's derived navigation is built before its first tick, off the room ticker's clock.
function warmedGame(game: Game): Game {
  warmGameCaches(game);
  return game;
}

function releaseThinkExecutor(hosted: HostedRoom) {
  hosted.thinkExecutor?.close?.();
  delete hosted.thinkExecutor;
}

function notifyHostedFrameListeners(hosted: HostedRoom, event: HostedRoomFrameEvent) {
  for (const listener of [...hosted.frameListeners]) listener(event);
}

function notifyHostedRoomLifecycle(hosted: HostedRoom, event: HostedRoomLifecycleEvent) {
  for (const listener of [...hosted.lifecycleListeners]) listener(event);
}

function createHostedFrameRuntime(hosted: HostedRoom, game: Game): CommandFrameRuntime<AiRuntimeFramePlannerState> {
  // A new frame runtime starts a new AI (memory and all); the old one's thinking session goes with it.
  releaseThinkExecutor(hosted);
  if (hosted.aiRuntime && hosted.thinkExecutors) hosted.thinkExecutor = hosted.thinkExecutors(hosted.aiRuntime, game);
  return new CommandFrameRuntime({
    game,
    roomId: hosted.room.id,
    rejectionLabel: "Hosted command rejected",
    ...(hosted.aiRuntime ? { aiPlanner: createPresetAiRuntimeFramePlanner(game, hosted.aiRuntime, hosted.thinkExecutor ? { executor: hosted.thinkExecutor } : {}) } : {}),
  });
}
