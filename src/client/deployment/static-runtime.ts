import { createAiRuntime } from "../../ai/runtime";
import { createRoom, joinFirstOpenSlot, lobbyVisibleRooms, resizeRoomSlots, roomToGameSetup, updateRoomMap, updateRoomSlot, type CreateRoomInput, type SlotPatch } from "../../shared/rooms";
import { createGame } from "../../shared/sim";
import type { LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";
import { EmptyGameAdapter } from "../game-adapter";
import { LocalGameAdapter, type LocalGameAdapterOptions } from "../net/local-adapter";
import type { DeploymentRuntime, StartedMatch } from "./runtime";

export type StaticSoloDeploymentRuntimeOptions = {
  now?: () => number;
  tickMs?: number;
  onSessionOpen?: () => void;
};

export class StaticSoloDeploymentRuntime implements DeploymentRuntime {
  readonly kind = "static" as const;
  private readonly rooms = new Map<string, RoomState>();
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
    return { room, playerId, adapter, snapshot: adapter.currentSnapshot() };
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
    return { room, playerId, adapter, snapshot: adapter.currentSnapshot() };
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
