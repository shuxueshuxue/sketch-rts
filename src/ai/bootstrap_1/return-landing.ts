import { landingSpot } from '../../shared/naval';
import { shipPassengers, distanceToHull } from '../../shared/ship-geometry';
import { sameGround } from '../../shared/terrain';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';
import type { GameSnapshot, PlayerId, GameCommand, Unit } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';

const helmCommands = new Set(['move', 'unload', 'stop', 'holdPosition', 'attackMove', 'attack', 'follow']);

/** Reject native return landings inside another hull. Stop before choosing the
 * idle helm landing, then issue one public portrait command per decision. */
export function preventHullLanding(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, planned: GameCommand[]) {
  let result = planned;
  for (const ship of snapshot.units) {
    if (ship.owner !== owner || !ship.sailing) continue;
    const job = options.memory.naval?.ferries?.[ship.id];
    if (job?.phase !== 'return' || job.purpose !== 'settle') continue;
    // Emergency sailing already has priority over this local unloading task.
    if (planned.some(command => command.type === 'move' && command.unitIds.includes(ship.id))) continue;
    const cargo = shipPassengers(snapshot.units, ship);
    if (!cargo.length) continue;
    const returnPose: Unit = { ...ship, order: { type: 'unload', x: job.from.x, y: job.from.y } };
    const overlaps = (point: { x: number; y: number }, passenger: Unit) => snapshot.units.some(other =>
      other.sailing && other.id !== ship.id && distanceToHull(other, point) < passenger.radius + 1);
    if (!cargo.some((passenger, index) => {
      const point = landingSpot(snapshot.map, returnPose, index, cargo.length, snapshot.units, passenger);
      return point && overlaps(point, passenger);
    })) continue;

    result = result.flatMap((command): GameCommand[] => {
      if (command.type === 'unloadPassenger' && command.transportId === ship.id) return [];
      if ('unitIds' in command && helmCommands.has(command.type) && command.unitIds.includes(ship.id)) {
        const unitIds = command.unitIds.filter(id => id !== ship.id);
        return unitIds.length ? [{ ...command, unitIds }] : [];
      }
      return [command];
    });
    // Stopping changes the native preferred landing. Observe that actual state
    // on the next decision instead of predicting simultaneous stop/unload effects.
    if (ship.order.type !== 'idle') {
      result.push({ type: 'stop', unitIds: [ship.id] });
      continue;
    }
    const foes = armedFoes(snapshot, owner, options);
    for (let index = 0; index < cargo.length; index++) {
      const passenger = cargo[index]!;
      if (passenger.owner !== owner || passenger.cabin) continue;
      const point = landingSpot(snapshot.map, ship, index, cargo.length, snapshot.units, passenger);
      if (!point || overlaps(point, passenger)) continue;
      const canReturnHome = snapshot.buildings.some(hall => hall.owner === owner && hall.kind === 'townHall'
        && hall.complete && hall.hp > 0 && Math.hypot(hall.x - point.x, hall.y - point.y) < 850
        && sameGround(snapshot.map, point, hall)
        && safeLandTravelTicks(snapshot, { ...passenger, ...point, deck: undefined, cabin: undefined }, hall, foes) !== undefined);
      if (!canReturnHome) continue;
      result.push({ type: 'unloadPassenger', transportId: ship.id, passengerId: passenger.id });
      break;
    }
  }
  return result;
}
