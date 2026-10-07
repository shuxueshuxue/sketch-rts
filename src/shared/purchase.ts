import { canEquip, freeItemSlot, ITEM_DEFS, shipHoldSlots, shipItemMass } from "./equipment";
import { bodyMass } from "./physical-body";
import { distanceToHull, shipProfile } from "./ship-geometry";
import type { EquipmentSlot, GameSnapshot, ItemKind, PlayerId, Unit } from "./types";
export const PURCHASE_REACH = 120;
export type PurchaseSeller = {
  x: number;
  y: number;
  radius: number;
};
export type PurchasePlacement = {
  unitId: string;
  slot: EquipmentSlot;
} | {
  shipId: string;
  slot: number;
};
type Result = {
  placement: PurchasePlacement;
} | {
  refusal: string;
};

export function purchaseRecipientInRange(unit: Unit, seller: PurchaseSeller): boolean {
  const gap = shipProfile(unit) ? distanceToHull(unit, seller) : Math.hypot(unit.x - seller.x, unit.y - seller.y) - unit.radius;
  return gap <= seller.radius + PURCHASE_REACH;
}

/** Keep an explicit choice while valid; otherwise select a nearby recipient independently of the current goods. */
export function findPurchaseRecipient(snapshot: Pick<GameSnapshot, "units">, owner: PlayerId, seller: PurchaseSeller, preferredId?: string, preferShips = false): Unit | undefined {
  const eligible = (unit: Unit) => unit.owner === owner && unit.hp > 0 && Boolean(canEquip(unit) || shipProfile(unit)) && purchaseRecipientInRange(unit, seller);
  const chosen = snapshot.units.find(unit => unit.id === preferredId && eligible(unit));
  if (chosen) return chosen;
  let best: Unit | undefined;
  let score = Infinity;
  for (const unit of snapshot.units) {
    if (!eligible(unit)) continue;
    const candidate = Math.hypot(unit.x - seller.x, unit.y - seller.y) + (preferShips && !shipProfile(unit) ? 100000 : 0);
    if (candidate < score) { best = unit; score = candidate; }
  }
  return best;
}
/** Validate delivery before money, stock or item identity changes. */
export function purchasePlacement(snapshot: Pick<GameSnapshot, "units" | "items">, owner: PlayerId, seller: PurchaseSeller, kind: ItemKind, recipientId: string): Result {
  const recipient = snapshot.units.find(unit => unit.id === recipientId && unit.hp > 0 && unit.owner === owner);
  if (!recipient)
    return { refusal: "Choose a living unit or ship of yours" };
  const profile = shipProfile(recipient);
  if (!purchaseRecipientInRange(recipient, seller))
    return { refusal: "Move the recipient closer to the seller" };
  const ship = profile ? recipient : snapshot.units.find(unit => unit.id === recipient.deck?.shipId);
  if (ship && shipProfile(ship)) {
    const load = snapshot.units.filter(unit => unit.deck?.shipId === ship.id).reduce((sum, unit) => sum + bodyMass(unit), 0) + shipItemMass(snapshot, ship);
    if (load + ITEM_DEFS[kind].mass > shipProfile(ship)!.loadCapacity)
      return { refusal: "The ship cannot carry more weight" };
  }
  if (profile) {
    const occupied = new Set(snapshot.items.filter(item => item.shipId === recipient.id && item.holdSlot !== undefined).flatMap(item => Array.from({ length: ITEM_DEFS[item.kind].span ?? 1 }, (_, i) => item.holdSlot! + i)));
    const span = ITEM_DEFS[kind].span ?? 1, slots = shipHoldSlots(recipient);
    for (let slot = 0; slot + span <= slots; slot++)
      if (Array.from({ length: span }, (_, i) => slot + i).every(i => !occupied.has(i)))
        return { placement: { shipId: recipient.id, slot } };
    return { refusal: span === 4 ? "The hold needs four consecutive free positions" : "The hold has no free position" };
  }
  if (!canEquip(recipient))
    return { refusal: "This unit cannot carry equipment" };
  const slot = freeItemSlot(snapshot, recipient, kind);
  return slot ? { placement: { unitId: recipient.id, slot } } : { refusal: "The recipient has no compatible free position" };
}
