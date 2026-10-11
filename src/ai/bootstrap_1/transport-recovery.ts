import { DOCK_REPAIR } from '../../shared/catalog';
import { nearestByRoute } from '../../shared/route-selection';
import { nearestShipPose } from '../../shared/ship-navigation';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { isTransportKind } from '../../shared/transport-role';
import { walkableGoal } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { navalServices } from '../policy/naval-services';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';

/** Finish the current crossing, then repair at a reachable port before taking another payload. */
export function transportRecovery(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const docks = snapshot.buildings.filter(dock => dock.owner === owner && dock.kind === 'shipyard' && dock.complete);
  const services = navalServices(snapshot, owner, options).reserved;
  const ids = new Set<string>(), commands: GameCommand[] = [];
  for (const boat of snapshot.units.filter(unit => unit.owner === owner && isTransportKind(unit.kind)
    && shipNeedsRepair(snapshot, unit) && !options.memory.naval?.ferries?.[unit.id] && !services.has(unit.id)
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
  return { ids, commands };
}
