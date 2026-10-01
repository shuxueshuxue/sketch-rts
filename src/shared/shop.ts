import { unitMover } from "./catalog";
import { seconds } from "./time";
import type { GameSnapshot, ItemKind, PlayerId, Shop, Unit } from "./types";

// @@@shop-goods - What a shop sells, at the owner's prices (10-01): each a little worse for its gold than what it stands in
// for, so a shop is worth a walk and never the whole plan. Boots take one unit a fifth faster (mobility training takes
// the whole army a tenth faster a level); a ring heals its carrier 2 a second (a moon well heals every hurt unit round
// it 3.3); a healing scroll heals every friend within HEALING_SCROLL_RADIUS by HEALING_SCROLL_HEAL at once; the guardian
// scroll is the one camps drop; an ivory tower raises a defense tower at half its health where its carrier stands.
export const SHOP_GOODS: readonly { kind: ItemKind; cost: number; maxStock: number; restock: number }[] = [
  { kind: "speedBoots", cost: 100, maxStock: 1, restock: seconds(90) },
  { kind: "regenRing", cost: 75, maxStock: 1, restock: seconds(90) },
  { kind: "healingScroll", cost: 100, maxStock: 2, restock: seconds(45) },
  { kind: "guardianScroll", cost: 200, maxStock: 1, restock: seconds(120) },
  { kind: "ivoryTower", cost: 200, maxStock: 1, restock: seconds(120) },
];
export const BOOTS_SPEED = 1.2;
export const RING_REGEN_PER_SECOND = 2;
export const HEALING_SCROLL_RADIUS = 300;
export const HEALING_SCROLL_HEAL = 75;
// An ivory tower stands within this of its carrier.
export const IVORY_TOWER_REACH = 200;

export const SHOP_RADIUS = 40;
// A unit buys standing this near the shop's edge.
export const SHOP_REACH = 120;
// @@@carried-items - What one unit carries at most, a worker as much as a knight (the owner: 「别看不起人民群众！」): it
// buys, picks up and is handed nothing more.
export const MAX_CARRIED_ITEMS = 6;

export function createShop(id: string, x: number, y: number): Shop {
  return { id, x, y, radius: SHOP_RADIUS, goods: SHOP_GOODS.map((good) => ({ ...good, stock: good.maxStock, restockRemaining: 0 })) };
}

export function carriedItemCount(snapshot: Pick<GameSnapshot, "items">, unitId: string) {
  let count = 0;
  for (const item of snapshot.items) if (item.carrierId === unitId) count += 1;
  return count;
}

// Whether the unit stands near enough the shop to buy there; a ship never does (it carries nothing).
export function standsAtShop(unit: Unit, shop: Shop) {
  return unitMover(unit.kind) === "land" && Math.hypot(unit.x - shop.x, unit.y - shop.y) <= shop.radius + unit.radius + SHOP_REACH;
}

// Who takes what the owner buys: its unit standing at the shop with room for one more, nearest the shop; when none has
// room, nobody (the good is left at the shop's door).
export function shopBuyer(snapshot: Pick<GameSnapshot, "units" | "items">, owner: PlayerId, shop: Shop): Unit | undefined {
  let best: Unit | undefined;
  let bestGap = Infinity;
  for (const unit of snapshot.units) {
    if (unit.owner !== owner || !standsAtShop(unit, shop) || carriedItemCount(snapshot, unit.id) >= MAX_CARRIED_ITEMS) continue;
    const gap = Math.hypot(unit.x - shop.x, unit.y - shop.y);
    if (gap < bestGap) {
      best = unit;
      bestGap = gap;
    }
  }
  return best;
}

// Why the owner may not buy the good at the shop now (transient when only waiting fixes it), or undefined.
export function buyRefusal(snapshot: Pick<GameSnapshot, "shops" | "units" | "players">, owner: PlayerId, shopId: string, kind: ItemKind): { message: string; transient: boolean } | undefined {
  const shop = snapshot.shops?.find((candidate) => candidate.id === shopId);
  if (!shop) return { message: `Unknown shop ${shopId}`, transient: false };
  const good = shop.goods.find((candidate) => candidate.kind === kind);
  if (!good) return { message: `${shop.id} sells no ${kind}`, transient: false };
  if (good.stock <= 0) return { message: `${shop.id} is out of ${kind}`, transient: true };
  if (!snapshot.units.some((unit) => unit.owner === owner && standsAtShop(unit, shop))) return { message: `${shop.id} needs a unit of yours beside it`, transient: true };
  if ((snapshot.players[owner]?.gold ?? 0) < good.cost) return { message: `Need ${good.cost} gold`, transient: true };
  return undefined;
}

// A tick of the shops: every good short of its stock comes back one at a time, `restock` ticks apart.
export function restockShops(shops: Shop[]) {
  for (const shop of shops) {
    for (const good of shop.goods) {
      if (good.stock >= good.maxStock) continue;
      good.restockRemaining -= 1;
      if (good.restockRemaining > 0) continue;
      good.stock += 1;
      good.restockRemaining = good.stock < good.maxStock ? good.restock : 0;
    }
  }
}
