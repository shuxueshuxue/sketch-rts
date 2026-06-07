import type { GameCommand, GameSnapshot, PlayerId, Unit, WorldItem } from "../shared/types";

export function itemHotkey(index: number) {
  return itemHotkeys(index + 1)[index] ?? "";
}

export function itemHotkeys(count: number, reservedDigits = new Set<number>()) {
  const keys: string[] = [];
  for (let digit = 1; digit <= 9 && keys.length < count; digit += 1) {
    if (!reservedDigits.has(digit)) keys.push(String(digit));
  }
  return keys;
}

export function carriedItemsForSelection(snapshot: GameSnapshot, selectedUnits: Unit[]) {
  const selectedUnitIds = new Set(selectedUnits.map((unit) => unit.id));
  return snapshot.items
    .filter((item) => item.carrierId && selectedUnitIds.has(item.carrierId))
    .map((item) => ({ item, carrier: selectedUnits.find((unit) => unit.id === item.carrierId)! }));
}

export function pickupItemCommand(selectedUnits: Unit[], item: WorldItem): Extract<GameCommand, { type: "pickupItem" }> | undefined {
  const carrier = nearestUnit(selectedUnits, item);
  return carrier ? { type: "pickupItem", unitId: carrier.id, itemId: item.id } : undefined;
}

export function useItemCommand(snapshot: GameSnapshot, owner: PlayerId, item: WorldItem, carrier: Unit): GameCommand | undefined {
  if (item.cooldownRemaining > 0) return undefined;
  if (item.kind === "flameCloak") return undefined;
  if (item.kind === "experienceBook" || item.kind === "guardianScroll") return { type: "useItem", unitId: carrier.id, itemId: item.id };
  const target = nearestEnemy(snapshot, owner, carrier, item.kind === "stormStaff" ? 320 : 280);
  if (!target) return undefined;
  if (item.kind === "stormStaff") return { type: "useItem", unitId: carrier.id, itemId: item.id, x: target.x, y: target.y };
  return { type: "useItem", unitId: carrier.id, itemId: item.id, targetId: target.id };
}

export function dropItemCommand(item: WorldItem, carrier: Unit): GameCommand {
  return { type: "dropItem", unitId: carrier.id, itemId: item.id, x: carrier.x + carrier.radius + 18, y: carrier.y + 8 };
}

function nearestUnit(units: Unit[], point: { x: number; y: number }) {
  return [...units].sort((a, b) => distanceSquared(a, point) - distanceSquared(b, point))[0];
}

function nearestEnemy(snapshot: GameSnapshot, owner: PlayerId, carrier: Unit, range: number) {
  const rangeSquared = range * range;
  return snapshot.units
    .filter((unit) => unit.owner !== owner && distanceSquared(unit, carrier) <= rangeSquared)
    .sort((a, b) => distanceSquared(a, carrier) - distanceSquared(b, carrier))[0];
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
