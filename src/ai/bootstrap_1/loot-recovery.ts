import { unitMover } from '../../shared/catalog';
import { canEquip, freeItemSlot } from '../../shared/equipment';
import { nearestByRoute } from '../../shared/route-selection';
import { walkingDistance } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { itemCarrierScore, planItemCommands } from '../policy/item-tactics';
import { neutralUnitsNear } from '../policy/snapshot';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';

function liveLootTask(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const task = options.memory.loot;
  if (!task) return undefined;
  const unit = snapshot.units.find(candidate => candidate.id === task.unitId && candidate.owner === owner);
  const home = snapshot.buildings.find(candidate => candidate.id === task.homeId && candidate.owner === owner && candidate.complete);
  const item = snapshot.items.find(candidate => candidate.id === task.itemId);
  const collected = !item || !!item.carrierId || !!item.shipId;
  // Death, a lost base, boarding or injury hands the unit back to its ordinary commander.
  if (!unit || !home || unit.deck || unit.hp < unit.maxHp
    || collected && unit.order.type !== 'pickupItem' && walkingDistance(snapshot.map, unit, home, 'land')! <= V7_GATHERED_RANGE) {
    delete options.memory.loot;
    return undefined;
  }
  return { task, unit, home };
}

function lootAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const halls = snapshot.buildings.filter(hall => hall.owner === owner && hall.kind === 'townHall' && hall.complete);
  if (liveLootTask(snapshot, owner, options)) return [];
  const camp = options.memory.v6?.creep;
  const engaged = camp !== undefined && neutralUnitsNear(snapshot, camp.center, camp.reach).length > 0;
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && !unit.deck
    && unit.expiresTick === undefined && unitMover(unit.kind) === 'land' && unit.hp === unit.maxHp && canEquip(unit)
    && !options.memory.unitClaims[unit.id]
    && !(engaged && camp!.group.includes(unit.id)) && !options.memory.v6?.raid?.unitIds.includes(unit.id)
    && !options.memory.mounted?.some(task => task.unitIds.includes(unit.id))
    && ['idle', 'hold', 'move', 'attackMove'].includes(unit.order.type));
  const foes = armedFoes(snapshot, owner, options);
  return snapshot.items.filter(item => !item.carrierId && !item.shipId).flatMap(item => own.flatMap(unit => {
    if (!freeItemSlot(snapshot, unit, item.kind)) return [];
    const score = itemCarrierScore(unit, item, options);
    if (score <= 0) return [];
    const home = nearestByRoute(snapshot.map, halls, unit, 'land');
    if (!home) return [];
    const ticks = safeLandTravelTicks(snapshot, unit, item, foes);
    const veteran = item.kind === 'experienceBook' ? unit.level : 0;
    return ticks === undefined ? [] : [{ unit, item, home, ticks, score, veteran }];
  })).sort((a, b) => b.veteran - a.veteran || b.score - a.score || a.ticks - b.ticks || a.unit.id.localeCompare(b.unit.id)).slice(0, 1);
}

export function lootRecoveryUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const active = liveLootTask(snapshot, owner, options);
  return new Set(active ? [active.unit.id] : lootAssignments(snapshot, owner, options).map(({ unit }) => unit.id));
}

/** Experience books belong to deliberate training; local pickups respect all other assigned loot. */
export function planLootItemCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const items = snapshot.items.filter(item => item.carrierId || item.shipId
    || item.kind !== 'experienceBook' && item.id !== options.memory.loot?.itemId);
  return planItemCommands({ ...snapshot, items }, owner, options);
}

/** The normal command queue preserves the return trip even after an experience book is consumed. */
export const lootRecovery: AiScript = {
  id: 'lootRecovery', phase: 'tactics', claimsUnits: lootRecoveryUnitIds,
  run: (snapshot, owner, options): GameCommand[] => {
    if (liveLootTask(snapshot, owner, options)) return [];
    return lootAssignments(snapshot, owner, options).flatMap(({ unit, item, home }) => {
      options.memory.loot = { unitId: unit.id, itemId: item.id, homeId: home.id };
      return [{ type: 'pickupItem', unitId: unit.id, itemId: item.id },
        { type: 'move', unitIds: [unit.id], x: home.x, y: home.y, avoidCombat: true, queued: true }];
    });
  },
};
