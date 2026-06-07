export const MIN_ROOM_SLOTS = 2;
export const MAX_ROOM_SLOTS = 30;

export type RoomSlotCountInput = {
  slotCount?: number;
  humanCount?: number;
  aiCount?: number;
};

export type ResolvedRoomSlotCounts = {
  humanCount: number;
  aiCount: number;
  slotCount: number;
};

export function resolveRoomSlotCounts(input: RoomSlotCountInput): ResolvedRoomSlotCounts | undefined {
  if (input.slotCount !== undefined && !isSlotCount(input.slotCount)) return undefined;
  if (input.humanCount !== undefined && !isHumanCount(input.humanCount)) return undefined;
  if (input.aiCount !== undefined && !isAiCount(input.aiCount)) return undefined;

  const humanCount = input.humanCount ?? 1;
  const aiCount = input.aiCount ?? Math.max(1, (input.slotCount ?? MIN_ROOM_SLOTS) - humanCount);
  const slotCount = input.humanCount !== undefined || input.aiCount !== undefined ? humanCount + aiCount : (input.slotCount ?? MIN_ROOM_SLOTS);
  if (humanCount + aiCount !== slotCount || slotCount < MIN_ROOM_SLOTS || slotCount > MAX_ROOM_SLOTS) return undefined;
  return { humanCount, aiCount, slotCount };
}

export function assertRoomSlotCounts(input: RoomSlotCountInput): ResolvedRoomSlotCounts {
  const counts = resolveRoomSlotCounts(input);
  if (!counts) throw new Error("Rooms require 2 to 30 total slots and at least one human slot");
  return counts;
}

export function isGrandStressSlotCounts(humanCount: number, aiCount: number): boolean {
  return Number.isInteger(humanCount) && Number.isInteger(aiCount) && humanCount >= 1 && aiCount >= 1 && humanCount + aiCount === MAX_ROOM_SLOTS;
}

function isSlotCount(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_ROOM_SLOTS && value <= MAX_ROOM_SLOTS;
}

function isHumanCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_ROOM_SLOTS;
}

function isAiCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_ROOM_SLOTS - 1;
}
