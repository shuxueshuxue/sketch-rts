import { decodeClientNetMessage, encodeNetMessage } from "../shared/net/codec";
import type { ClientNetMessage, CommandFrame, ServerNetMessage } from "../shared/net/types";
import { commandValidationError } from "../shared/sim/command-validation";
import type { PlayerId } from "../shared/types";
import { LockstepRoomCoordinator } from "./lockstep-room";
import type { createRoomHost } from "./room-host";
import { SpectatorSyncLog } from "./spectator-sync";

export type RoomNetSocket = {
  send(data: string): void;
  on(event: "message" | "close", handler: ((raw: string) => void) | (() => void)): void;
};

export type RoomNetHubOptions = {
  roomHost: ReturnType<typeof createRoomHost>;
  commandDelayTicks?: number;
  frameHistoryLimit?: number;
};

type RoomNetState = {
  coordinator: LockstepRoomCoordinator;
  sockets: Set<RoomNetSocket>;
  spectatorSync: SpectatorSyncLog;
};

export class RoomNetHub {
  private rooms = new Map<string, RoomNetState>();

  constructor(private readonly options: RoomNetHubOptions) {}

  connect(roomId: string, socket: RoomNetSocket): void {
    const state = this.stateFor(roomId);
    state.sockets.add(socket);
    socket.on("message", (raw) => this.receive(roomId, socket, String(raw)));
    socket.on("close", () => state.sockets.delete(socket));
  }

  tickRoom(roomId: string): CommandFrame | undefined {
    const state = this.stateFor(roomId);
    const snapshot = this.options.roomHost.snapshot(roomId);
    state.spectatorSync.recordCheckpoint(this.options.roomHost.checkpointRoom(roomId));
    const frame = state.coordinator.buildFrame(snapshot.tick);
    const result = this.tryTickRoomFrame(roomId, frame);
    if (!result) return undefined;
    state.spectatorSync.recordFrame(result.frame);
    this.broadcast(roomId, { type: "frame", frame: result.frame });
    if (result.room.status === "ended") this.broadcast(roomId, { type: "room", room: result.room });
    return result.frame;
  }

  tickConnectedRooms(): Set<string> {
    const ticked = new Set<string>();
    for (const [roomId, state] of this.rooms.entries()) {
      if (state.sockets.size === 0) continue;
      this.tickRoom(roomId);
      ticked.add(roomId);
    }
    return ticked;
  }

  checksumsForTick(roomId: string, tick: number): Record<PlayerId, string> {
    return this.stateFor(roomId).coordinator.checksumsForTick(tick);
  }

  private receive(socketRoomId: string, socket: RoomNetSocket, raw: string): void {
    const message = decodeClientNetMessage(raw);
    if (message.roomId !== socketRoomId) throw new Error(`Client message room ${message.roomId} does not match socket room ${socketRoomId}`);
    if (message.type === "join") {
      this.send(message.roomId, socket, { type: "hello", roomId: message.roomId, playerId: message.playerId, tick: this.options.roomHost.snapshot(message.roomId).tick });
      return;
    }
    if (message.type === "command") {
      this.acceptCommand(message);
      return;
    }
    if (message.type === "checksum") {
      this.stateFor(message.roomId).coordinator.recordChecksum(message);
      return;
    }
    if (message.type === "requestCheckpoint") {
      this.sendCheckpointWithFrames(socket, message.roomId, message.tick);
    }
  }

  private acceptCommand(message: Extract<ClientNetMessage, { type: "command" }>): void {
    const snapshot = this.options.roomHost.snapshot(message.roomId);
    const error = commandValidationError(snapshot, message.playerId, message.command);
    if (error) {
      this.broadcast(message.roomId, { type: "error", roomId: message.roomId, message: error });
      return;
    }
    this.stateFor(message.roomId).coordinator.acceptCommand({
      currentTick: snapshot.tick,
      playerId: message.playerId,
      command: message.command,
      ...(message.clientSeq !== undefined ? { clientSeq: message.clientSeq } : {}),
    });
  }

  private tryTickRoomFrame(roomId: string, frame: CommandFrame): ReturnType<RoomNetHubOptions["roomHost"]["tickRoomFrame"]> | undefined {
    try {
      return this.options.roomHost.tickRoomFrame(roomId, frame, "browser");
    } catch (error) {
      // @@@lockstep-command-error - Sim commands still fail loudly; the room network edge translates them so one invalid client command cannot kill the server ticker.
      this.broadcast(roomId, { type: "error", roomId, message: errorMessage(error) });
      return undefined;
    }
  }

  private stateFor(roomId: string): RoomNetState {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const created = {
      coordinator: new LockstepRoomCoordinator({ roomId, ...(this.options.commandDelayTicks !== undefined ? { commandDelayTicks: this.options.commandDelayTicks } : {}) }),
      sockets: new Set<RoomNetSocket>(),
      spectatorSync: new SpectatorSyncLog({ ...(this.options.frameHistoryLimit !== undefined ? { frameHistoryLimit: this.options.frameHistoryLimit } : {}) }),
    };
    this.rooms.set(roomId, created);
    return created;
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

  private sendCheckpointWithFrames(socket: RoomNetSocket, roomId: string, requestedTick: number | undefined): void {
    const state = this.stateFor(roomId);
    const checkpoint = requestedTick === undefined ? this.options.roomHost.checkpointRoom(roomId) : state.spectatorSync.checkpointAtOrBefore(requestedTick) ?? this.options.roomHost.checkpointRoom(roomId);
    if (!this.send(roomId, socket, { type: "checkpoint", checkpoint })) return;
    for (const frame of state.spectatorSync.framesFrom(checkpoint.tick)) {
      if (!this.send(roomId, socket, { type: "frame", frame })) return;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
