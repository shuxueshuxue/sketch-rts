import { boardingBerth } from '../../shared/naval';
import { hullFits } from '../../shared/ship-navigation';
import { shareShipProfile } from '../../shared/ship-geometry';
import { setBuildingBodies, walkableGoal } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot, Unit } from '../../shared/types';
import { landIdAt, seaIdAt, type Shore } from './regions';

/** The same berth solver used by native board orders. The shore is a coarse
 * candidate only; its water-cell centre is never authority to place a hull
 * inside a yard. No mobile traffic or future enemy movement is invented here. */
export function nativeVoyageBerth(snapshot: GameSnapshot, passenger: Unit, hull: Unit, candidate: Shore) {
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const ground = walkableGoal(snapshot.map, candidate.ground.x, candidate.ground.y, 'land');
  const person = { ...passenger, x: ground.x, y: ground.y };
  delete person.deck; delete person.cabin;
  const ship = { ...hull, x: candidate.water.x, y: candidate.water.y };
  shareShipProfile(hull, ship);
  const berth = boardingBerth(snapshot.map, person, ship);
  if (!berth || !berth.shore || typeof berth.heading !== 'number' || landIdAt(snapshot.map, berth.shore) !== candidate.landId
    || seaIdAt(snapshot.map, berth) !== candidate.seaId || !hullFits(snapshot.map, ship, { ...berth, heading: berth.heading }))
    return { status: 'static-infeasible' as const, reasonCode: 'no-native-boarding-berth-on-required-ground' };
  return { status: 'known' as const, heading: berth.heading, shore: { landId: candidate.landId, seaId: candidate.seaId,
    ground: berth.shore, water: { x: berth.x, y: berth.y } } satisfies Shore };
}
