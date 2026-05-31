import type { GameSetupOptions, GameSnapshot, LocalUserProfile, MapId, PlayerId, RaceId, RoomResult, RoomSlot, RoomState } from "./types";

export type CreateRoomInput = {
  id: string;
  host: LocalUserProfile;
  name?: string;
  mapId?: MapId;
  slotCount?: number;
};

export type GrandStressRoomOptions = {
  humanCount?: number;
  aiCount?: number;
};

type EditableRoomSlot = Omit<RoomSlot, "userId"> & { userId?: string | undefined };

export type SlotPatch = Partial<Pick<RoomSlot, "controller" | "team" | "race" | "ready" | "name">> & { userId?: string | undefined };

export function createRoom(input: CreateRoomInput): RoomState {
  const slotCount = input.slotCount ?? 2;
  const slots = Array.from({ length: slotCount }, (_, index): RoomSlot => {
    const playerId = defaultPlayerId(index);
    return normalizeSlot({
      id: `slot-${index + 1}`,
      playerId,
      controller: index === 0 ? "human" : "ai",
      ...(index === 0 ? { userId: input.host.id } : {}),
      name: index === 0 ? input.host.name : `AI ${index}`,
      team: index === 0 ? "north" : "south",
      race: index % 2 === 0 ? "grove" : "ember",
      ready: index === 0,
    });
  });
  return {
    id: input.id,
    name: input.name ?? `${input.host.name}'s Room`,
    hostUserId: input.host.id,
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

export function joinFirstOpenSlot(room: RoomState, user: LocalUserProfile): RoomState {
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
    mapId: "grandThirty",
    status: "open",
    slots: [...humans, ...ais],
  };
}

function normalizeSlot(slot: EditableRoomSlot): RoomSlot {
  if (slot.controller === "ai") return withoutUserId({ ...slot, ready: true, name: slot.name || "AI" });
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
