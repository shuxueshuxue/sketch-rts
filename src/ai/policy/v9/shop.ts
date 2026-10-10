import { seconds } from "../../../shared/time";
import { canReceiveHealing } from "../../../shared/healing";
import { isOpponentOwner } from "../ownership";
import { unitMover } from "../../../shared/catalog";
import { MAX_CARRIED_ITEMS, SHOP_REACH as BUY_REACH, carriedItemCount, shopBuyer, standsAtShop } from "../../../shared/shop";
import { AUTO_ACQUIRE_RANGE } from "../../../shared/sim";
import type { Building, GameCommand, GameSnapshot, ItemKind, PlayerId, Shop, Unit } from "../../../shared/types";
import { resolveAiCommandIntent } from "../commands";
import { sameGroundAs } from "../ground";
import { units } from "../snapshot";
import { averagePoint, distance } from "../spatial";
import type { AiPolicyContext } from "../types";
import { enemyPowerNear, readV6Intel } from "../v6/intel";
import { v6Memory } from "../v6/memory";
import { isV5HybridPolicy } from "../versions";
import { playerState } from "../world-model";

// The V9 shop errand is shared by the humanized V5/V7/V8 stacks: one safe shopper in a lull, a reserved
// purchase budget, and cancellation when danger appears. Scrolls serve the army; gear serves a bounded specialist.
export const SHOP_PRIORITY = 45;
const WORN = 0.7;
const SHOP_REACH = 900;
const SHOP_CLEARANCE = 900;
const ERRAND_TICKS = seconds(60);

type Errand = NonNullable<ReturnType<typeof v6Memory>["shop"]>;

export function planArmyShopping(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV5HybridPolicy(options) || !snapshot.shops?.length) return [];
  const memory = v6Memory(options);
  const errand = liveErrand(snapshot, owner, memory.shop, options);
  if (!errand) delete memory.shop;
  if (errand) {
    const shop = snapshot.shops.find((candidate) => candidate.id === errand.shopId)!;
    const unit = units(snapshot, owner).find((candidate) => candidate.id === errand.unitId)!;
    if (standsAtShop(unit, shop)) {
      const good = shop.goods.find((candidate) => candidate.kind === errand.kind);
      // Waiting at the shop for the gold the economy holds for it.
      if (good && good.stock > 0 && playerState(snapshot, owner).gold < good.cost) return [];
      delete memory.shop;
      if (!good || good.stock <= 0 || shopBuyer(snapshot, owner, shop)?.id !== unit.id) return [];
      return [{ type: "buy", shopId: shop.id, item: errand.kind }];
    }
    return unit.order.type === "move" && unit.order.x === shop.x && unit.order.y === shop.y ? [] : [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x: shop.x, y: shop.y }, options)];
  }
  const next = nextPurchase(snapshot, owner, options);
  if (!next) return [];
  memory.shop = { shopId: next.shop.id, kind: next.kind, unitId: next.unit.id, since: snapshot.tick };
  return [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [next.unit.id], x: next.shop.x, y: next.shop.y }, options)];
}

// What the errand under way costs, for the economy to hold (see v6/economy shopGoals).
export function shopErrandCost(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): number | undefined {
  if (!isV5HybridPolicy(options)) return undefined;
  const errand = liveErrand(snapshot, owner, v6Memory(options).shop, options);
  if (!errand) return undefined;
  return snapshot.shops?.find((shop) => shop.id === errand.shopId)?.goods.find((good) => good.kind === errand.kind)?.cost;
}

// The unit on an errand is the shop's to move until it buys.
export function shopperIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  if (!isV5HybridPolicy(options) || !snapshot.shops?.length) return new Set();
  const errand = liveErrand(snapshot, owner, v6Memory(options).shop, options);
  return errand ? new Set([errand.unitId]) : new Set();
}

function liveErrand(snapshot: GameSnapshot, owner: PlayerId, errand: Errand | undefined, options: AiPolicyContext): Errand | undefined {
  if (!errand || snapshot.tick - errand.since >= ERRAND_TICKS) return undefined;
  const shop = snapshot.shops?.find((candidate) => candidate.id === errand.shopId);
  const unit = units(snapshot, owner).find((candidate) => candidate.id === errand.unitId);
  if (!shop || !unit) return undefined;
  const enemies = snapshot.units.filter(enemy => enemy.kind !== "worker" && enemy.attackDamage > 0 && isOpponentOwner(snapshot, owner, enemy.owner, options));
  if (enemies.some(enemy => distance(enemy, unit) < 600 || distance(enemy, shop) < 600
    || snapshot.buildings.some(base => base.owner === owner && base.kind === "townHall" && distance(base, enemy) < 700))) return undefined;
  return errand;
}

function nextPurchase(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): { shop: Shop; kind: ItemKind; unit: Unit } | undefined {
  const intel = readV6Intel(snapshot, owner, options);
  const army = intel.army.filter((unit) => unit.kind !== "worker" && unitMover(unit.kind) === "land" && unit.expiresTick === undefined);
  if (army.length === 0) return undefined;
  const center = intel.armyCenter ?? averagePoint(army);
  // Only in a lull: no enemy army near its own, none in its bases.
  if (intel.intrusion || enemyPowerNear(intel, center, SHOP_CLEARANCE) > 0) return undefined;
  const towers = snapshot.buildings.filter((building) => building.kind === "defenseTower" && building.owner !== owner && intel.enemies.some((enemy) => enemy.owner === building.owner));
  const creeps = snapshot.units.filter((unit) => unit.owner === "neutral" && unit.attackDamage > 0);
  const shop = snapshot.shops!
    .filter((candidate) => sameGroundAs(snapshot, intel.home, candidate) && distance(candidate, center) <= SHOP_REACH)
    .filter((candidate) => enemyPowerNear(intel, candidate, SHOP_CLEARANCE) === 0 && !towers.some((tower) => distance(tower, candidate) <= tower.attackRange + 120))
    .filter((candidate) => creeps.every((creep) => distance(creep, candidate) > candidate.radius + BUY_REACH + AUTO_ACQUIRE_RANGE))
    .sort((a, b) => distance(a, center) - distance(b, center))[0];
  if (!shop) return undefined;
  return shopPurchaseAt(snapshot, owner, shop, army, army, towers);
}

/** Purchase intent is independent of shop location and travel ownership. */
export function shopPurchaseAt(snapshot: GameSnapshot, owner: PlayerId, shop: Shop, army: readonly Unit[], buyers: readonly Unit[], towers: readonly Building[]): { shop: Shop; kind: ItemKind; unit: Unit } | undefined {
  const stocked = (kind: ItemKind) => {
    const good = shop.goods.find((candidate) => candidate.kind === kind);
    return good && good.stock > 0 ? good : undefined;
  };
  const carried = (kind: ItemKind) => snapshot.items.filter((item) => item.kind === kind && army.some((unit) => unit.id === item.carrierId));
  const free = buyers.filter((unit) => carriedItemCount(snapshot, unit.id) < MAX_CARRIED_ITEMS);
  const nearest = (list: Unit[]) => list.sort((a, b) => distance(a, shop) - distance(b, shop))[0];
  const healable = army.filter((unit) => canReceiveHealing(unit, snapshot));
  const health = healable.reduce((total, unit) => total + unit.hp, 0) / Math.max(1, healable.reduce((total, unit) => total + unit.maxHp, 0));
  if (carried("guardianScroll").length === 0 && stocked("guardianScroll") && army.length >= 6) {
    const unit = nearest(free);
    if (unit) return { shop, kind: "guardianScroll", unit };
  }
  if (health < WORN && carried("healingScroll").length === 0 && stocked("healingScroll") && healable.length >= 6) {
    const unit = nearest(free.filter((candidate) => candidate.attackRange <= 100));
    if (unit) return { shop, kind: "healingScroll", unit };
  }
  if (playerState(snapshot, owner).gold >= 500 && army.length >= 8) {
    if (!carried("speedBoots").length && stocked("speedBoots")) {
      const unit = nearest(free.filter(unit => unit.speed >= 70 && unit.attackRange <= 100));
      if (unit) return { shop, kind: "speedBoots", unit };
    }
    if (!carried("regenRing").length && stocked("regenRing")) {
      const unit = nearest(free.filter(unit => canReceiveHealing(unit, snapshot) && unit.level > 0 && unit.hp < unit.maxHp * .85));
      if (unit) return { shop, kind: "regenRing", unit };
    }
    if (!carried("ivoryTower").length && stocked("ivoryTower") && towers.length > 0) {
      const unit = nearest(free.filter(unit => unit.hp >= unit.maxHp * .7 && unit.attackRange <= 100));
      if (unit) return { shop, kind: "ivoryTower", unit };
    }
  }
  return undefined;
}
