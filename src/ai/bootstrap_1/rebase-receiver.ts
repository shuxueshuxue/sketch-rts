import { GOLD_MINE_RULES } from '../../shared/mining';
import { landingSpot } from '../../shared/naval';
import { shipPassengers } from '../../shared/ship-geometry';
import { nearestShipPose } from '../../shared/ship-navigation';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';

/** A workforce transfer needs a receiving income and a safe native landing road.
 * Check before entering the coast, while the ordinary return is still possible. */
export function rebaseReceiverSafe(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit,
  targetId: string, coast: { x: number; y: number }) {
  const mine = snapshot.resources.find(mine => mine.id === targetId);
  if (!mine || mine.amount <= 0) return false;
  const halls = snapshot.buildings.filter(hall => hall.owner === owner && hall.kind === 'townHall'
    && Math.hypot(hall.x - mine.x, hall.y - mine.y) < GOLD_MINE_RULES.baseRange);
  if (!halls.length) return false;
  const cargo = shipPassengers(snapshot.units, boat), workers = cargo.filter(unit => unit.owner === owner && unit.kind === 'worker');
  if (!workers.length) return true;
  const pose = nearestShipPose(snapshot.map, boat, coast);
  if (!pose || !boat.sailing) return false;
  const hull = { ...boat, x: pose.x, y: pose.y, sailing: { ...boat.sailing, heading: pose.heading } };
  const foes = armedFoes(snapshot, owner, options);
  return workers.every(worker => {
    const spot = landingSpot(snapshot.map, hull, cargo.indexOf(worker), cargo.length, snapshot.units, worker);
    return spot && halls.some(hall => sameGround(snapshot.map, spot, hall)
      && safeLandTravelTicks(snapshot, { ...worker, ...spot, deck: undefined, cabin: undefined }, hall, foes) !== undefined);
  });
}
