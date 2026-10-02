import type { GameSetupOptions, GameSnapshot, LocalUserProfile, MapId, PlayerId, RaceId, RoomAiVersion, RoomResult, RoomSlot, RoomState, RoomVisibility } from "./types";
import { RACE_IDS } from "./catalog";
import { LADDER_MAP_ID } from "./map-ids";
import { fnv1a } from "./sim/checksum";
import { poolMap, poolSeatsFit } from "./map-pool";
import { assertRoomSlotCounts, isGrandStressSlotCounts } from "./room-slot-counts";

export const DEFAULT_INTERNAL_AI_VERSION: RoomAiVersion = "v5";
export const ROOM_AI_VERSIONS: RoomAiVersion[] = ["v5", "v7", "v8"];
// @@@room-ai-races - The races each computer player plays, declared here alone: a seat lists only the computer players
// of its race, and a room refuses one set to a race it does not play. All three play both (V5 has a playbook for each,
// and V7 and V8 are built to play either: see src/ai/policy/versions.ts).
export const ROOM_AI_RACES: Readonly<Record<RoomAiVersion, readonly RaceId[]>> = { v5: RACE_IDS, v7: RACE_IDS, v8: RACE_IDS };

export function roomAiVersionsFor(race: RaceId): RoomAiVersion[] {
  return ROOM_AI_VERSIONS.filter((version) => ROOM_AI_RACES[version].includes(race));
}

// @@@room-teams - A seat plays free for all, on a team of its own (the default), or on one of four teams with the seats
// that pick it; the game knows only which players share a team. A map dealt out in two sides (see @@@map-pool) starts its
// seats on teams 1 and 2 by turns, as it plays only as two equal teams. Rooms and saves from before held north, south,
// east and west: those are teams 1 to 4.
export const FREE_FOR_ALL = "ffa";
export const ROOM_TEAMS = [FREE_FOR_ALL, "team-1", "team-2", "team-3", "team-4"] as const;
const COMPASS_TEAMS: Partial<Record<string, string>> = { north: "team-1", south: "team-2", east: "team-3", west: "team-4" };

export function roomTeam(team: string) {
  return COMPASS_TEAMS[team] ?? team;
}

// The team a seat plays on: free for all is a team of the seat's own.
export function seatTeam(slot: Pick<RoomSlot, "playerId" | "team">) {
  return slot.team === FREE_FOR_ALL ? slot.playerId : slot.team;
}

const DEFAULT_ROOM_MAP_ID: MapId = "verdantCrossroads";

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

export type SlotPatch = Partial<Pick<RoomSlot, "controller" | "team" | "race" | "ready" | "name" | "aiVersion">> & { userId?: string | undefined };

export function createRoom(input: CreateRoomInput): RoomState {
  const { humanCount, aiCount, slotCount } = assertRoomSlotCounts(input);
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
      team: defaultTeam(index, input.mapId ?? DEFAULT_ROOM_MAP_ID),
      // A computer seat starts on a race and a computer player drawn when the match starts (see @@@random-seats).
      race: isHumanSeat ? (index % 2 === 0 ? "grove" : "ember") : "random",
      ...(isHumanSeat ? {} : { aiVersion: "random" as const }),
      ready: isHost,
    });
  });
  return {
    id: input.id,
    name: input.name ?? `${input.host.name}'s Room`,
    hostUserId: input.host.id,
    visibility: input.visibility ?? "public",
    mapId: input.mapId ?? DEFAULT_ROOM_MAP_ID,
    status: "open",
    autoTick: true,
    slots,
  };
}

export function updateRoomSlot(room: RoomState, slotId: string, patch: SlotPatch): RoomState {
  if (room.status !== "open") throw new Error("Cannot edit slots after match start");
  const slots = room.slots.map((slot) => (slot.id === slotId ? normalizeSlot({ ...slot, ...patch }) : slot));
  const edited = slots.find((slot) => slot.id === slotId);
  if (edited?.controller === "ai" && edited.race !== "random" && edited.aiVersion && edited.aiVersion !== "random" && !ROOM_AI_RACES[edited.aiVersion].includes(edited.race)) {
    throw new Error(`${edited.aiVersion} does not play ${edited.race}`);
  }
  return { ...room, slots };
}

export function updateRoomMap(room: RoomState, mapId: MapId): RoomState {
  if (room.status !== "open") throw new Error("Cannot edit map after match start");
  return { ...room, mapId };
}

export function resizeRoomSlots(room: RoomState, humanCount: number, aiCount: number): RoomState {
  if (room.status !== "open") throw new Error("Cannot edit slots after match start");
  const slotCount = assertRoomSlotCounts({ humanCount, aiCount }).slotCount;
  const slots = Array.from({ length: slotCount }, (_, index): RoomSlot => {
    const existing = room.slots[index];
    const isHost = index === 0;
    const isHumanSeat = index < humanCount;
    const base = {
      id: `slot-${index + 1}`,
      playerId: defaultPlayerId(index),
      team: existing?.team ?? defaultTeam(index, room.mapId),
      race: existing?.race ?? (isHumanSeat ? (index % 2 === 0 ? "grove" : "ember") : "random"),
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
      aiVersion: existing?.controller === "ai" ? (existing.aiVersion ?? "random") : "random",
      name: existing?.controller === "ai" && existing.name !== "AI" ? existing.name : `AI ${index - humanCount + 1}`,
      ready: true,
    });
  });
  return { ...room, slots };
}

export function joinFirstOpenSlot(room: RoomState, user: LocalUserProfile): RoomState {
  const ownedSlot = room.slots.find((candidate) => candidate.controller === "human" && candidate.userId === user.id);
  if (ownedSlot) return room;
  if (room.status !== "open") throw new Error("Cannot join after match start");
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
  const teams = active.map(seatTeam);
  // A pool map plays only with all its seats taken (see @@@map-pool).
  const pool = poolMap(room.mapId);
  return (
    room.status === "open" &&
    (!pool || poolSeatsFit(pool, teams)) &&
    room.slots.every((slot) => slot.controller !== "open") &&
    active.length >= 2 &&
    new Set(teams).size >= 2 &&
    active.every((slot) => slot.controller === "ai" || (slot.controller === "human" && Boolean(slot.userId) && slot.ready))
  );
}

export function roomToGameSetup(room: RoomState): { mapId: MapId; options: GameSetupOptions; playerSlots: ResolvedRoomSlot[] } {
  if (!canStartRoom(room)) throw new Error("Room is not ready to start");
  const playerSlots = resolvedRoomSlots(room);
  // A room on the ladder map plays the layout its own id seeds.
  const layoutSeed = room.mapId === LADDER_MAP_ID ? room.id : undefined;
  return {
    mapId: room.mapId,
    playerSlots,
    options: {
      players: playerSlots.map((slot) => slot.playerId),
      aiPlayers: playerSlots.filter((slot) => slot.controller === "ai").map((slot) => slot.playerId),
      aiVersions: Object.fromEntries(playerSlots.filter((slot) => slot.controller === "ai").map((slot) => [slot.playerId, slot.aiVersion])),
      teams: Object.fromEntries(playerSlots.map((slot) => [slot.playerId, seatTeam(slot)])),
      races: Object.fromEntries(playerSlots.map((slot) => [slot.playerId, slot.race])),
      ...(layoutSeed ? { layout: { seed: layoutSeed } } : {}),
    },
  };
}

export function finishRoom(room: RoomState, snapshot: GameSnapshot): RoomState {
  const result: RoomResult = {
    winner: snapshot.match.winner,
    endedAtTick: snapshot.match.endedAtTick,
    slots: resolvedRoomSlots(room),
    stats: snapshot.match.stats,
  };
  return { ...room, status: "ended", result };
}

export function activeRoomSlots(room: RoomState) {
  return room.slots.filter((slot) => slot.controller === "human" || slot.controller === "ai");
}

export type ResolvedRoomSlot = RoomSlot & { race: RaceId; aiVersion: RoomAiVersion };

// @@@random-seats - The seats as they play: a race drawn for a seat on random, then for a computer seat on random one
// of the computer players of that race; a computer seat with none set plays the room default. Every draw is the room's
// and the seat's (an FNV hash of their ids), so the start, a reset and the result all see the same seats, and the game,
// its replay and its result hold what was drawn, never "random".
export function resolvedRoomSlots(room: RoomState): ResolvedRoomSlot[] {
  const draw = <T>(key: string, choices: readonly T[]) => choices[Number.parseInt(fnv1a(`${room.id}:${key}`), 16) % choices.length]!;
  return activeRoomSlots(room).map((slot) => {
    const race = slot.race === "random" ? draw(`${slot.id}:race`, RACE_IDS) : slot.race;
    const aiVersion = slot.aiVersion === "random" ? draw(`${slot.id}:ai`, roomAiVersionsFor(race)) : (slot.aiVersion ?? DEFAULT_INTERNAL_AI_VERSION);
    return { ...slot, race, aiVersion };
  });
}

export function lobbyVisibleRooms(rooms: RoomState[], viewerUserId?: string): RoomState[] {
  return rooms.filter((room) => room.visibility === "public" || Boolean(viewerUserId && room.slots.some((slot) => slot.userId === viewerUserId)));
}

export function createGrandThirtyRoom(id: string, host: LocalUserProfile, options: GrandStressRoomOptions = {}): RoomState {
  const humanCount = options.humanCount ?? 15;
  const aiCount = options.aiCount ?? 15;
  if (!isGrandStressSlotCounts(humanCount, aiCount)) {
    throw new Error("Grand stress rooms require humanCount + aiCount = 30 with both sides active");
  }

  const humans = Array.from({ length: humanCount }, (_, index) =>
    normalizeSlot({
      id: `slot-${index + 1}`,
      playerId: `human-${index + 1}`,
      controller: "human",
      userId: index === 0 ? host.id : `agent-human-${index + 1}`,
      name: index === 0 ? host.name : `SDK Agent ${index + 1}`,
      team: "team-1",
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
      team: "team-2",
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
    autoTick: true,
    slots: [...humans, ...ais],
  };
}

function normalizeSlot(edited: EditableRoomSlot): RoomSlot {
  const slot = { ...edited, team: roomTeam(edited.team) };
  if (slot.controller === "ai") {
    // A race drawn at the start leaves the computer player to be drawn among those that play it.
    const aiVersion = slot.race === "random" ? "random" : slot.aiVersion;
    return withoutUserId({ ...slot, ...(aiVersion ? { aiVersion } : {}), ready: true, name: slot.name && slot.name !== "Open" && slot.name !== "Closed" ? slot.name : "AI" });
  }
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

function defaultTeam(index: number, mapId: MapId): RoomSlot["team"] {
  if (poolMap(mapId)?.layout.kind !== "sides") return FREE_FOR_ALL;
  return index % 2 === 0 ? "team-1" : "team-2";
}
