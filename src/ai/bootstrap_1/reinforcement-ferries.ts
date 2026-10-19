import { UNIT_DEFS, unitMover } from '../../shared/catalog';
import { trainingJobs } from '../../shared/building-jobs';
import { combatCapability } from '../../shared/combat-capabilities';
import { shipPassengers } from '../../shared/ship-geometry';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { sameGround, walkingDistance, walkableGoal } from '../../shared/terrain';
import { isTransportKind } from '../../shared/transport-role';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { activeUnitClaim } from '../policy/claims';
import { coastOnWater, ferryCrewTaskAvailable, landingSafe, outgunned, REINFORCEMENT_DISPATCH_SIZE, type NavalWant } from '../policy/naval';
import { navalServices } from '../policy/naval-services';
import { isOpponentOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import { readV6Intel } from '../policy/v6/intel';
import type { AiPolicyContext } from '../policy/types';
import { canSupply } from '../policy/world-model';

/** Recruit idle, unassigned home troops; a defense or recovery task keeps its people. */
export function reinforcementCrew(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, candidates: readonly Unit[], landing?: { x: number; y: number }) {
  if (readV6Intel(snapshot, owner, options).intrusion) return [];
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  const committed = new Set([...(options.memory.mounted?.flatMap(job => job.unitIds) ?? []),
    ...(options.memory.support?.unitIds ?? []), ...Object.values(options.memory.naval?.ferries ?? {}).flatMap(mission => mission.crewIds)]);
  return candidates.filter(unit => home && unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && unit.expiresTick === undefined && combatCapability(snapshot, unit).armed
    && unit.hp >= unit.maxHp * .8 && ['idle', 'hold'].includes(unit.order.type) && sameGround(snapshot.map, unit, home)
    && !committed.has(unit.id) && ferryCrewTaskAvailable(unit, options)).filter(unit => {
      const claim = activeUnitClaim(snapshot, owner, unit, options);
      if (!claim) return true;
      // An expansion on another island needs transport. Keep the objective,
      // and admit its screen only onto a crossing to that same ground.
      return (claim.kind === 'expansion' || claim.kind === 'expansionMission') && !sameGround(snapshot.map, unit, claim)
        && (!landing || sameGround(snapshot.map, claim, walkableGoal(snapshot.map, landing.x, landing.y)));
    });
}

/** Keep an actual landing reinforced instead of redispatching each empty boat to a new island. */
function reinforcementFronts(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, home: Building) {
  const friends = (other: string) => other !== 'neutral' && !isOpponentOwner(snapshot, owner, other, options);
  const homes = new Map<string, { x: number; y: number }>();
  for (const hall of snapshot.buildings.filter(building => building.kind === 'townHall' && friends(building.owner))) {
    if (!homes.has(hall.owner)) homes.set(hall.owner, hall);
  }
  return [
    ...snapshot.buildings.filter(building => building.hp > 0 && building.complete && building.kind === 'townHall'
      && friends(building.owner) && homes.get(building.owner) !== building),
    ...snapshot.units.filter(unit => unit.hp > 0 && !unit.deck && unit.expiresTick === undefined && unitMover(unit.kind) === 'land'
      && friends(unit.owner) && homes.has(unit.owner) && !sameGround(snapshot.map, unit, homes.get(unit.owner)!)),
  ].filter(front => !sameGround(snapshot.map, front, home));
}

function reinforcementRoute(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit, crew: Unit[], fronts: ReturnType<typeof reinforcementFronts>) {
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0);
  const from = coastOnWater(snapshot, [...crew].sort((a, b) => distance(a, boat) - distance(b, boat))[0]!, boat);
  if (!from) return;
  const trips = fronts.flatMap(front => {
    const to = coastOnWater(snapshot, front, boat);
    const mine = snapshot.resources.filter(mine => sameGround(snapshot.map, front, mine)).sort((a, b) => distance(a, front) - distance(b, front))[0];
    if (!to || !mine || reinforcementCrew(snapshot, owner, options, crew, to).length <= REINFORCEMENT_DISPATCH_SIZE
      || !landingSafe(snapshot, owner, options, boat, to) || outgunned(snapshot, owner, options, to, own)) return [];
    const road = walkingDistance(snapshot.map, from, to, 'sea');
    return road === undefined ? [] : [{ targetId: mine.id, to, road, base: 'complete' in front }];
  }).sort((a, b) => Number(b.base) - Number(a.base) || a.road - b.road);
  return trips[0] ? { from, ...trips[0] } : undefined;
}

export function planReinforcementFerries(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const crew = reinforcementCrew(snapshot, owner, options, snapshot.units);
  if (crew.length <= REINFORCEMENT_DISPATCH_SIZE) return;
  const naval = options.memory.naval ??= {}, ferries = naval.ferries ??= {};
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall')!;
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0);
  const fronts = reinforcementFronts(snapshot, owner, options, home);
  if (!fronts.length) return;
  const reserved = navalServices(snapshot, owner, options).reserved;
  const boats = own.filter(boat => isTransportKind(boat.kind) && !reserved.has(boat.id) && naval.outfit?.shipId !== boat.id
    && !shipNeedsRepair(snapshot, boat) && !shipPassengers(snapshot.units, boat).length
    && !snapshot.units.some(unit => unit.order.type === 'board' && unit.order.transportId === boat.id)
    && (!ferries[boat.id] || ferries[boat.id]!.purpose !== 'creep' && ferries[boat.id]!.purpose !== 'reinforce'
      && ferries[boat.id]!.phase === 'loading' && !ferries[boat.id]!.crewIds.length));
  // One boat owns this stream; let other boats keep their live cargo and jobs.
  if (Object.values(ferries).some(mission => mission.purpose === 'reinforce')) return;
  for (const boat of boats) {
    const trip = reinforcementRoute(snapshot, owner, options, boat, crew, fronts);
    if (!trip) continue;
    ferries[boat.id] = { purpose: 'reinforce', targetId: trip.targetId, from: trip.from, to: trip.to,
      phase: 'loading', crewIds: [], sinceTick: snapshot.tick, deliveries: [], returnTrips: 0 };
    break;
  }
}

/** A colony's busy settler boat cannot also collect the idle home army. Fund
 * one dedicated stream through the same route selection used at dispatch. */
export function reinforcementTransportWant(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): NavalWant | undefined {
  planReinforcementFerries(snapshot, owner, options);
  if (Object.values(options.memory.naval?.ferries ?? {}).some(mission => mission.purpose === 'reinforce')) return;
  const crew = reinforcementCrew(snapshot, owner, options, snapshot.units);
  if (crew.length <= REINFORCEMENT_DISPATCH_SIZE || !canSupply(snapshot, owner, 'transport')) return;
  const yards = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'shipyard' && building.complete);
  if (yards.some(yard => trainingJobs(yard).some(job => isTransportKind(job.unitKind)))) return;
  const yard = yards.find(yard => !yard.queue.length);
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  if (!yard || !home) return;
  const fronts = reinforcementFronts(snapshot, owner, options, home);
  const boat = snapshot.units.find(unit => unit.owner === owner && isTransportKind(unit.kind) && unit.hp > 0
    && sameGround(snapshot.map, unit, coastOnWater(snapshot, home, unit) ?? yard, 'sea'));
  if (!boat || !reinforcementRoute(snapshot, owner, options, boat, crew, fronts)) return;
  return { id: 'naval:reinforcementTransport', cost: UNIT_DEFS.transport.cost,
    issue: () => ({ type: 'train', buildingId: yard.id, unitKind: 'transport' }) };
}
