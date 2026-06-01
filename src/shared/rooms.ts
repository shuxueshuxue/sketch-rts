import type { GameSetupOptions, GameSnapshot, LocalUserProfile, MapId, PlayerId, RaceId, RoomResult, RoomSlot, RoomState, RoomVisibility } from "./types";

export type CreateRoomInput = {
  id: string;
  host: LocalUserProfile;
  name?: string;
  mapId?: MapId;
  slotCount?: number;
  humanCount?: number;
  aiCount?: number;
  visibility?: RoomVisibility;
};

export type GrandStressRoomOptions = {
  humanCount?: number;
  aiCount?: number;
};

type EditableRoomSlot = Omit<RoomSlot, "userId"> & { userId?: string | undefined };

export type SlotPatch = Partial<Pick<RoomSlot, "controller" | "team" | "race" | "ready" | "name">> & { userId?: string | undefined };

export function createRoom(input: CreateRoomInput): RoomState {
  const humanCount = input.humanCount ?? 1;
  const aiCount = input.aiCount ?? Math.max(1, (input.slotCount ?? 2) - humanCount);
  const slotCount = input.humanCount !== undefined || input.aiCount !== undefined ? humanCount + aiCount : (input.slotCount ?? 2);
  if (humanCount < 1 || aiCount < 0 || slotCount < 2 || slotCount > 30) throw new Error("Rooms require 2 to 30 total slots and at least one human slot");
  const slots = Array.from({ length: slotCount }, (_, index): RoomSlot => {
    const playerId = defaultPlayerId(index);
    const isHost = index === 0;
    const isHumanSeat = index < humanCount;
    return normalizeSlot({
      id: `slot-${index + 1}`,
      playerId,
      controller: isHost ? "human" : isHumanSeat ? "open" : "ai",
      ...(isHost ? { userId: input.host.id } : {}),
      name: isHost ? input.host.name : isHumanSeat ? "Open" : `AI ${index - humanCount + 1}`,
      team: defaultTeam(index),
      race: index % 2 === 0 ? "grove" : "ember",
      ready: isHost,
    });
  });
  return {
    id: input.id,
    name: input.name ?? `${input.host.name}'s Room`,
    hostUserId: input.host.id,
    visibility: input.visibility ?? "public",
    mapId: input.mapId ?? "verdantCrossroads",
    status: "open",
    slots,
  };
}

export function updateRoomSlot(room: RoomState, slotId: string, patch: SlotPatch): RoomState {
  if (room.status !== "open") throw new Error("Cannot edit slots after match start");
  return {
    ...room,
    slots: room.slots.map((slot) => (slot.id === slotId ? normalizeSlot({ ...slot, ...patch }) : slot)),
  };
}

export function updateRoomMap(room: RoomState, mapId: MapId): RoomState {
  if (room.status !== "open") throw new Error("Cannot edit map after match start");
  return { ...room, mapId };
}

export function resizeRoomSlots(room: RoomState, humanCount: number, aiCount: number): RoomState {
  if (room.status !== "open") throw new Error("Cannot edit slots after match start");
  if (!Number.isInteger(humanCount) || !Number.isInteger(aiCount) || humanCount < 1 || aiCount < 0 || humanCount + aiCount < 2 || humanCount + aiCount > 30) {
    throw new Error("Rooms require 2 to 30 total slots and at least one human slot");
  }

  const slotCount = humanCount + aiCount;
  const slots = Array.from({ length: slotCount }, (_, index): RoomSlot => {
    const existing = room.slots[index];
    const isHost = index === 0;
    const isHumanSeat = index < humanCount;
    const base = {
      id: `slot-${index + 1}`,
      playerId: defaultPlayerId(index),
      team: existing?.team ?? defaultTeam(index),
      race: existing?.race ?? (index % 2 === 0 ? "grove" : "ember"),
    } satisfies Pick<RoomSlot, "id" | "playerId" | "team" | "race">;

    if (isHost) {
      return normalizeSlot({
        ...base,
        controller: "human",
        ...(existing?.userId ? { userId: existing.userId } : {}),
        name: existing?.name && existing.name !== "Open" && existing.name !== "Closed" && existing.name !== "AI" ? existing.name : "Player",
        ready: existing?.ready ?? true,
      });
    }
    if (isHumanSeat) {
      return normalizeSlot(
        existing?.controller === "human"
          ? { ...base, controller: "human", ...(existing.userId ? { userId: existing.userId } : {}), name: existing.name, ready: existing.ready }
          : { ...base, controller: "open", name: "Open", ready: false },
      );
    }
    return normalizeSlot({
      ...base,
      controller: "ai",
      name: existing?.controller === "ai" && existing.name !== "AI" ? existing.name : `AI ${index - humanCount + 1}`,
      ready: true,
    });
  });
  return { ...room, slots };
}

export function joinFirstOpenSlot(room: RoomState, user: LocalUserProfile): RoomState {
  const ownedSlot = room.slots.find((candidate) => candidate.controller === "human" && candidate.userId === user.id);
  if (ownedSlot) return room;
  const slot = room.slots.find((candidate) => candidate.controller === "open");
  if (!slot) throw new Error("Room has no open slots");
  return updateRoomSlot(room, slot.id, { controller: "human", userId: user.id, name: user.name, ready: false });
}

export function leaveUserSlot(room: RoomState, userId: string): RoomState {
  if (room.status !== "open") throw new Error("Cannot leave after match start");
  return {
    ...room,
    slots: room.slots.map((slot) =>
      slot.userId === userId ? normalizeSlot({ ...slot, controller: "open", name: "Open", ready: false }) : slot,
    ),
  };
}

export function canStartRoom(room: RoomState) {
  const active = activeRoomSlots(room);
  const teams = new Set(active.map((slot) => slot.team));
  return (
    room.status === "open" &&
    room.slots.every((slot) => slot.controller !== "open") &&
    active.length >= 2 &&
    teams.size >= 2 &&
    active.every((slot) => slot.controller === "ai" || (slot.controller === "human" && Boolean(slot.userId) && slot.ready))
  );
}

export function roomToGameSetup(room: RoomState): { mapId: MapId; options: GameSetupOptions; playerSlots: RoomSlot[] } {
  if (!canStartRoom(room)) throw new Error("Room is not ready to start");
  const playerSlots = activeRoomSlots(room);
  return {
    mapId: room.mapId,
    playerSlots,
    options: {
      players: playerSlots.map((slot) => slot.playerId),
      aiPlayers: playerSlots.filter((slot) => slot.controller === "ai").map((slot) => slot.playerId),
      aiVersions: Object.fromEntries(playerSlots.filter((slot) => slot.controller === "ai").map((slot) => [slot.playerId, "v1"])),
      teams: Object.fromEntries(playerSlots.map((slot) => [slot.playerId, slot.team])),
      races: Object.fromEntries(playerSlots.map((slot) => [slot.playerId, slot.race as RaceId])),
    },
  };
}

export function finishRoom(room: RoomState, snapshot: GameSnapshot): RoomState {
  const result: RoomResult = {
    winner: snapshot.match.winner,
    endedAtTick: snapshot.match.endedAtTick,
    slots: activeRoomSlots(room),
    stats: snapshot.match.stats,
  };
  return { ...room, status: "ended", result };
}

export function activeRoomSlots(room: RoomState) {
  return room.slots.filter((slot) => slot.controller === "human" || slot.controller === "ai");
}

export function lobbyVisibleRooms(rooms: RoomState[], viewerUserId?: string): RoomState[] {
  return rooms.filter((room) => room.visibility === "public" || Boolean(viewerUserId && room.slots.some((slot) => slot.userId === viewerUserId)));
}

export function createGrandThirtyRoom(id: string, host: LocalUserProfile, options: GrandStressRoomOptions = {}): RoomState {
  const humanCount = options.humanCount ?? 15;
  const aiCount = options.aiCount ?? 15;
  if (!Number.isInteger(humanCount) || !Number.isInteger(aiCount) || humanCount < 1 || aiCount < 1 || humanCount + aiCount !== 30) {
    throw new Error("Grand stress rooms require humanCount + aiCount = 30 with both sides active");
  }

  const humans = Array.from({ length: humanCount }, (_, index) =>
    normalizeSlot({
      id: `slot-${index + 1}`,
      playerId: `human-${index + 1}`,
      controller: "human",
      userId: index === 0 ? host.id : `agent-human-${index + 1}`,
      name: index === 0 ? host.name : `SDK Agent ${index + 1}`,
      team: "north",
      race: index % 2 === 0 ? "grove" : "ember",
      ready: true,
    }),
  );
  const ais = Array.from({ length: aiCount }, (_, index) =>
    normalizeSlot({
      id: `slot-${humanCount + index + 1}`,
      playerId: `ai-${index + 1}`,
      controller: "ai",
      name: `Internal AI ${index + 1}`,
      team: "south",
      race: index % 2 === 0 ? "ember" : "grove",
      ready: true,
    }),
  );
  return {
    id,
    name: `Grand Thirty ${humanCount}v${aiCount}`,
    hostUserId: host.id,
    visibility: "public",
    mapId: "grandThirty",
    status: "open",
    slots: [...humans, ...ais],
  };
}

function normalizeSlot(slot: EditableRoomSlot): RoomSlot {
  if (slot.controller === "ai") return withoutUserId({ ...slot, ready: true, name: slot.name && slot.name !== "Open" && slot.name !== "Closed" ? slot.name : "AI" });
  if (slot.controller === "closed") return withoutUserId({ ...slot, name: "Closed", ready: false });
  if (slot.controller === "open") return withoutUserId({ ...slot, name: "Open", ready: false });
  const base = withoutUserId({ ...slot, ready: Boolean(slot.ready), name: slot.name || "Player" });
  return slot.userId ? { ...base, userId: slot.userId } : base;
}

function withoutUserId(slot: EditableRoomSlot): RoomSlot {
  const { userId: _userId, ...rest } = slot;
  return rest;
}

function defaultPlayerId(index: number): PlayerId {
  if (index === 0) return "player";
  if (index === 1) return "enemy";
  if (index === 2) return "enemy2";
  return `player-${index + 1}`;
}

function defaultTeam(index: number): RoomSlot["team"] {
  return index % 2 === 0 ? "north" : "south";
}
