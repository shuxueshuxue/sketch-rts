import { createGame } from "../../shared/sim";
import { SimulationEngine } from "../../shared/sim/engine";
import type { ChatMessage, ServerNetMessage } from "../../shared/net/types";
import { roomToGameSetup, type CreateRoomInput, type SlotPatch } from "../../shared/rooms";
import type { LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";
import { EmptyGameAdapter, LockstepRoomGameAdapter, type GameAdapter } from "../game-adapter";
import { LockstepClient } from "../net/lockstep-client";
import type { NetTransport } from "../net/transport";
import { WebSocketTransport } from "../net/websocket-transport";
import type { DeploymentRuntime, MatchChat, StartedMatch } from "./runtime";

export type RoomTransport = NetTransport & {
  onOpen?(handler: () => void): void;
};

export type ServerDeploymentRuntimeOptions = {
  fetchJson?: <T>(path: string, body?: unknown) => Promise<T>;
  createRoomTransport?: (roomId: string) => RoomTransport;
  onRuntimeError?: (message: string) => void;
};

export class ServerDeploymentRuntime implements DeploymentRuntime {
  readonly kind = "server" as const;
  private readonly fetchJson: <T>(path: string, body?: unknown) => Promise<T>;
  private readonly createRoomTransport: (roomId: string) => RoomTransport;
  private readonly onRuntimeError: ((message: string) => void) | undefined;
  private readonly emptyAdapter = new EmptyGameAdapter();

  constructor(options: ServerDeploymentRuntimeOptions = {}) {
    this.fetchJson = options.fetchJson ?? requestJson;
    this.createRoomTransport = options.createRoomTransport ?? createDefaultRoomTransport;
    this.onRuntimeError = options.onRuntimeError;
  }

  initialAdapter(): GameAdapter {
    return this.emptyAdapter;
  }

  async listRooms(viewerUserId?: string): Promise<RoomState[]> {
    const query = viewerUserId ? `?userId=${encodeURIComponent(viewerUserId)}` : "";
    const result = await this.fetchJson<{ rooms: RoomState[] }>(`/api/rooms${query}`);
    return result.rooms;
  }

  async createRoom(input: CreateRoomInput): Promise<RoomState> {
    return this.fetchJson<RoomState>("/api/rooms", input);
  }

  async getRoom(roomId: string): Promise<RoomState> {
    return this.fetchJson<RoomState>(`/api/rooms/${encodeURIComponent(roomId)}`);
  }

  async enterRoom(roomId: string, user: LocalUserProfile): Promise<{ room: RoomState; spectating: boolean; playerId: PlayerId }> {
    const existingRoom = await this.getRoom(roomId);
    const ownedSlot = slotForUser(existingRoom, user.id);
    const room = existingRoom.status === "inMatch" && !ownedSlot ? existingRoom : await this.fetchJson<RoomState>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { user });
    const joinedSlot = slotForUser(room, user.id);
    const spectating = room.status === "inMatch" && !joinedSlot;
    return { room, spectating, playerId: joinedSlot?.playerId ?? (spectating ? `spectator-${user.id}` : "player") };
  }

  async updateRoomMap(roomId: string, mapId: MapId): Promise<RoomState> {
    return this.fetchJson<RoomState>(`/api/rooms/${encodeURIComponent(roomId)}/map`, { mapId });
  }

  async updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch): Promise<RoomState> {
    return this.fetchJson<RoomState>(`/api/rooms/${encodeURIComponent(roomId)}/slots/${encodeURIComponent(slotId)}`, patch);
  }

  async updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number): Promise<RoomState> {
    return this.fetchJson<RoomState>(`/api/rooms/${encodeURIComponent(roomId)}/slot-counts`, { humanCount, aiCount });
  }

  async closeRoom(roomId: string, userId: string): Promise<RoomState> {
    return this.fetchJson<RoomState>(`/api/rooms/${encodeURIComponent(roomId)}/close`, { userId });
  }

  async startRoom(roomId: string, user: LocalUserProfile, onRoom: (room: RoomState) => void = () => {}): Promise<StartedMatch> {
    const room = await this.fetchJson<RoomState>(`/api/rooms/${encodeURIComponent(roomId)}/start`, {});
    const playerId = slotForUser(room, user.id)?.playerId ?? "player";
    return this.connectRoom(room, playerId, false, onRoom);
  }

  connectRoom(room: RoomState, playerId: PlayerId, spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch {
    const setup = roomToGameSetup({ ...room, status: "open" });
    const game = createGame(setup.mapId, setup.options);
    const transport = this.createRoomTransport(room.id);
    const client = new LockstepClient({
      roomId: room.id,
      playerId,
      engine: new SimulationEngine(game),
      transport,
      ...(this.onRuntimeError ? { onError: this.onRuntimeError } : {}),
    });
    const adapter = new LockstepRoomGameAdapter(client, { spectating });
    const chat = createTransportChat(transport, room.id, playerId);
    transport.onMessage((message: ServerNetMessage) => {
      if (message.type === "room") onRoom(message.room);
    });
    const join = () => {
      client.join();
      client.requestCheckpoint("initial-sync");
    };
    if (transport.onOpen) transport.onOpen(join);
    else join();
    return { room, playerId, adapter, chat, snapshot: adapter.currentSnapshot() };
  }

  canForfeitMatch(): boolean {
    return false;
  }

  async forfeitMatch(_roomId: string, _user: LocalUserProfile): Promise<RoomState> {
    throw new Error("Forfeit is not available in server deployment mode");
  }

  close(): void {
    this.emptyAdapter.close();
  }
}

function createDefaultRoomTransport(roomId: string): RoomTransport {
  return WebSocketTransport.connect(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/rooms/${encodeURIComponent(roomId)}`);
}

async function requestJson<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method: "GET" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function slotForUser(room: RoomState, userId: string) {
  return room.slots.find((slot) => slot.userId === userId);
}

function createTransportChat(transport: RoomTransport, roomId: string, playerId: PlayerId): MatchChat {
  const handlers = new Set<(message: ChatMessage) => void>();
  transport.onMessage((message) => {
    if (message.type !== "chat") return;
    if (message.message.roomId !== roomId) return;
    for (const handler of [...handlers]) handler(message.message);
  });
  return {
    send(text, senderName) {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("Chat message cannot be empty");
      transport.send({ type: "chat", roomId, playerId, senderName, text: trimmed });
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
