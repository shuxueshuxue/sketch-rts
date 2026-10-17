import { createAiRuntime, type AiThinkExecutorFactory } from "../../ai/runtime";
import { createChatMessage } from "../../shared/chat";
import type { ChatMessage } from "../../shared/net/types";
import { assertCreateRoomInput, parseMapUpdateRequest, parseSlotCountsRequest, parseSlotPatch } from "../../shared/room-schema";
import { createRoomLifecycleHost, liveRoomToGameSetup } from "../../shared/room-lifecycle";
import { hostActionRefusal, seatEditRefusal, type CreateRoomInput, type SlotPatch } from "../../shared/rooms";
import { createGame, snapshotGame, warmGameCaches } from "../../shared/sim";
import type { GameSetupOptions, LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";
import { EmptyGameAdapter } from "../game-adapter";
import { MatchThreadGameAdapter } from "../match-worker/adapter";
import type { MatchThreadFactory } from "../match-worker/browser";
import { LocalGameAdapter, type LocalGameAdapterOptions } from "../net/local-adapter";
import type { DeploymentRuntime, MatchChat, StartedMatch } from "./runtime";

export type StaticSoloDeploymentRuntimeOptions = {
  now?: () => number;
  tickMs?: number;
  // Threads for a local match (see @@@match-thread); without them it runs on the page's thread.
  matchThreads?: MatchThreadFactory;
  // Where a page-thread match's AI thinks (see @@@think-thread); on the page's thread when absent.
  aiThinkExecutor?: AiThinkExecutorFactory;
  onRuntimeReady?: () => void;
  onRuntimeError?: (message: string) => void;
};

type LocalMatchAdapter = LocalGameAdapter | MatchThreadGameAdapter;

export class StaticSoloDeploymentRuntime implements DeploymentRuntime {
  readonly kind = "static" as const;
  private readonly lifecycle = createRoomLifecycleHost();
  private readonly matches = new Map<string, { adapter: LocalMatchAdapter; onRoom: (room: RoomState) => void }>();
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

  // A room in this browser keys nobody (there is nobody else in it); it checks the same lobby rules (see @@@seat-ownership).
  async updateRoomMap(roomId: string, mapId: MapId, user: LocalUserProfile): Promise<RoomState> {
    const input = parseMapUpdateRequest({ mapId });
    if (!input) throw new Error("Malformed room map input");
    this.hostOnly(roomId, user);
    return this.lifecycle.updateMap(roomId, input.mapId);
  }

  async updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch, user: LocalUserProfile): Promise<RoomState> {
    const input = parseSlotPatch(patch);
    if (!input) throw new Error("Malformed slot patch");
    const refusal = seatEditRefusal(this.lifecycle.getRoom(roomId), user.id, slotId, input);
    if (refusal) throw new Error(refusal);
    return this.lifecycle.updateSlot(roomId, slotId, input);
  }

  async updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number, user: LocalUserProfile): Promise<RoomState> {
    const input = parseSlotCountsRequest({ humanCount, aiCount });
    if (!input) throw new Error("Malformed room slot count input");
    this.hostOnly(roomId, user);
    return this.lifecycle.resizeSlots(roomId, input.humanCount, input.aiCount);
  }

  private hostOnly(roomId: string, user: LocalUserProfile) {
    const refusal = hostActionRefusal(this.lifecycle.getRoom(roomId), user.id);
    if (refusal) throw new Error(refusal);
  }

  watchRoom(_roomId: string, _onRoom: (room: RoomState) => void): () => void {
    return () => {};
  }

  async closeRoom(roomId: string, user: LocalUserProfile): Promise<RoomState> {
    return this.lifecycle.closeRoom(roomId, user.id);
  }

  async startRoom(roomId: string, user: LocalUserProfile, onRoom: (room: RoomState) => void = () => {}): Promise<StartedMatch> {
    this.hostOnly(roomId, user);
    const setup = this.lifecycle.prepareStartRoom(roomId);
    const slot = setup.playerSlots.find((candidate) => candidate.userId === user.id);
    const playerId = slot?.playerId ?? "player";
    const { room } = this.lifecycle.startRoom(roomId);
    return this.playLocally(room, playerId, setup, onRoom);
  }

  connectRoom(room: RoomState, playerId: PlayerId, _spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch {
    if (room.status !== "inMatch") throw new Error(`Room ${room.id} is not in a live match`);
    if (!this.lifecycle.hasRoom(room.id)) throw new Error(`Unknown room ${room.id}`);
    this.matches.get(room.id)?.adapter.close();
    return this.playLocally(room, playerId, liveRoomToGameSetup(room), onRoom);
  }

  private playLocally(room: RoomState, playerId: PlayerId, setup: { mapId: MapId; options: GameSetupOptions }, onRoom: (room: RoomState) => void): StartedMatch {
    const game = createGame(setup.mapId, setup.options);
    const aiPlayers = setup.options.aiPlayers ?? [];
    let adapter: LocalMatchAdapter;
    const onClose = () => { if (this.matches.get(room.id)?.adapter === adapter) this.matches.delete(room.id); };
    const ended = (finished: RoomState) => {
      adapter.close();
      onRoom(finished);
    };
    if (this.options.matchThreads) {
      // The match runs on its own thread and the page only draws it (see @@@match-thread).
      const threads = this.options.matchThreads({ ai: aiPlayers.length > 0 });
      adapter = new MatchThreadGameAdapter(threads.port, {
        type: "local", room, playerId, mapId: setup.mapId, options: setup.options, aiPlayers,
        ...(setup.options.aiVersions ? { aiVersions: setup.options.aiVersions } : {}),
        ...(this.options.tickMs === undefined ? {} : { tickMs: this.options.tickMs }),
        now: this.options.now?.() ?? performance.now(),
        ...(threads.aiPort ? { aiPort: threads.aiPort } : {}),
      }, snapshotGame(game), {
        playerId,
        checkCommands: true,
        ...(this.options.now ? { now: this.options.now } : {}),
        onEnded: (snapshot) => ended(this.lifecycle.finishRoom(room.id, snapshot)),
        ...(this.options.onRuntimeError ? { onError: this.options.onRuntimeError } : {}),
        onClose: () => { threads.terminate(); onClose(); },
      }, threads.aiPort ? [threads.aiPort] : []);
    } else {
      // The match ticks here, so its derived navigation is built here, before its first tick.
      warmGameCaches(game);
      adapter = new LocalGameAdapter(game, playerId, this.localAdapterOptions({
        aiRuntime: createAiRuntime(aiPlayers, setup.options.aiVersions ? { versions: setup.options.aiVersions } : {}),
        room,
        finishRoom: (snapshot) => this.lifecycle.finishRoom(room.id, snapshot),
        onClose,
        onRoomEnded: ended,
      }));
    }
    this.matches.set(room.id, { adapter, onRoom });
    return { room, playerId, adapter, chat: createLocalChat(room.id, playerId, this.options.now), snapshot: adapter.currentSnapshot() };
  }

  canForfeitMatch(_roomId: string): boolean {
    return true;
  }

  isLocalRoom(roomId: string): boolean {
    return this.lifecycle.hasRoom(roomId);
  }

  async forfeitMatch(roomId: string, user: LocalUserProfile): Promise<RoomState> {
    const room = this.lifecycle.getRoom(roomId);
    const match = this.matches.get(roomId);
    if (!match) throw new Error(`Room ${roomId} is not in a local match`);
    const loser = room.slots.find((slot) => slot.userId === user.id)?.playerId;
    const winner = room.slots.find((slot) => (slot.controller === "human" || slot.controller === "ai") && slot.playerId !== loser)?.playerId ?? null;
    const snapshot = match.adapter.currentSnapshot();
    const ended = this.lifecycle.finishRoom(roomId, { ...snapshot, match: { ...snapshot.match, winner, endedAtTick: snapshot.tick } });
    match.adapter.close();
    match.onRoom(ended);
    return ended;
  }

  close(): void {
    for (const match of this.matches.values()) match.adapter.close();
    this.matches.clear();
  }

  private localAdapterOptions(options: LocalGameAdapterOptions): LocalGameAdapterOptions {
    return {
      ...options,
      ...(this.options.tickMs === undefined ? {} : { tickMs: this.options.tickMs }),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
      ...(this.options.aiThinkExecutor === undefined ? {} : { aiThinkExecutor: this.options.aiThinkExecutor }),
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
