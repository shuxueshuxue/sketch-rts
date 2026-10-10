import { unitMover } from '../../shared/catalog';
import { canEquip, freeItemSlot } from '../../shared/equipment';
import { nearestByRoute } from '../../shared/route-selection';
import { standsAtShop } from '../../shared/shop';
import { walkingDistance } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { readV6Intel } from '../policy/v6/intel';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';
import { SHOP_PRIORITY, shopPurchaseAt } from '../policy/v9/shop';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';
import { lootRecoveryUnitIds } from './loot-recovery';
import { mercenaryControlUnitIds } from './mercenary-control';

function liveShopping(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const task = options.memory.shopping;
  if (!task) return undefined;
  const unit = snapshot.units.find(unit => unit.id === task.unitId && unit.owner === owner);
  const shop = snapshot.shops!.find(shop => shop.id === task.shopId);
  const home = snapshot.buildings.find(home => home.id === task.homeId && home.owner === owner && home.complete);
  if (!unit || !shop || !home || unit.deck || unit.hp < unit.maxHp * V7_WOUNDED_SHARE
    || task.returning && walkingDistance(snapshot.map, unit, home, 'land')! <= V7_GATHERED_RANGE
    || !task.returning && !shop.goods.some(good => good.kind === task.kind && good.stock > 0)
    || safeLandTravelTicks(snapshot, unit, task.returning ? home : shop, armedFoes(snapshot, owner, options)) === undefined) {
    delete options.memory.shopping;
    return undefined;
  }
  return { task, unit, shop, home };
}

function shoppingAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  if (!snapshot.shops?.length) return undefined;
  if (liveShopping(snapshot, owner, options)) return undefined;
  const intel = readV6Intel(snapshot, owner, options);
  if (intel.intrusion) return undefined;
  const halls = snapshot.buildings.filter(hall => hall.owner === owner && hall.kind === 'townHall' && hall.complete);
  const camp = options.memory.v6?.creep;
  const occupied = new Set([...lootRecoveryUnitIds(snapshot, owner, options), ...mercenaryControlUnitIds(snapshot, owner, options)]);
  const buyers = intel.army.filter(unit => !unit.deck && unit.expiresTick === undefined && unitMover(unit.kind) === 'land'
    && canEquip(unit) && unit.hp >= unit.maxHp * .7 && !options.memory.unitClaims[unit.id]
    && !camp?.group.includes(unit.id) && !options.memory.v6?.raid?.unitIds.includes(unit.id)
    && !options.memory.mounted?.some(task => task.unitIds.includes(unit.id))
    && !occupied.has(unit.id) && ['idle', 'hold', 'move', 'attackMove'].includes(unit.order.type));
  const foes = armedFoes(snapshot, owner, options);
  const towers = snapshot.buildings.filter(building => building.kind === 'defenseTower' && foes.includes(building));
  return snapshot.shops!.flatMap(shop => buyers.flatMap(unit => {
    const purchase = shopPurchaseAt(snapshot, owner, shop, intel.army, [unit], towers);
    if (!purchase || !freeItemSlot(snapshot, unit, purchase.kind)) return [];
    const ticks = safeLandTravelTicks(snapshot, unit, shop, foes), home = nearestByRoute(snapshot.map, halls, unit, 'land');
    return ticks === undefined || !home ? [] : [{ ...purchase, ticks, home }];
  })).sort((a, b) => b.unit.level - a.unit.level || a.ticks - b.ticks || a.unit.id.localeCompare(b.unit.id))[0];
}

export function shoppingUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const unit = liveShopping(snapshot, owner, options)?.unit ?? shoppingAssignment(snapshot, owner, options)?.unit;
  return new Set(unit ? [unit.id] : []);
}

/** One shop mission shares the ordinary goal ledger with recruitment and construction. */
export function shoppingGoals(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const active = liveShopping(snapshot, owner, options);
  if (active?.task.returning) return [];
  const next = active ? { ...active, kind: active.task.kind } : shoppingAssignment(snapshot, owner, options);
  if (!next) return [];
  const good = next.shop.goods.find(good => good.kind === next.kind)!;
  const ready = !!active && standsAtShop(next.unit, next.shop) && !!freeItemSlot(snapshot, next.unit, next.kind);
  return [{ id: 'shopping', priority: ready ? 64 : SHOP_PRIORITY, cost: good.cost, save: true,
    ...(ready ? {} : { hold: true as const }),
    issue: (): GameCommand | undefined => {
      if (!ready) return undefined;
      active!.task.returning = true;
      return { type: 'buy', shopId: next.shop.id, item: next.kind, recipientId: next.unit.id };
    } }];
}

export const shopping: AiScript = {
  id: 'shopping', phase: 'tactics', claimsUnits: shoppingUnitIds,
  run: (snapshot, owner, options): GameCommand[] => {
    let active = liveShopping(snapshot, owner, options);
    if (!active) {
      const next = shoppingAssignment(snapshot, owner, options);
      if (!next) return [];
      options.memory.shopping = { unitId: next.unit.id, shopId: next.shop.id, kind: next.kind, homeId: next.home.id, returning: false };
      active = { task: options.memory.shopping, ...next };
    }
    const point = active.task.returning ? active.home : active.shop, { unit } = active;
    return unit.order.type === 'move' && unit.order.avoidCombat && unit.order.x === point.x && unit.order.y === point.y ? []
      : [{ type: 'move', unitIds: [unit.id], x: point.x, y: point.y, avoidCombat: true }];
  },
};
