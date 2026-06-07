import {
  createGrandThirtyRoom as createGrandThirtyRoomState,
  createRoom as createRoomState,
  finishRoom as finishRoomState,
  joinFirstOpenSlot,
  leaveUserSlot,
  lobbyVisibleRooms,
  resizeRoomSlots,
  roomToGameSetup,
  updateRoomMap,
  updateRoomSlot,
  type CreateRoomInput,
  type GrandStressRoomOptions,
  type SlotPatch,
} from "./rooms";
import type { GameSnapshot, LocalUserProfile, MapId, RoomState } from "./types";

export type RoomLifecycleOptions = {
  defaultAutoTick?: boolean;
};

export type RoomStartResult = {
  room: RoomState;
  setup: ReturnType<typeof roomToGameSetup>;
};

export type RoomStartSetup = RoomStartResult["setup"];

export function liveRoomToGameSetup(room: RoomState): RoomStartSetup {
  if (room.status !== "inMatch") throw new Error(`Room ${room.id} is not in a live match`);
  return roomToGameSetup({ ...room, status: "open" });
}

export function createRoomLifecycleHost(options: RoomLifecycleOptions = {}) {
  const defaultAutoTick = options.defaultAutoTick ?? true;
  const rooms = new Map<string, RoomState>();

  function requireRoom(roomId: string): RoomState {
    const room = rooms.get(roomId);
    if (!room) throw new Error(`Unknown room ${roomId}`);
    return room;
  }

  function storeRoom(room: RoomState): RoomState {
    const stored = { ...room, autoTick: defaultAutoTick };
    rooms.set(stored.id, stored);
    return stored;
  }

  function replaceRoom(room: RoomState): RoomState {
    rooms.set(room.id, room);
    return room;
  }

  function addRoom(room: RoomState): RoomState {
    if (rooms.has(room.id)) throw new Error(`Room ${room.id} already exists`);
    return storeRoom(room);
  }

  function prepareStartRoom(roomId: string): RoomStartSetup {
    return roomToGameSetup(requireRoom(roomId));
  }

  function prepareResetRoom(roomId: string, mapId: MapId): RoomStartSetup {
    return roomToGameSetup({ ...requireRoom(roomId), status: "open", mapId });
  }

  return {
    listRooms(viewerUserId?: string): RoomState[] {
      return lobbyVisibleRooms([...rooms.values()], viewerUserId);
    },

    getRoom(roomId: string): RoomState {
      return requireRoom(roomId);
    },

    hasRoom(roomId: string): boolean {
      return rooms.has(roomId);
    },

    createRoom(input: CreateRoomInput): RoomState {
      return addRoom(createRoomState(input));
    },

    createGrandThirtyRoom(id: string, host: LocalUserProfile, roomOptions: GrandStressRoomOptions = {}): RoomState {
      return addRoom(createGrandThirtyRoomState(id, host, roomOptions));
    },

    adoptRoom(room: RoomState): RoomState {
      return addRoom(room);
    },

    joinRoom(roomId: string, user: LocalUserProfile): RoomState {
      return replaceRoom(joinFirstOpenSlot(requireRoom(roomId), user));
    },

    leaveRoom(roomId: string, userId: string): RoomState {
      return replaceRoom(leaveUserSlot(requireRoom(roomId), userId));
    },

    updateSlot(roomId: string, slotId: string, patch: SlotPatch): RoomState {
      return replaceRoom(updateRoomSlot(requireRoom(roomId), slotId, patch));
    },

    updateMap(roomId: string, mapId: MapId): RoomState {
      return replaceRoom(updateRoomMap(requireRoom(roomId), mapId));
    },

    resizeSlots(roomId: string, humanCount: number, aiCount: number): RoomState {
      return replaceRoom(resizeRoomSlots(requireRoom(roomId), humanCount, aiCount));
    },

    pauseRoom(roomId: string): RoomState {
      return replaceRoom({ ...requireRoom(roomId), autoTick: false });
    },

    resumeRoom(roomId: string): RoomState {
      return replaceRoom({ ...requireRoom(roomId), autoTick: true });
    },

    closeRoom(roomId: string, userId: string): RoomState {
      const room = requireRoom(roomId);
      if (room.hostUserId !== userId) throw new Error("Only the room host can close this room");
      const closed: RoomState = { ...room, status: "closed" };
      rooms.delete(roomId);
      return closed;
    },

    prepareStartRoom(roomId: string): RoomStartSetup {
      return prepareStartRoom(roomId);
    },

    startRoom(roomId: string): RoomStartResult {
      const room = requireRoom(roomId);
      const setup = prepareStartRoom(roomId);
      const { result: _result, ...roomWithoutResult } = room;
      const started = replaceRoom({ ...roomWithoutResult, status: "inMatch" });
      return { room: started, setup };
    },

    prepareResetRoom(roomId: string, mapId: MapId): RoomStartSetup {
      return prepareResetRoom(roomId, mapId);
    },

    resetRoom(roomId: string, mapId: MapId): RoomStartResult {
      const room = requireRoom(roomId);
      const setup = prepareResetRoom(roomId, mapId);
      const { result: _result, ...roomWithoutResult } = room;
      const reset = replaceRoom({ ...roomWithoutResult, mapId, status: "inMatch" });
      return { room: reset, setup };
    },

    finishRoom(roomId: string, snapshot: GameSnapshot): RoomState {
      return replaceRoom(finishRoomState(requireRoom(roomId), snapshot));
    },
  };
}
