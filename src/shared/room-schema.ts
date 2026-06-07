import { BUILDABLE_BUILDING_KINDS, MERCENARY_UNIT_KINDS, RACE_IDS, UNIT_DEFS } from "./catalog";
import { isMapId } from "./map-ids";
import { isGrandStressSlotCounts, resolveRoomSlotCounts } from "./room-slot-counts";
import type { CreateRoomInput, SlotPatch } from "./rooms";
import type { GameSetupOptions, ItemKind, LocalUserProfile, MapId, PlayerId, RaceId, RoomVisibility, ScenarioOverride, SlotController, UnitKind } from "./types";

const ITEM_KINDS = ["flameCloak", "lightningRod", "stormStaff", "guardianScroll", "experienceBook", "breachCharge"] satisfies ItemKind[];

export type CreateRoomRequest = Omit<CreateRoomInput, "id"> & { id?: string };
export type MapUpdateRequest = { mapId: MapId };
export type SlotCountsRequest = { humanCount: number; aiCount: number };
export type ResetRoomRequest = { mapId: MapId; options: GameSetupOptions };
export type ContinueSaveRequest = { roomId?: string };
export type GrandStressRoomRequest = { humanCount?: number; aiCount?: number };

export function parseCreateRoomRequest(value: unknown): CreateRoomRequest | undefined {
  if (!isRecord(value) || !isLocalUserProfile(value.host)) return undefined;
  const input: CreateRoomRequest = { host: value.host };
  if (value.id !== undefined) {
    if (typeof value.id !== "string" || value.id.length === 0) return undefined;
    input.id = value.id;
  }
  if (value.name !== undefined) {
    if (typeof value.name !== "string") return undefined;
    input.name = value.name;
  }
  if (value.mapId !== undefined) {
    if (!isMapId(value.mapId)) return undefined;
    input.mapId = value.mapId;
  }
  if (value.slotCount !== undefined) {
    if (typeof value.slotCount !== "number") return undefined;
    input.slotCount = value.slotCount;
  }
  if (value.humanCount !== undefined) {
    if (typeof value.humanCount !== "number") return undefined;
    input.humanCount = value.humanCount;
  }
  if (value.aiCount !== undefined) {
    if (typeof value.aiCount !== "number") return undefined;
    input.aiCount = value.aiCount;
  }
  if (!resolveRoomSlotCounts(input)) return undefined;
  if (value.visibility !== undefined) {
    if (!isRoomVisibility(value.visibility)) return undefined;
    input.visibility = value.visibility;
  }
  return input;
}

export function roomCreateInputFromRequest(value: unknown, fallbackId: string): CreateRoomInput {
  const request = parseCreateRoomRequest(value);
  if (!request) throw new Error("Malformed room create input");
  const id = request.id ?? fallbackId;
  return { ...request, id };
}

export function assertCreateRoomInput(value: unknown): CreateRoomInput {
  const request = parseCreateRoomRequest(value);
  if (!request?.id) throw new Error("Malformed room create input");
  return { ...request, id: request.id };
}

export function parseGrandStressRoomRequest(value: unknown): (GrandStressRoomRequest & { id?: string; host: LocalUserProfile }) | undefined {
  if (!isRecord(value) || !isLocalUserProfile(value.host)) return undefined;
  const request: GrandStressRoomRequest & { id?: string; host: LocalUserProfile } = { host: value.host };
  if (value.id !== undefined) {
    if (typeof value.id !== "string" || value.id.length === 0) return undefined;
    request.id = value.id;
  }
  if (value.humanCount !== undefined) {
    if (typeof value.humanCount !== "number" || !Number.isInteger(value.humanCount)) return undefined;
    request.humanCount = value.humanCount;
  }
  if (value.aiCount !== undefined) {
    if (typeof value.aiCount !== "number" || !Number.isInteger(value.aiCount)) return undefined;
    request.aiCount = value.aiCount;
  }
  if (!isGrandStressSlotCounts(request.humanCount ?? 15, request.aiCount ?? 15)) return undefined;
  return request;
}

export function parseMapUpdateRequest(value: unknown): MapUpdateRequest | undefined {
  if (!isRecord(value) || !isMapId(value.mapId)) return undefined;
  return { mapId: value.mapId };
}

export function parseSlotCountsRequest(value: unknown): SlotCountsRequest | undefined {
  if (!isRecord(value) || typeof value.humanCount !== "number" || typeof value.aiCount !== "number") return undefined;
  const counts = resolveRoomSlotCounts({ humanCount: value.humanCount, aiCount: value.aiCount });
  return counts ? { humanCount: counts.humanCount, aiCount: counts.aiCount } : undefined;
}

export function parseResetRoomRequest(value: unknown): ResetRoomRequest | undefined {
  if (!isRecord(value) || !isMapId(value.mapId)) return undefined;
  const options = parseGameSetupOptions(value.options);
  if (!options) return undefined;
  return { mapId: value.mapId, options };
}

export function parseContinueSaveRequest(value: unknown): ContinueSaveRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (value.roomId !== undefined && typeof value.roomId !== "string") return undefined;
  return typeof value.roomId === "string" ? { roomId: value.roomId } : {};
}

export function parseGameSetupOptions(value: unknown): GameSetupOptions | undefined {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  const options: GameSetupOptions = {};
  if (value.players !== undefined) {
    if (!isPlayerArray(value.players)) return undefined;
    options.players = value.players;
  }
  if (value.aiPlayers !== undefined) {
    if (!isPlayerArray(value.aiPlayers)) return undefined;
    options.aiPlayers = value.aiPlayers;
  }
  if (value.aiVersions !== undefined) {
    if (!isAiVersionMap(value.aiVersions)) return undefined;
    options.aiVersions = value.aiVersions;
  }
  if (value.teams !== undefined) {
    if (!isTeamMap(value.teams)) return undefined;
    options.teams = value.teams;
  }
  if (value.races !== undefined) {
    if (!isRaceMap(value.races)) return undefined;
    options.races = value.races;
  }
  if (value.scenario !== undefined) {
    const scenario = parseScenarioOverride(value.scenario);
    if (!scenario) return undefined;
    options.scenario = scenario;
  }
  return options;
}

export function parseSlotPatch(value: unknown): SlotPatch | undefined {
  if (!isRecord(value)) return undefined;
  const patch: SlotPatch = {};
  if (value.controller !== undefined) {
    if (value.controller !== "human" && value.controller !== "ai" && value.controller !== "open" && value.controller !== "closed") return undefined;
    patch.controller = value.controller;
  }
  if (value.team !== undefined) {
    if (typeof value.team !== "string" || value.team.length === 0) return undefined;
    patch.team = value.team;
  }
  if (value.race !== undefined) {
    if (!isRaceId(value.race)) return undefined;
    patch.race = value.race;
  }
  if (value.ready !== undefined) {
    if (typeof value.ready !== "boolean") return undefined;
    patch.ready = value.ready;
  }
  if (value.name !== undefined) {
    if (typeof value.name !== "string" || value.name.length === 0) return undefined;
    patch.name = value.name;
  }
  if ("userId" in value) {
    if (value.userId !== undefined && typeof value.userId !== "string") return undefined;
    patch.userId = value.userId;
  }
  return patch;
}

function parseScenarioOverride(value: unknown): ScenarioOverride | undefined {
  if (!isRecord(value)) return undefined;
  const scenario: ScenarioOverride = {};
  if (value.replaceDefaultUnits !== undefined) {
    if (typeof value.replaceDefaultUnits !== "boolean") return undefined;
    scenario.replaceDefaultUnits = value.replaceDefaultUnits;
  }
  if (value.replaceDefaultBuildings !== undefined) {
    if (typeof value.replaceDefaultBuildings !== "boolean") return undefined;
    scenario.replaceDefaultBuildings = value.replaceDefaultBuildings;
  }
  if (value.replaceDefaultResources !== undefined) {
    if (typeof value.replaceDefaultResources !== "boolean") return undefined;
    scenario.replaceDefaultResources = value.replaceDefaultResources;
  }
  if (value.replaceDefaultMercenaryCamps !== undefined) {
    if (typeof value.replaceDefaultMercenaryCamps !== "boolean") return undefined;
    scenario.replaceDefaultMercenaryCamps = value.replaceDefaultMercenaryCamps;
  }
  if (value.replaceDefaultLandmarks !== undefined) {
    if (typeof value.replaceDefaultLandmarks !== "boolean") return undefined;
    scenario.replaceDefaultLandmarks = value.replaceDefaultLandmarks;
  }
  if (value.addResources !== undefined) {
    if (!Array.isArray(value.addResources) || !value.addResources.every(isResourceSeed)) return undefined;
    scenario.addResources = value.addResources;
  }
  if (value.addMercenaryCamps !== undefined) {
    if (!Array.isArray(value.addMercenaryCamps) || !value.addMercenaryCamps.every(isMercenaryCampSeed)) return undefined;
    scenario.addMercenaryCamps = value.addMercenaryCamps;
  }
  if (value.addItems !== undefined) {
    if (!Array.isArray(value.addItems) || !value.addItems.every(isItemSeed)) return undefined;
    scenario.addItems = value.addItems;
  }
  if (value.addUnits !== undefined) {
    if (!Array.isArray(value.addUnits) || !value.addUnits.every(isUnitSeed)) return undefined;
    scenario.addUnits = value.addUnits;
  }
  if (value.addBuildings !== undefined) {
    if (!Array.isArray(value.addBuildings) || !value.addBuildings.every(isBuildingSeed)) return undefined;
    scenario.addBuildings = value.addBuildings;
  }
  if (value.addLandmarks !== undefined) {
    if (!Array.isArray(value.addLandmarks) || !value.addLandmarks.every(isLandmarkSeed)) return undefined;
    scenario.addLandmarks = value.addLandmarks;
  }
  return scenario;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRoomVisibility(value: unknown): value is RoomVisibility {
  return value === "private" || value === "public";
}

export function isLocalUserProfile(value: unknown): value is LocalUserProfile {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 && typeof value.name === "string" && value.name.length > 0;
}

function isPlayerArray(value: unknown): value is PlayerId[] {
  return Array.isArray(value) && value.every(isPlayerId);
}

function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
}

function isTeamMap(value: unknown): value is Partial<Record<PlayerId, string>> {
  return isRecord(value) && Object.entries(value).every(([owner, team]) => isPlayerId(owner) && typeof team === "string");
}

function isRaceMap(value: unknown): value is Partial<Record<PlayerId, RaceId>> {
  return isRecord(value) && Object.entries(value).every(([owner, race]) => isPlayerId(owner) && isRaceId(race));
}

function isRaceId(value: unknown): value is RaceId {
  return typeof value === "string" && (RACE_IDS as readonly string[]).includes(value);
}

function isAiVersionMap(value: unknown): value is GameSetupOptions["aiVersions"] {
  return isRecord(value) && Object.entries(value).every(([owner, version]) => isPlayerId(owner) && (version === "v1" || version === "v2"));
}

function isResourceSeed(value: unknown) {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && value.kind === "goldMine" && isNumber(value.x) && isNumber(value.y) && isPositiveInteger(value.amount);
}

function isMercenaryCampSeed(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isPositiveNumber(value.radius) &&
    typeof value.hireKind === "string" &&
    (MERCENARY_UNIT_KINDS as readonly string[]).includes(value.hireKind) &&
    isPositiveInteger(value.cost) &&
    isPositiveInteger(value.stock) &&
    isPositiveInteger(value.cooldown) &&
    isNonNegativeInteger(value.cooldownRemaining)
  );
}

function isItemSeed(value: unknown) {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && isItemKind(value.kind) && isNumber(value.x) && isNumber(value.y) && (value.carrierId === undefined || typeof value.carrierId === "string") && isNonNegativeInteger(value.cooldownRemaining);
}

function isUnitSeed(value: unknown) {
  if (!isRecord(value)) return false;
  if (!(typeof value.id === "string" && isOwner(value.owner) && isUnitKind(value.kind) && isNumber(value.x) && isNumber(value.y))) return false;
  return value.hp === undefined || (isPositiveNumber(value.hp) && value.hp <= UNIT_DEFS[value.kind].hp);
}

function isBuildingSeed(value: unknown) {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && isPlayerId(value.owner) && isBuildableBuilding(value.kind) && isNumber(value.x) && isNumber(value.y) && (value.complete === undefined || typeof value.complete === "boolean");
}

function isLandmarkSeed(value: unknown) {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && isLandmarkKind(value.kind) && isNumber(value.x) && isNumber(value.y) && isPositiveNumber(value.size) && isNumber(value.rotation);
}

function isOwner(value: unknown) {
  return isPlayerId(value) || value === "neutral";
}

function isUnitKind(value: unknown): value is UnitKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(UNIT_DEFS, value);
}

function isItemKind(value: unknown): value is ItemKind {
  return typeof value === "string" && (ITEM_KINDS as readonly string[]).includes(value);
}

function isBuildableBuilding(value: unknown) {
  return typeof value === "string" && (BUILDABLE_BUILDING_KINDS as readonly string[]).includes(value);
}

function isLandmarkKind(value: unknown) {
  return value === "grove" || value === "ridge" || value === "ruin" || value === "ditch" || value === "road" || value === "campMark" || value === "mineScar" || value === "bannerStone";
}

function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value > 0;
}

function isPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
