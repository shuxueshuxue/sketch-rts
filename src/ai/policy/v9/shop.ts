import { unitMover } from "../../../shared/catalog";
import { MAX_CARRIED_ITEMS, SHOP_REACH as BUY_REACH, carriedItemCount, shopBuyer, standsAtShop } from "../../../shared/shop";
import { AUTO_ACQUIRE_RANGE } from "../../../shared/sim";
import type { GameCommand, GameSnapshot, ItemKind, PlayerId, Shop, Unit } from "../../../shared/types";
import { resolveAiCommandIntent } from "../commands";
import { sameGroundAs } from "../ground";
import { units } from "../snapshot";
import { averagePoint, distance } from "../spatial";
import type { AiPolicyContext } from "../types";
import { enemyPowerNear, readV6Intel } from "../v6/intel";
import { v6Memory } from "../v6/memory";
import { isV9Policy } from "../versions";
import { playerState } from "../world-model";

// @@@v9-shop - V9 shops (see @@@shop), the owner's guess for how one army beats three: in a lull (no enemy army near its
// own, none in its bases) it sends one unit at a time from its army to a shop on its own ground within SHOP_REACH of the
// army that no enemy army or tower is near, nor any creep that takes on its buyer standing there (one within the sim's
// AUTO_ACQUIRE_RANGE of it: creeps killed 157 of V9's shoppers in 500 games against three, 116 of them within 100 of the
// shop, by the camp beside it), and buys there what that unit is sent for, when it is the unit standing
// nearest the shop with room (so the good is its). It buys scrolls, read in the fight (see item-tactics): a guardian
// scroll while nobody in an army of six carries one, a healing scroll while its army is worn (under WORN of its health).
// Rings and boots it leaves: over 48 of the 1v3 gauntlet's games with a shop by every start, V9 bought 4 rings and 3
// boots a game and fell a minute sooner (11.4 minutes against 12.2 without the shop); with scrolls alone it lasted 12.0.
// The gold is the economy's: an errand under way is one of V9's goals (see v6/economy shopGoals), held for at
// SHOP_PRIORITY while the unit walks, and spent when it stands at the shop; the errand ends with the purchase, or after
// ERRAND_TICKS.
export const SHOP_PRIORITY = 45;
const WORN = 0.7;
const SHOP_REACH = 900;
const SHOP_CLEARANCE = 900;
const ERRAND_TICKS = 20 * 60;

type Errand = NonNullable<ReturnType<typeof v6Memory>["shop"]>;

export function planV9Shopping(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV9Policy(options) || !snapshot.shops?.length) return [];
  const memory = v6Memory(options);
  const errand = liveErrand(snapshot, owner, memory.shop);
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
export function v9ShopErrandCost(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): number | undefined {
  if (!isV9Policy(options)) return undefined;
  const errand = liveErrand(snapshot, owner, v6Memory(options).shop);
  if (!errand) return undefined;
  return snapshot.shops?.find((shop) => shop.id === errand.shopId)?.goods.find((good) => good.kind === errand.kind)?.cost;
}

// The unit on an errand is the shop's to move until it buys.
export function v9ShopperIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  if (!isV9Policy(options) || !snapshot.shops?.length) return new Set();
  const errand = v6Memory(options).shop;
  return errand && snapshot.tick - errand.since < ERRAND_TICKS ? new Set([errand.unitId]) : new Set();
}

function liveErrand(snapshot: GameSnapshot, owner: PlayerId, errand: Errand | undefined): Errand | undefined {
  if (!errand || snapshot.tick - errand.since >= ERRAND_TICKS) return undefined;
  const shop = snapshot.shops?.find((candidate) => candidate.id === errand.shopId);
  const unit = units(snapshot, owner).find((candidate) => candidate.id === errand.unitId);
  return shop && unit ? errand : undefined;
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
  const stocked = (kind: ItemKind) => {
    const good = shop.goods.find((candidate) => candidate.kind === kind);
    return good && good.stock > 0 ? good : undefined;
  };
  const carried = (kind: ItemKind) => snapshot.items.filter((item) => item.kind === kind && army.some((unit) => unit.id === item.carrierId));
  const free = army.filter((unit) => carriedItemCount(snapshot, unit.id) < MAX_CARRIED_ITEMS);
  const nearest = (list: Unit[]) => list.sort((a, b) => distance(a, shop) - distance(b, shop))[0];
  const health = army.reduce((total, unit) => total + unit.hp, 0) / army.reduce((total, unit) => total + unit.maxHp, 0);
  if (carried("guardianScroll").length === 0 && stocked("guardianScroll") && army.length >= 6) {
    const unit = nearest(free);
    if (unit) return { shop, kind: "guardianScroll", unit };
  }
  if (health < WORN && carried("healingScroll").length === 0 && stocked("healingScroll") && army.length >= 6) {
    const unit = nearest(free.filter((candidate) => candidate.attackRange <= 100));
    if (unit) return { shop, kind: "healingScroll", unit };
  }
  return undefined;
}
