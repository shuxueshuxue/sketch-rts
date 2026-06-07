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
  enterRoom(roomId: string, user: LocalUserProfile): Promise<{ room: RoomState; spectating: boolean; playerId: PlayerId }>;
  updateRoomMap(roomId: string, mapId: MapId): Promise<RoomState>;
  updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch): Promise<RoomState>;
  updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number): Promise<RoomState>;
  watchRoom(roomId: string, onRoom: (room: RoomState) => void): () => void;
  closeRoom(roomId: string, userId: string): Promise<RoomState>;
  startRoom(roomId: string, user: LocalUserProfile, onRoom?: (room: RoomState) => void): Promise<StartedMatch>;
  connectRoom(room: RoomState, playerId: PlayerId, spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch;
  canForfeitMatch(): boolean;
  forfeitMatch(roomId: string, user: LocalUserProfile): Promise<RoomState>;
  close(): void;
};

export type DeploymentRuntimeOptions = ServerDeploymentRuntimeOptions & StaticSoloDeploymentRuntimeOptions;

export function createDeploymentRuntime(mode: DeploymentMode, options: DeploymentRuntimeOptions = {}): DeploymentRuntime {
  if (mode === "static") return new StaticSoloDeploymentRuntime(options);
  return new ServerDeploymentRuntime(options);
}
