import { MAX_UPGRADE_LEVEL, XP_STAR_THRESHOLDS } from "../../shared/catalog";
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit, WorldItem } from "../../shared/types";
import { resolveAiCommandIntent } from "./commands";
import { carriedItemsFor, combatUnits, enemyBuildingsNear, groundItems, hostileUnitsNear, items, units } from "./snapshot";
import { distance, nearestEntities, nearestEntity } from "./spatial";
import type { PresetAiPolicyOptions } from "./types";
import { isCoreProductionBuilding, mainBase } from "./world-model";

const GUARDIAN_SCROLL_THREAT_RANGE = 380;
const GUARDIAN_SCROLL_CONTACT_RANGE = 300;

export function planItemCommands(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const commands: GameCommand[] = [];
  const ownUnits = units(snapshot, owner);
  const ownCombat = ownUnits.filter((unit) => unit.kind !== "worker");

  for (const item of carriedItemsFor(snapshot, owner).filter((candidate) => candidate.cooldownRemaining === 0)) {
    const carrier = ownUnits.find((unit) => unit.id === item.carrierId);
    if (!carrier) continue;
    const command = itemUseCommand(snapshot, owner, carrier, item, options);
    if (command) commands.push(command);
  }

  for (const item of nearestEntities(groundItems(snapshot), mainBase(snapshot, owner))) {
    const carrier = bestItemCarrier(snapshot, owner, item, options);
    if (!carrier) continue;
    commands.push(resolveAiCommandIntent(snapshot, owner, { type: "pickupItem", unitId: carrier.id, itemId: item.id }, options));
    if (commands.length >= Math.max(1, Math.min(2, ownCombat.length))) break;
  }
  return commands;
}

function itemUseCommand(snapshot: GameSnapshot, owner: PlayerId, carrier: Unit, item: WorldItem, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (item.kind === "experienceBook") return resolveAiCommandIntent(snapshot, owner, { type: "useItem", unitId: carrier.id, itemId: item.id }, options);
  if (item.kind === "breachCharge") {
    const target = breachChargeTarget(snapshot, owner, carrier, options);
    return target ? resolveAiCommandIntent(snapshot, owner, { type: "useItem", unitId: carrier.id, itemId: item.id, targetId: target.id }, options) : undefined;
  }
  if (item.kind === "guardianScroll") {
    const allies = combatUnits(snapshot, owner).filter((unit) => distance(unit, carrier) <= 260);
    const contactEnemies = hostileUnitsNear(snapshot, owner, carrier, GUARDIAN_SCROLL_CONTACT_RANGE, options.teams);
    // @@@guardian-precast - Outnumbered ranged fights are decided before melee contact; advantage armies should not get a free early snowball shield.
    const threatEnemies = hostileUnitsNear(snapshot, owner, carrier, GUARDIAN_SCROLL_THREAT_RANGE, options.teams);
    const outnumbered = combatUnits(snapshot, owner).length < hostileUnitsNear(snapshot, owner, carrier, 900, options.teams).length;
    const backlineCarrier = carrier.attackRange > 100;
    const contactFight = contactEnemies.length >= 3;
    const rangedBurstWindow = backlineCarrier && outnumbered && threatEnemies.length >= 3;
    return allies.length >= 4 && (contactFight || rangedBurstWindow) ? resolveAiCommandIntent(snapshot, owner, { type: "useItem", unitId: carrier.id, itemId: item.id }, options) : undefined;
  }
  const range = item.kind === "stormStaff" ? 320 : 280;
  const hostileTargets = hostileUnitsNear(snapshot, owner, carrier, range, options.teams);
  // @@@item-real-target - Burst items should not spend their first hit on temporary summons while real combat units are available.
  const target = nearestEntity(hostileTargets.filter((unit) => unit.kind !== "spirit"), carrier) ?? nearestEntity(hostileTargets, carrier);
  if (!target) return undefined;
  if (item.kind === "stormStaff") return resolveAiCommandIntent(snapshot, owner, { type: "useItem", unitId: carrier.id, itemId: item.id, x: target.x, y: target.y }, options);
  if (item.kind === "lightningRod") return resolveAiCommandIntent(snapshot, owner, { type: "useItem", unitId: carrier.id, itemId: item.id, targetId: target.id }, options);
  return undefined;
}

function breachChargeTarget(snapshot: GameSnapshot, owner: PlayerId, carrier: Unit, options: PresetAiPolicyOptions) {
  return enemyBuildingsNear(snapshot, owner, carrier, 280, options.teams)
    .sort((a, b) => breachChargeTargetScore(b, carrier) - breachChargeTargetScore(a, carrier))[0];
}

function breachChargeTargetScore(building: Building, carrier: Unit) {
  const productionBonus = isCoreProductionBuilding(building) ? 180 : 0;
  const towerBonus = building.kind === "defenseTower" ? 130 : 0;
  const woundedBonus = (1 - building.hp / Math.max(1, building.maxHp)) * 80;
  const townHallPenalty = building.kind === "townHall" ? 120 : 0;
  return productionBonus + towerBonus + woundedBonus - townHallPenalty - distance(building, carrier) / 8;
}

function bestItemCarrier(snapshot: GameSnapshot, owner: PlayerId, item: WorldItem, options: PresetAiPolicyOptions): Unit | undefined {
  const occupiedCarrierIds = new Set(items(snapshot).flatMap((candidate) => (candidate.carrierId ? [candidate.carrierId] : [])));
  return units(snapshot, owner)
    .filter((unit) => unit.kind !== "worker")
    .filter((unit) => !occupiedCarrierIds.has(unit.id))
    .filter((unit) => distance(unit, item) <= 72)
    .sort((a, b) => itemCarrierScore(b, item, options) - itemCarrierScore(a, item, options))[0];
}

function itemCarrierScore(unit: Unit, item: WorldItem, options: PresetAiPolicyOptions) {
  const health = unit.hp / Math.max(1, unit.maxHp);
  const melee = unit.attackRange <= 80 ? 1 : 0;
  const ranged = unit.attackRange > 100 ? 1 : 0;
  const star = unit.level;
  const durable = unit.maxHp / 100;
  const v2Bonus = options.version === "v2" ? 1 : 0;
  if (item.kind === "flameCloak") return durable * 7 + melee * 18 + star * (6 + v2Bonus * 4) + health * 5 - unit.attackRange / 80;
  if (item.kind === "experienceBook") return experienceBookCarrierScore(unit, durable);
  if (item.kind === "lightningRod" || item.kind === "stormStaff") return ranged * 14 + unit.attackRange / 14 + star * 3 + health * 3;
  if (item.kind === "breachCharge") return durable * 4 + melee * 8 + unit.speed * 3 + health * 3;
  if (item.kind === "guardianScroll") return durable * 6 + melee * 6 + health * 5;
  return 0;
}

function experienceBookCarrierScore(unit: Unit, durable: number) {
  if (unit.level >= MAX_UPGRADE_LEVEL) return -10_000 + unit.attackDamage * 0.1;
  const nextThreshold = XP_STAR_THRESHOLDS[unit.level] ?? Number.POSITIVE_INFINITY;
  const xpNeeded = Math.max(0, nextThreshold - unit.xp);
  const bookXp = 160;
  const willLevel = xpNeeded <= bookXp ? 1 : 0;
  // @@@veteran-book-feed - An experience book that can push an existing veteran over the next star is core-army investment, not generic stat optimization.
  const veteranCarry = willLevel * unit.level * 28;
  return willLevel * 90 + veteranCarry + Math.max(0, bookXp - xpNeeded) * 0.4 + unit.attackDamage * 1.2 + durable * 2;
}
