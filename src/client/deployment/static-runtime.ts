import { createAiRuntime } from "../../ai/runtime";
import { createChatMessage } from "../../shared/chat";
import type { ChatMessage } from "../../shared/net/types";
import { assertCreateRoomInput, parseMapUpdateRequest, parseSlotCountsRequest, parseSlotPatch } from "../../shared/room-schema";
import { createRoomLifecycleHost, liveRoomToGameSetup } from "../../shared/room-lifecycle";
import type { CreateRoomInput, SlotPatch } from "../../shared/rooms";
import { createGame } from "../../shared/sim";
import type { LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";
import { EmptyGameAdapter } from "../game-adapter";
import { LocalGameAdapter, type LocalGameAdapterOptions } from "../net/local-adapter";
import type { DeploymentRuntime, MatchChat, StartedMatch } from "./runtime";

export type StaticSoloDeploymentRuntimeOptions = {
  now?: () => number;
  tickMs?: number;
  onRuntimeReady?: () => void;
};

export class StaticSoloDeploymentRuntime implements DeploymentRuntime {
  readonly kind = "static" as const;
  private readonly lifecycle = createRoomLifecycleHost();
  private readonly matches = new Map<string, { adapter: LocalGameAdapter; onRoom: (room: RoomState) => void }>();
  private readonly emptyAdapter = new EmptyGameAdapter();

  constructor(private readonly options: StaticSoloDeploymentRuntimeOptions = {}) {}

  initialAdapter() {
    this.options.onRuntimeReady?.();
    return this.emptyAdapter;
  }

  async listRooms(viewerUserId?: string): Promise<RoomState[]> {
    return this.lifecycle.listRooms(viewerUserId);
  }

  async createRoom(input: CreateRoomInput): Promise<RoomState> {
    const parsed = assertCreateRoomInput(input);
    return this.lifecycle.createRoom(parsed);
  }

  async getRoom(roomId: string): Promise<RoomState> {
    return this.lifecycle.getRoom(roomId);
  }

  async enterRoom(roomId: string, user: LocalUserProfile): Promise<{ room: RoomState; spectating: boolean; playerId: PlayerId }> {
    let room = this.lifecycle.getRoom(roomId);
    if (room.status === "open") {
      room = this.lifecycle.joinRoom(roomId, user);
    }
    const slot = room.slots.find((candidate) => candidate.userId === user.id);
    return { room, spectating: room.status === "inMatch" && !slot, playerId: slot?.playerId ?? "player" };
  }

  async updateRoomMap(roomId: string, mapId: MapId): Promise<RoomState> {
    const input = parseMapUpdateRequest({ mapId });
    if (!input) throw new Error("Malformed room map input");
    return this.lifecycle.updateMap(roomId, input.mapId);
  }

  async updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch): Promise<RoomState> {
    const input = parseSlotPatch(patch);
    if (!input) throw new Error("Malformed slot patch");
    return this.lifecycle.updateSlot(roomId, slotId, input);
  }

  async updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number): Promise<RoomState> {
    const input = parseSlotCountsRequest({ humanCount, aiCount });
    if (!input) throw new Error("Malformed room slot count input");
    return this.lifecycle.resizeSlots(roomId, input.humanCount, input.aiCount);
  }

  async closeRoom(roomId: string, userId: string): Promise<RoomState> {
    return this.lifecycle.closeRoom(roomId, userId);
  }

  async startRoom(roomId: string, user: LocalUserProfile, onRoom: (room: RoomState) => void = () => {}): Promise<StartedMatch> {
    const setup = this.lifecycle.prepareStartRoom(roomId);
    const slot = setup.playerSlots.find((candidate) => candidate.userId === user.id);
    const playerId = slot?.playerId ?? "player";
    const game = createGame(setup.mapId, setup.options);
    const aiRuntime = createAiRuntime(setup.options.aiPlayers ?? [], setup.options.aiVersions ? { versions: setup.options.aiVersions } : {});
    const { room } = this.lifecycle.startRoom(roomId);
    const adapter = new LocalGameAdapter(game, playerId, this.localAdapterOptions({
      aiRuntime,
      room,
      finishRoom: (snapshot) => this.lifecycle.finishRoom(room.id, snapshot),
      onRoomEnded: (ended) => {
        onRoom(ended);
      },
    }));
    this.matches.set(room.id, { adapter, onRoom });
    return { room, playerId, adapter, chat: createLocalChat(room.id, playerId, this.options.now), snapshot: adapter.currentSnapshot() };
  }

  connectRoom(room: RoomState, playerId: PlayerId, _spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch {
    if (room.status !== "inMatch") throw new Error(`Room ${room.id} is not in a live match`);
    if (!this.lifecycle.hasRoom(room.id)) throw new Error(`Unknown room ${room.id}`);
    const setup = liveRoomToGameSetup(room);
    const game = createGame(setup.mapId, setup.options);
    const aiRuntime = createAiRuntime(setup.options.aiPlayers ?? [], setup.options.aiVersions ? { versions: setup.options.aiVersions } : {});
    const adapter = new LocalGameAdapter(game, playerId, this.localAdapterOptions({
      aiRuntime,
      room,
      finishRoom: (snapshot) => this.lifecycle.finishRoom(room.id, snapshot),
      onRoomEnded: (ended) => {
        onRoom(ended);
      },
    }));
    this.matches.set(room.id, { adapter, onRoom });
    return { room, playerId, adapter, chat: createLocalChat(room.id, playerId, this.options.now), snapshot: adapter.currentSnapshot() };
  }

  canForfeitMatch(): boolean {
    return true;
  }

  async forfeitMatch(roomId: string, user: LocalUserProfile): Promise<RoomState> {
    const room = this.lifecycle.getRoom(roomId);
    const match = this.matches.get(roomId);
    if (!match) throw new Error(`Room ${roomId} is not in a local match`);
    const loser = room.slots.find((slot) => slot.userId === user.id)?.playerId;
    const winner = room.slots.find((slot) => (slot.controller === "human" || slot.controller === "ai") && slot.playerId !== loser)?.playerId ?? null;
    const snapshot = match.adapter.currentSnapshot();
    const ended = this.lifecycle.finishRoom(roomId, { ...snapshot, match: { ...snapshot.match, winner, endedAtTick: snapshot.tick } });
    this.matches.delete(roomId);
    match.onRoom(ended);
    return ended;
  }

  close(): void {}

  private localAdapterOptions(options: LocalGameAdapterOptions): LocalGameAdapterOptions {
    return {
      ...options,
      ...(this.options.tickMs === undefined ? {} : { tickMs: this.options.tickMs }),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    };
  }
}

function createLocalChat(roomId: string, playerId: PlayerId, now: (() => number) | undefined): MatchChat {
  const handlers = new Set<(message: ChatMessage) => void>();
  let nextSequence = 1;
  return {
    send(text, senderName) {
      const message = createChatMessage({ roomId, playerId, senderName, text, sequence: nextSequence, sentAt: now?.() ?? Date.now() });
      nextSequence += 1;
      for (const handler of [...handlers]) handler(message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
