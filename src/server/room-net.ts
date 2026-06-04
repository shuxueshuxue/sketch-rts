import { decodeClientNetMessage, encodeNetMessage } from "../shared/net/codec";
import type { ClientNetMessage, CommandFrame, ServerNetMessage } from "../shared/net/types";
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

  tickRoom(roomId: string): CommandFrame {
    const state = this.stateFor(roomId);
    const snapshot = this.options.roomHost.snapshot(roomId);
    state.spectatorSync.recordCheckpoint(this.options.roomHost.checkpointRoom(roomId));
    const frame = state.coordinator.buildFrame(snapshot.tick);
    const result = this.options.roomHost.tickRoomFrame(roomId, frame, "browser");
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
      this.send(socket, { type: "hello", roomId: message.roomId, playerId: message.playerId, tick: this.options.roomHost.snapshot(message.roomId).tick });
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
    this.stateFor(message.roomId).coordinator.acceptCommand({
      currentTick: snapshot.tick,
      playerId: message.playerId,
      command: message.command,
      ...(message.clientSeq !== undefined ? { clientSeq: message.clientSeq } : {}),
    });
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
    const encoded = encodeNetMessage(message);
    for (const socket of this.stateFor(roomId).sockets) socket.send(encoded);
  }

  private send(socket: RoomNetSocket, message: ServerNetMessage): void {
    socket.send(encodeNetMessage(message));
  }

  private sendCheckpointWithFrames(socket: RoomNetSocket, roomId: string, requestedTick: number | undefined): void {
    const state = this.stateFor(roomId);
    const checkpoint = requestedTick === undefined ? this.options.roomHost.checkpointRoom(roomId) : state.spectatorSync.checkpointAtOrBefore(requestedTick) ?? this.options.roomHost.checkpointRoom(roomId);
    this.send(socket, { type: "checkpoint", checkpoint });
    for (const frame of state.spectatorSync.framesFrom(checkpoint.tick)) {
      this.send(socket, { type: "frame", frame });
    }
  }
}
