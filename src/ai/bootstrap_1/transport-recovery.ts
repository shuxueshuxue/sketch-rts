import { activeMiningBaseCount } from '../policy/expansion-model';
import { DOCK_REPAIR, unitMover } from '../../shared/catalog';
import { BOARDING_GAP } from '../../shared/naval';
import { nearestByRoute } from '../../shared/route-selection';
import { distanceToHull } from '../../shared/ship-geometry';
import { nearestShipPose } from '../../shared/ship-navigation';
import { shipNeedsRepair, shipPartMax } from '../../shared/ship-equipment';
import { isTransportKind } from '../../shared/transport-role';
import { walkableGoal, walkDestination } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { navalServices } from '../policy/naval-services';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';

/** Preserve normal paid recovery. An exhausted economy with no gold delivery
 * cannot fund maintenance, so retain operational lift without inventing repairs. */
export function transportNeedsRecovery(snapshot: GameSnapshot, boat: Unit): boolean {
  if (!shipNeedsRepair(snapshot,boat)) return false;
  if ((snapshot.players[boat.owner]?.gold ?? 0) >= DOCK_REPAIR.goldPerSecond) return true;
  const max=shipPartMax(boat);
  // With neither mining nor a gold delivery left, waiting cannot pay for repair.
  // Keep the existing crossing risk checks and the real damaged ship state.
  if (activeMiningBaseCount(snapshot, boat.owner) === 0
    && !snapshot.units.some(unit => unit.owner === boat.owner && unit.carryingGold > 0)
    && boat.hp >= boat.maxHp * .75
    && (boat.shipParts?.rigging ?? max.rigging) >= max.rigging * .8
    && (boat.shipParts?.rudder ?? max.rudder) >= max.rudder * .8) return false;
  return boat.maxHp-boat.hp>DOCK_REPAIR.hpPerSecond || (boat.shipParts?.rigging ?? max.rigging)<max.rigging
    || (boat.shipParts?.rudder ?? max.rudder)<max.rudder;
}

/** Finish the current crossing, then use a reachable port when recovery is required. */
export function transportRecovery(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const docks = snapshot.buildings.filter(dock => dock.owner === owner && dock.kind === 'shipyard' && dock.complete);
  const services = navalServices(snapshot, owner, options).reserved;
  const ids = new Set<string>(), commands: GameCommand[] = [];
  for (const boat of snapshot.units.filter(unit => unit.owner === owner && isTransportKind(unit.kind)
    && transportNeedsRecovery(snapshot, unit) && !options.memory.naval?.ferries?.[unit.id] && !services.has(unit.id)
    && options.memory.naval?.outfit?.shipId !== unit.id)) {
    if (docks.some(dock => distance(boat, dock) < DOCK_REPAIR.range)) {
      ids.add(boat.id);
      if (boat.order.type !== 'idle') commands.push({ type: 'stop', unitIds: [boat.id] });
      continue;
    }
    const berths = docks.flatMap(dock => {
      const water = walkableGoal(snapshot.map, dock.x, dock.y, 'sea');
      const pose = nearestShipPose(snapshot.map, boat, water);
      return pose && distance(pose, dock) < DOCK_REPAIR.range ? [pose] : [];
    });
    const berth = nearestByRoute(snapshot.map, berths, boat, 'sea');
    if (!berth) continue;
    ids.add(boat.id);
    if (boat.order.type !== 'move' || distance(boat.order, berth) > 80)
      commands.push({ type: 'move', unitIds: [boat.id], x: berth.x, y: berth.y, avoidCombat: true });
  }
  if (!ids.size) return { ids, commands };
  const recoveringBoats = snapshot.units.filter(unit => ids.has(unit.id));
  const halls = snapshot.buildings.filter(hall => hall.owner === owner && hall.kind === 'townHall' && hall.complete);
  const foes = armedFoes(snapshot, owner, options);
  // Landed troops remain physical bodies. Clear idle, healthy bystanders before
  // the ferry's swept hull leaves; do not interrupt mining, combat or recovery.
  for (const unit of snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker'
    && unitMover(unit.kind) === 'land' && unit.expiresTick === undefined && unit.hp === unit.maxHp
    && (unit.order.type === 'idle' || unit.order.type === 'move' && unit.order.avoidCombat)
    && !options.memory.mounted?.some(job => job.unitIds.includes(unit.id)))) {
    const boat = recoveringBoats.find(boat => distanceToHull(boat, unit) <= unit.radius + BOARDING_GAP);
    if (!boat) continue;
    if (unit.order.type === 'move' && distanceToHull(boat, unit.order) > unit.radius + BOARDING_GAP) {
      ids.add(unit.id);
      continue;
    }
    const haven = halls.map(hall => walkDestination(snapshot.map, unit, hall)).filter(point =>
      distanceToHull(boat, point) > unit.radius + BOARDING_GAP).flatMap(point => {
      const ticks = safeLandTravelTicks(snapshot, unit, point, foes);
      return ticks === undefined ? [] : [{ point, ticks }];
    }).sort((a, b) => a.ticks - b.ticks)[0];
    if (!haven) continue;
    ids.add(unit.id);
    commands.push({ type: 'move', unitIds: [unit.id], ...haven.point, avoidCombat: true });
  }
  return { ids, commands };
}
