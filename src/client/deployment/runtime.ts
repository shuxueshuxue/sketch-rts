import type { GameAdapter } from "../game-adapter";
import type { CreateRoomInput, SlotPatch } from "../../shared/rooms";
import type { GameSnapshot, LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";

export type StartedMatch = {
  room: RoomState;
  playerId: PlayerId;
  adapter: GameAdapter;
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
  closeRoom(roomId: string, userId: string): Promise<RoomState>;
  startRoom(roomId: string, user: LocalUserProfile): Promise<StartedMatch>;
  connectRoom(room: RoomState, playerId: PlayerId, spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch;
  close(): void;
};
