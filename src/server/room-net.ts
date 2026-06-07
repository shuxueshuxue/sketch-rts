import { decodeClientNetMessage, encodeNetMessage } from "../shared/net/codec";
import { checkpointRequestClass } from "../shared/net/checkpoint-semantics";
import type { CheckpointRequestClass, ClientNetMessage, CommandFrame, RoomSyncEvent, RoomSyncEventKind, RoomSyncSummary, ServerNetMessage } from "../shared/net/types";
import type { PlayerId } from "../shared/types";
import { LockstepRoomCoordinator } from "./lockstep-room";
import type { createRoomHost, HostedRoomFrameEvent, HostedRoomLifecycleEvent } from "./room-host";
import { DEFAULT_ROOM_FRAME_HISTORY_LIMIT } from "./room-history";

export type RoomNetSocket = {
  send(data: string): void;
  on(event: "message" | "close", handler: ((raw: string) => void) | (() => void)): void;
};

export type RoomNetHubOptions = {
  roomHost: ReturnType<typeof createRoomHost>;
  commandDelayTicks?: number;
  frameHistoryLimit?: number;
  syncEventLimit?: number;
  now?: () => number;
};

type RoomNetState = {
  coordinator: LockstepRoomCoordinator;
  sockets: Set<RoomNetSocket>;
  epoch: number;
  authoritativeChecksums: Map<number, string>;
  desyncReports: Set<string>;
  syncEvents: RoomSyncEvent[];
  nextSyncEventSequence: number;
  nextChatSequence: number;
  unsubscribeFrameEvents?: () => void;
  unsubscribeLifecycleEvents?: () => void;
};

export class RoomNetHub {
  private rooms = new Map<string, RoomNetState>();

  constructor(private readonly options: RoomNetHubOptions) {}

  connect(roomId: string, socket: RoomNetSocket): void {
    const state = this.stateFor(roomId);
    state.sockets.add(socket);
    socket.on("message", (raw) => {
      try {
        this.receive(roomId, socket, String(raw));
      } catch (error) {
        this.send(roomId, socket, { type: "error", roomId, message: errorMessage(error) });
      }
    });
    socket.on("close", () => state.sockets.delete(socket));
  }

  tickRoom(roomId: string): CommandFrame | undefined {
    if (this.options.roomHost.getRoom(roomId).status !== "inMatch") return undefined;
    const state = this.stateFor(roomId);
    const snapshot = this.options.roomHost.snapshot(roomId);
    const frame = state.coordinator.buildFrame(snapshot.tick);
    const result = this.options.roomHost.tickRoomFrame(roomId, frame, "browser");
    return result.frame;
  }

  tickConnectedRooms(): Set<string> {
    const ticked = new Set<string>();
    for (const [roomId, state] of this.rooms.entries()) {
      if (!this.options.roomHost.hasRoom(roomId)) {
        if (state.sockets.size === 0) {
          state.unsubscribeFrameEvents?.();
          state.unsubscribeLifecycleEvents?.();
          this.rooms.delete(roomId);
        }
        continue;
      }
      if (state.sockets.size === 0) {
        continue;
      }
      if (this.options.roomHost.getRoom(roomId).status !== "inMatch") continue;
      this.tickRoom(roomId);
      ticked.add(roomId);
    }
    return ticked;
  }

  checksumsForTick(roomId: string, tick: number): Record<PlayerId, string> {
    return this.stateFor(roomId).coordinator.checksumsForTick(tick);
  }

  syncEventsForRoom(roomId: string): RoomSyncEvent[] {
    return this.stateFor(roomId).syncEvents.map((event) => ({ ...event, ...(event.checksums ? { checksums: { ...event.checksums } } : {}) }));
  }

  syncSummaryForRoom(roomId: string): RoomSyncSummary {
    const events = this.stateFor(roomId).syncEvents;
    const byKind = zeroKindCounts();
    const checkpointRequests = zeroCheckpointClassCounts();
    for (const event of events) {
      byKind[event.kind] += 1;
      if (event.kind === "checkpoint-request" && event.checkpointClass) checkpointRequests[event.checkpointClass] += 1;
    }
    return { total: events.length, byKind, checkpointRequests };
  }

  private receive(socketRoomId: string, socket: RoomNetSocket, raw: string): void {
    const message = decodeClientNetMessage(raw);
    if (message.roomId !== socketRoomId) throw new Error(`Client message room ${message.roomId} does not match socket room ${socketRoomId}`);
    if (message.type === "join") {
      const state = this.stateFor(message.roomId);
      this.send(message.roomId, socket, { type: "hello", roomId: message.roomId, playerId: message.playerId, tick: this.options.roomHost.snapshot(message.roomId).tick, epoch: state.epoch });
      return;
    }
    if (message.type === "command") {
      this.acceptCommand(message);
      return;
    }
    if (message.type === "chat") {
      this.acceptChat(message);
      return;
    }
    if (message.type === "checksum") {
      this.acceptChecksum(message);
      return;
    }
    if (message.type === "syncEvent") {
      if (!this.acceptsMessageEpoch(this.stateFor(message.roomId), message)) return;
      this.recordSyncEvent(message.roomId, message.event);
      return;
    }
    if (message.type === "requestCheckpoint") {
      this.sendCheckpointWithFrames(socket, message);
    }
  }

  private acceptCommand(message: Extract<ClientNetMessage, { type: "command" }>): void {
    const state = this.stateFor(message.roomId);
    if (!this.acceptsMessageEpoch(state, message)) return;
    const snapshot = this.options.roomHost.snapshot(message.roomId);
    this.options.roomHost.admitCommands(message.roomId, [{ playerId: message.playerId, command: message.command }]);
    state.coordinator.acceptCommand({
      currentTick: snapshot.tick,
      playerId: message.playerId,
      command: message.command,
      ...(message.clientSeq !== undefined ? { clientSeq: message.clientSeq } : {}),
    });
  }

  private acceptChat(message: Extract<ClientNetMessage, { type: "chat" }>): void {
    const state = this.stateFor(message.roomId);
    const sequence = state.nextChatSequence;
    state.nextChatSequence += 1;
    this.broadcast(message.roomId, {
      type: "chat",
      message: {
        id: `chat-${message.roomId}-${sequence}`,
        roomId: message.roomId,
        playerId: message.playerId,
        senderName: message.senderName,
        text: message.text,
        sentAt: this.options.now?.() ?? Date.now(),
      },
    });
  }

  private stateFor(roomId: string): RoomNetState {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const created: RoomNetState = {
      coordinator: this.createCoordinator(roomId),
      sockets: new Set<RoomNetSocket>(),
      epoch: 0,
      authoritativeChecksums: new Map<number, string>(),
      desyncReports: new Set<string>(),
      syncEvents: [],
      nextSyncEventSequence: 1,
      nextChatSequence: 1,
    };
    if (this.options.frameHistoryLimit !== undefined) this.options.roomHost.setFrameHistoryLimit(roomId, this.options.frameHistoryLimit);
    created.unsubscribeFrameEvents = this.options.roomHost.observeRoomFrames(roomId, (event) => this.publishFrameEvent(roomId, event));
    created.unsubscribeLifecycleEvents = this.options.roomHost.observeRoomLifecycle(roomId, (event) => this.publishLifecycleEvent(roomId, event));
    this.rooms.set(roomId, created);
    return created;
  }

  private publishFrameEvent(roomId: string, event: HostedRoomFrameEvent): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    this.recordAuthoritativeChecksum(roomId, event.snapshot.tick, event.checksum);
    this.broadcast(roomId, { type: "frame", frame: event.frame, epoch: state.epoch });
  }

  private publishLifecycleEvent(roomId: string, event: HostedRoomLifecycleEvent): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    if (event.checkpoint) this.resetLockstepSession(roomId, state);
    this.broadcast(roomId, { type: "room", room: event.room });
    if (event.checkpoint) this.broadcast(roomId, { type: "checkpoint", checkpoint: event.checkpoint, epoch: state.epoch });
  }

  private createCoordinator(roomId: string): LockstepRoomCoordinator {
    return new LockstepRoomCoordinator({ roomId, ...(this.options.commandDelayTicks !== undefined ? { commandDelayTicks: this.options.commandDelayTicks } : {}) });
  }

  private resetLockstepSession(roomId: string, state: RoomNetState) {
    // @@@room-net-epoch-reset - A replacement checkpoint starts a new lockstep epoch; delayed commands and checksum comparisons from the old game cannot cross it.
    state.epoch += 1;
    state.coordinator = this.createCoordinator(roomId);
    state.authoritativeChecksums.clear();
    state.desyncReports.clear();
  }

  private broadcast(roomId: string, message: ServerNetMessage): void {
    const state = this.stateFor(roomId);
    const encoded = encodeNetMessage(message);
    for (const socket of [...state.sockets]) this.trySend(state, socket, encoded);
  }

  private send(roomId: string, socket: RoomNetSocket, message: ServerNetMessage): boolean {
    return this.trySend(this.stateFor(roomId), socket, encodeNetMessage(message));
  }

  private trySend(state: RoomNetState, socket: RoomNetSocket, encoded: string): boolean {
    try {
      socket.send(encoded);
      return true;
    } catch {
      // @@@room-net-stale-socket - A closed client connection is transport churn; remove it so one stale browser cannot stop the authoritative room ticker.
      state.sockets.delete(socket);
      return false;
    }
  }

  private sendCheckpointWithFrames(socket: RoomNetSocket, message: Extract<ClientNetMessage, { type: "requestCheckpoint" }>): void {
    const roomId = message.roomId;
    const requestedTick = message.tick;
    const state = this.stateFor(roomId);
    if (!this.acceptsMessageEpoch(state, message)) return;
    const checkpoint = requestedTick === undefined ? this.options.roomHost.checkpointRoom(roomId) : this.options.roomHost.checkpointAtOrBefore(roomId, requestedTick) ?? this.options.roomHost.checkpointRoom(roomId);
    const reason = message.reason ?? (requestedTick === undefined ? "manual" : "late-catchup");
    const checkpointClass = checkpointRequestClass(reason);
    this.recordSyncEvent(roomId, {
      kind: "checkpoint-request",
      roomId,
      playerId: message.playerId,
      localTick: message.clientTick ?? this.options.roomHost.snapshot(roomId).tick,
      serverTick: checkpoint.tick,
      reason,
      checkpointClass,
      ...(message.clientChecksum ? { clientChecksum: message.clientChecksum } : {}),
    });
    if (!this.send(roomId, socket, { type: "checkpoint", checkpoint: { ...checkpoint, reason, checkpointClass }, epoch: state.epoch })) return;
    for (const frame of this.options.roomHost.framesFrom(roomId, checkpoint.tick)) {
      if (!this.send(roomId, socket, { type: "frame", frame, epoch: state.epoch })) return;
    }
  }

  private acceptChecksum(message: Extract<ClientNetMessage, { type: "checksum" }>): void {
    const state = this.stateFor(message.roomId);
    if (!this.acceptsMessageEpoch(state, message)) return;
    const retainedTicks = [...state.authoritativeChecksums.keys()];
    const oldestRetainedTick = retainedTicks.length > 0 ? Math.min(...retainedTicks) : undefined;
    const latestRetainedTick = retainedTicks.length > 0 ? Math.max(...retainedTicks) : undefined;
    // @@@checksum-window - Client checksums are diagnostic evidence for retained authoritative ticks only; stale or future ticks cannot be compared and must not grow room memory.
    if ((oldestRetainedTick !== undefined && message.tick < oldestRetainedTick) || (latestRetainedTick !== undefined && message.tick > latestRetainedTick)) return;
    state.coordinator.recordChecksum(message);
    const authoritative = state.authoritativeChecksums.get(message.tick);
    if (authoritative !== undefined) this.reportChecksumMismatchIfNeeded(message.roomId, message.playerId, message.tick, message.hash, authoritative);
  }

  private recordAuthoritativeChecksum(roomId: string, tick: number, hash: string): void {
    const state = this.stateFor(roomId);
    state.authoritativeChecksums.set(tick, hash);
    this.trimChecksumHistory(state, tick);
    const clientChecksums = state.coordinator.checksumsForTick(tick);
    for (const [playerId, clientHash] of Object.entries(clientChecksums)) {
      this.reportChecksumMismatchIfNeeded(roomId, playerId, tick, clientHash, hash);
    }
  }

  private reportChecksumMismatchIfNeeded(roomId: string, playerId: PlayerId, tick: number, clientHash: string, authoritativeHash: string): void {
    if (clientHash === authoritativeHash) return;
    const state = this.stateFor(roomId);
    const key = `${tick}:${playerId}:${clientHash}:${authoritativeHash}`;
    if (state.desyncReports.has(key)) return;
    state.desyncReports.add(key);
    const checksums = { ...state.coordinator.checksumsForTick(tick), server: authoritativeHash };
    this.recordSyncEvent(roomId, {
      kind: "checksum-mismatch",
      roomId,
      playerId,
      localTick: tick,
      serverTick: tick,
      message: `Checksum mismatch at tick ${tick}`,
      checksums,
    });
    this.broadcast(roomId, { type: "desync", roomId, tick, checksums, epoch: state.epoch });
  }

  private recordSyncEvent(roomId: string, event: RoomSyncEvent): void {
    const state = this.stateFor(roomId);
    const stored = {
      ...event,
      id: `sync-${roomId}-${state.nextSyncEventSequence}`,
      roomId,
      recordedAt: this.options.now?.() ?? Date.now(),
    };
    state.nextSyncEventSequence += 1;
    state.syncEvents.push(stored);
    const limit = this.options.syncEventLimit ?? 200;
    if (state.syncEvents.length > limit) state.syncEvents.splice(0, state.syncEvents.length - limit);
  }

  private acceptsMessageEpoch(state: RoomNetState, message: { epoch: number }): boolean {
    return message.epoch === state.epoch;
  }

  private trimChecksumHistory(state: RoomNetState, latestTick: number): void {
    const limit = this.options.frameHistoryLimit ?? DEFAULT_ROOM_FRAME_HISTORY_LIMIT;
    const oldestTick = latestTick - limit + 1;
    for (const tick of state.authoritativeChecksums.keys()) {
      if (tick < oldestTick) state.authoritativeChecksums.delete(tick);
    }
    state.coordinator.discardChecksumsBefore(oldestTick);
    for (const key of state.desyncReports) {
      const tick = Number(key.split(":", 1)[0]);
      if (Number.isFinite(tick) && tick < oldestTick) state.desyncReports.delete(key);
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function zeroKindCounts(): Record<RoomSyncEventKind, number> {
  return {
    "frame-apply-error": 0,
    "server-desync": 0,
    "message-error": 0,
    "checkpoint-restore": 0,
    "checkpoint-request": 0,
    "checksum-mismatch": 0,
  };
}

function zeroCheckpointClassCounts(): Record<CheckpointRequestClass, number> {
  return { initial: 0, catchup: 0, manual: 0, recovery: 0 };
}
