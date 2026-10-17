import type { GameAdapter } from "../game-adapter";
import type { DeploymentMode } from "./mode";
import { ServerDeploymentRuntime, type ServerDeploymentRuntimeOptions } from "./server-runtime";
import { StaticSoloDeploymentRuntime, type StaticSoloDeploymentRuntimeOptions } from "./static-runtime";
import type { CreateRoomInput, SlotPatch } from "../../shared/rooms";
import type { ChatMessage } from "../../shared/net/types";
import type { GameSnapshot, LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";

export type MatchChat = {
  send(text: string, senderName: string): void;
  onMessage(handler: (message: ChatMessage) => void): () => void;
};

export type StartedMatch = {
  room: RoomState;
  playerId: PlayerId;
  adapter: GameAdapter;
  chat: MatchChat;
  snapshot: GameSnapshot;
};

export type DeploymentRuntime = {
  readonly kind: "server" | "static";
  initialAdapter(): GameAdapter;
  listRooms(viewerUserId?: string): Promise<RoomState[]>;
  createRoom(input: CreateRoomInput): Promise<RoomState>;
  getRoom(roomId: string): Promise<RoomState>;
  /** The room, or undefined when there is no such room (closed and gone, or never made). */
  findRoom(roomId: string): Promise<RoomState | undefined>;
  enterRoom(roomId: string, user: LocalUserProfile): Promise<{ room: RoomState; spectating: boolean; playerId: PlayerId }>;
  // Lobby changes are asked as a user, whom the room checks (see @@@seat-ownership).
  updateRoomMap(roomId: string, mapId: MapId, user: LocalUserProfile): Promise<RoomState>;
  updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch, user: LocalUserProfile): Promise<RoomState>;
  updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number, user: LocalUserProfile): Promise<RoomState>;
  /** Watches a room's lobby as this user: the server lists an open room only while its host watches it. */
  watchRoom(roomId: string, user: LocalUserProfile, onRoom: (room: RoomState) => void): () => void;
  closeRoom(roomId: string, user: LocalUserProfile): Promise<RoomState>;
  startRoom(roomId: string, user: LocalUserProfile, onRoom?: (room: RoomState) => void): Promise<StartedMatch>;
  connectRoom(room: RoomState, playerId: PlayerId, spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch;
  canForfeitMatch(roomId: string): boolean;
  /** Concedes the match; its end reaches the page through the room's own updates. */
  forfeitMatch(roomId: string, user: LocalUserProfile): Promise<void>;
  // Whether the room is played in this browser (see @@@private-rooms-local): nobody else can come into it.
  isLocalRoom(roomId: string): boolean;
  close(): void;
};

export type DeploymentRuntimeOptions = ServerDeploymentRuntimeOptions & StaticSoloDeploymentRuntimeOptions;

export function createDeploymentRuntime(mode: DeploymentMode, options: DeploymentRuntimeOptions = {}): DeploymentRuntime {
  if (mode === "static") return new StaticSoloDeploymentRuntime(options);
  return new SplitDeploymentRuntime(new ServerDeploymentRuntime(options), new StaticSoloDeploymentRuntime(options));
}

// @@@private-rooms-local - In a server build a private room, a player against the computers and the create screen's
// default, is played in the player's own browser as a static build plays every room: no request to the server, no
// socket, the computers thinking on the player's machine. Only a public room, open to other people, lives on the
// server. Every call about a room goes where the room lives. Every match against the computers ran on the server.
export class SplitDeploymentRuntime implements DeploymentRuntime {
  readonly kind = "server" as const;

  constructor(
    private readonly server: ServerDeploymentRuntime,
    private readonly local: StaticSoloDeploymentRuntime,
  ) {}

  initialAdapter(): GameAdapter {
    return this.server.initialAdapter();
  }

  async listRooms(viewerUserId?: string): Promise<RoomState[]> {
    return [...(await this.local.listRooms(viewerUserId)), ...(await this.server.listRooms(viewerUserId))];
  }

  createRoom(input: CreateRoomInput): Promise<RoomState> {
    return input.visibility === "private" ? this.local.createRoom(input) : this.server.createRoom(input);
  }

  getRoom(roomId: string) {
    return this.at(roomId).getRoom(roomId);
  }

  findRoom(roomId: string) {
    return this.at(roomId).findRoom(roomId);
  }

  enterRoom(roomId: string, user: LocalUserProfile) {
    return this.at(roomId).enterRoom(roomId, user);
  }

  updateRoomMap(roomId: string, mapId: MapId, user: LocalUserProfile) {
    return this.at(roomId).updateRoomMap(roomId, mapId, user);
  }

  updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch, user: LocalUserProfile) {
    return this.at(roomId).updateRoomSlot(roomId, slotId, patch, user);
  }

  updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number, user: LocalUserProfile) {
    return this.at(roomId).updateRoomSlotCounts(roomId, humanCount, aiCount, user);
  }

  watchRoom(roomId: string, user: LocalUserProfile, onRoom: (room: RoomState) => void) {
    return this.at(roomId).watchRoom(roomId, user, onRoom);
  }

  closeRoom(roomId: string, user: LocalUserProfile) {
    return this.at(roomId).closeRoom(roomId, user);
  }

  startRoom(roomId: string, user: LocalUserProfile, onRoom?: (room: RoomState) => void) {
    return this.at(roomId).startRoom(roomId, user, onRoom);
  }

  connectRoom(room: RoomState, playerId: PlayerId, spectating: boolean, onRoom: (room: RoomState) => void) {
    return this.at(room.id).connectRoom(room, playerId, spectating, onRoom);
  }

  canForfeitMatch(roomId: string) {
    return this.at(roomId).canForfeitMatch(roomId);
  }

  forfeitMatch(roomId: string, user: LocalUserProfile) {
    return this.at(roomId).forfeitMatch(roomId, user);
  }

  isLocalRoom(roomId: string) {
    return this.local.isLocalRoom(roomId);
  }

  close(): void {
    this.local.close();
    this.server.close();
  }

  private at(roomId: string): DeploymentRuntime {
    return this.local.isLocalRoom(roomId) ? this.local : this.server;
  }
}
