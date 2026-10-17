import { CARRY_SLOTS, ITEM_DEFS, canEquip, itemSlot } from "../shared/equipment";
import { isInCabin } from "../shared/ship-cabin";
import { localToWorld, shipProfile } from '../shared/ship-geometry';
import type { GameCommand, GameSnapshot, PlayerId, Unit, WorldItem } from "../shared/types";

// @@@item-slots - The item bar is the focused unit's four carrying positions (see CARRY_SLOTS), as Warcraft III's bar is
// its hero's six slots: slot n always shows what lies in that position and answers to digit n (unless digit n recalls a
// control group), an empty slot is an empty well, and worn gear (boots, armor) stays on the equipment panel. The bar used
// to list every item of every selected unit in a row, worn gear included, so a slot's number moved whenever an item came
// or went, or a control group took a digit.
export type InventorySlot = { slot: (typeof CARRY_SLOTS)[number]; digit: number; item?: WorldItem };

export function inventorySlots(snapshot: Pick<GameSnapshot, "items">, carrier: Unit | undefined): InventorySlot[] {
  if (!carrier || !canEquip(carrier) || shipProfile(carrier)) return [];
  const carried = snapshot.items.filter(item => item.carrierId === carrier.id && item.kind !== "issuedWeapon");
  return CARRY_SLOTS.map((slot, index) => {
    const item = carried.find(candidate => itemSlot(snapshot, carrier, candidate) === slot);
    return { slot, digit: index + 1, ...(item ? { item } : {}) };
  });
}

// Whose slots the bar shows: the first unit of the focused selection that carries items.
export function inventoryCarrier(units: readonly Unit[]) {
  return units.find(unit => canEquip(unit) && !shipProfile(unit) && !isInCabin(unit));
}

export function carriedItemsForSelection(snapshot: GameSnapshot, selectedUnits: Unit[]) {
  const selectedUnitIds = new Set(selectedUnits.map((unit) => unit.id));
  return snapshot.items
    .filter((item) => item.kind!=="issuedWeapon" && item.carrierId && selectedUnitIds.has(item.carrierId))
    .map((item) => ({ item, carrier: selectedUnits.find((unit) => unit.id === item.carrierId)! }));
}

export function pickupItemCommand(selectedUnits: Unit[], item: WorldItem): Extract<GameCommand, { type: "pickupItem" }> | undefined {
  const carrier = nearestUnit(selectedUnits, item);
  return carrier ? { type: "pickupItem", unitId: carrier.id, itemId: item.id } : undefined;
}

export function useItemCommand(snapshot: GameSnapshot, owner: PlayerId, item: WorldItem, carrier: Unit): GameCommand | undefined {
  if (item.cooldownRemaining > 0) return undefined;
  if (ITEM_DEFS[item.kind].passive) return undefined;
  if (item.kind === "experienceBook" || item.kind === "guardianScroll" || item.kind === "healingScroll") return { type: "useItem", unitId: carrier.id, itemId: item.id };
  const target = nearestEnemy(snapshot, owner, carrier, item.kind === "stormStaff" ? 320 : 280);
  if (!target) return undefined;
  if (item.kind === "stormStaff") return { type: "useItem", unitId: carrier.id, itemId: item.id, x: target.x, y: target.y };
  return { type: "useItem", unitId: carrier.id, itemId: item.id, targetId: target.id };
}

export function dropItemCommand(item: WorldItem, carrier: Unit, units: readonly Unit[] = []): GameCommand {
  const ship=shipProfile(carrier) ? carrier : carrier.deck && units.find(ship=>ship.id===carrier.deck!.shipId);
  if(ship){const point=localToWorld(ship,{x:0,y:shipProfile(ship)!.beam/2+18});return{type:'dropItem',unitId:carrier.id,itemId:item.id,...point};}
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
