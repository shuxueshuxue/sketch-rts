import { createAiRuntime } from "../../ai/runtime";
import type { ChatMessage } from "../../shared/net/types";
import { createRoom, finishRoom, joinFirstOpenSlot, lobbyVisibleRooms, resizeRoomSlots, roomToGameSetup, updateRoomMap, updateRoomSlot, type CreateRoomInput, type SlotPatch } from "../../shared/rooms";
import { createGame } from "../../shared/sim";
import type { LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";
import { EmptyGameAdapter } from "../game-adapter";
import { LocalGameAdapter, type LocalGameAdapterOptions } from "../net/local-adapter";
import type { DeploymentRuntime, MatchChat, StartedMatch } from "./runtime";

export type StaticSoloDeploymentRuntimeOptions = {
  now?: () => number;
  tickMs?: number;
  onSessionOpen?: () => void;
};

export class StaticSoloDeploymentRuntime implements DeploymentRuntime {
  readonly kind = "static" as const;
  private readonly rooms = new Map<string, RoomState>();
  private readonly matches = new Map<string, { adapter: LocalGameAdapter; onRoom: (room: RoomState) => void }>();
  private readonly emptyAdapter = new EmptyGameAdapter();

  constructor(private readonly options: StaticSoloDeploymentRuntimeOptions = {}) {}

  initialAdapter() {
    this.options.onSessionOpen?.();
    return this.emptyAdapter;
  }

  async listRooms(viewerUserId?: string): Promise<RoomState[]> {
    return lobbyVisibleRooms([...this.rooms.values()], viewerUserId);
  }

  async createRoom(input: CreateRoomInput): Promise<RoomState> {
    if (this.rooms.has(input.id)) throw new Error(`Room ${input.id} already exists`);
    const room = createRoom(input);
    this.rooms.set(room.id, room);
    return room;
  }

  async getRoom(roomId: string): Promise<RoomState> {
    return this.requireRoom(roomId);
  }

  async enterRoom(roomId: string, user: LocalUserProfile): Promise<{ room: RoomState; spectating: boolean; playerId: PlayerId }> {
    let room = this.requireRoom(roomId);
    if (room.status === "open") {
      room = joinFirstOpenSlot(room, user);
      this.rooms.set(room.id, room);
    }
    const slot = room.slots.find((candidate) => candidate.userId === user.id);
    return { room, spectating: room.status === "inMatch" && !slot, playerId: slot?.playerId ?? "player" };
  }

  async updateRoomMap(roomId: string, mapId: MapId): Promise<RoomState> {
    return this.replaceRoom(updateRoomMap(this.requireRoom(roomId), mapId));
  }

  async updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch): Promise<RoomState> {
    return this.replaceRoom(updateRoomSlot(this.requireRoom(roomId), slotId, patch));
  }

  async updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number): Promise<RoomState> {
    return this.replaceRoom(resizeRoomSlots(this.requireRoom(roomId), humanCount, aiCount));
  }

  async closeRoom(roomId: string, userId: string): Promise<RoomState> {
    const room = this.requireRoom(roomId);
    if (room.hostUserId !== userId) throw new Error("Only the room host can close this room");
    this.rooms.delete(roomId);
    return { ...room, status: "closed" };
  }

  async startRoom(roomId: string, user: LocalUserProfile, onRoom: (room: RoomState) => void = () => {}): Promise<StartedMatch> {
    const room = this.replaceRoom({ ...this.requireRoom(roomId), status: "inMatch" });
    const setup = roomToGameSetup({ ...room, status: "open" });
    const slot = setup.playerSlots.find((candidate) => candidate.userId === user.id);
    const playerId = slot?.playerId ?? "player";
    const game = createGame(setup.mapId, setup.options);
    const aiRuntime = createAiRuntime(setup.options.aiPlayers ?? [], setup.options.aiVersions ? { versions: setup.options.aiVersions } : {});
    const adapter = new LocalGameAdapter(game, playerId, this.localAdapterOptions({
      aiRuntime,
      room,
      onRoomEnded: (ended) => {
        this.replaceRoom(ended);
        onRoom(ended);
      },
    }));
    this.matches.set(room.id, { adapter, onRoom });
    return { room, playerId, adapter, chat: createLocalChat(room.id, playerId), snapshot: adapter.currentSnapshot() };
  }

  connectRoom(room: RoomState, playerId: PlayerId, _spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch {
    if (room.status !== "inMatch") throw new Error(`Room ${room.id} is not in a live match`);
    const setup = roomToGameSetup({ ...room, status: "open" });
    const game = createGame(setup.mapId, setup.options);
    const aiRuntime = createAiRuntime(setup.options.aiPlayers ?? [], setup.options.aiVersions ? { versions: setup.options.aiVersions } : {});
    const adapter = new LocalGameAdapter(game, playerId, this.localAdapterOptions({
      aiRuntime,
      room,
      onRoomEnded: (ended) => {
        this.replaceRoom(ended);
        onRoom(ended);
      },
    }));
    this.matches.set(room.id, { adapter, onRoom });
    return { room, playerId, adapter, chat: createLocalChat(room.id, playerId), snapshot: adapter.currentSnapshot() };
  }

  canForfeitMatch(): boolean {
    return true;
  }

  async forfeitMatch(roomId: string, user: LocalUserProfile): Promise<RoomState> {
    const room = this.requireRoom(roomId);
    const match = this.matches.get(roomId);
    if (!match) throw new Error(`Room ${roomId} is not in a local match`);
    const loser = room.slots.find((slot) => slot.userId === user.id)?.playerId;
    const winner = room.slots.find((slot) => (slot.controller === "human" || slot.controller === "ai") && slot.playerId !== loser)?.playerId ?? null;
    const snapshot = match.adapter.currentSnapshot();
    const ended = this.replaceRoom(finishRoom(room, { ...snapshot, match: { ...snapshot.match, winner, endedAtTick: snapshot.tick } }));
    this.matches.delete(roomId);
    match.onRoom(ended);
    return ended;
  }

  close(): void {}

  private requireRoom(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Unknown room ${roomId}`);
    return room;
  }

  private replaceRoom(room: RoomState): RoomState {
    this.rooms.set(room.id, room);
    return room;
  }

  private localAdapterOptions(options: LocalGameAdapterOptions): LocalGameAdapterOptions {
    return {
      ...options,
      ...(this.options.tickMs === undefined ? {} : { tickMs: this.options.tickMs }),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    };
  }
}

function createLocalChat(roomId: string, playerId: PlayerId): MatchChat {
  const handlers = new Set<(message: ChatMessage) => void>();
  let nextSequence = 1;
  return {
    send(text, senderName) {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("Chat message cannot be empty");
      const message: ChatMessage = { id: `chat-${roomId}-${nextSequence}`, roomId, playerId, senderName, text: trimmed, sentAt: Date.now() };
      nextSequence += 1;
      for (const handler of [...handlers]) handler(message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
