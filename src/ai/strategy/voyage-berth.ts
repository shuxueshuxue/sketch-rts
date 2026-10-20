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
  const person = { ...passenger };
  delete person.deck; delete person.cabin;
  const ship = { ...hull, x: candidate.water.x, y: candidate.water.y };
  shareShipProfile(hull, ship);
  let ground = candidate.ground;
  // A returned touch point can itself be projected by a native move order.
  // Settle that projection before publishing: the execution contract is a
  // passenger at this legal ground point and a hull at this water pose.
  for (let attempt = 0; attempt < 4; attempt++) {
    const legal = walkableGoal(snapshot.map, ground.x, ground.y, 'land');
    person.x = legal.x; person.y = legal.y;
    const berth = boardingBerth(snapshot.map, person, ship);
    if (!berth || !berth.shore || typeof berth.heading !== 'number' || landIdAt(snapshot.map, berth.shore) !== candidate.landId
      || seaIdAt(snapshot.map, berth) !== candidate.seaId || !hullFits(snapshot.map, ship, { ...berth, heading: berth.heading }))
      return { status: 'static-infeasible' as const, reasonCode: 'no-native-boarding-berth-on-required-ground' };
    if (berth.shore.x === legal.x && berth.shore.y === legal.y && berth.x === ship.x && berth.y === ship.y)
      return { status: 'known' as const, heading: berth.heading, shore: { landId: candidate.landId, seaId: candidate.seaId,
        ground: { x: legal.x, y: legal.y }, water: { x: berth.x, y: berth.y } } satisfies Shore };
    ground = berth.shore; ship.x = berth.x; ship.y = berth.y;
    ship.sailing = { ...ship.sailing!, heading: berth.heading };
  }
  return { status: 'static-infeasible' as const, reasonCode: 'native-boarding-rendezvous-not-stable' };
}
