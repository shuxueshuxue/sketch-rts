import { shipPassengers } from '../../shared/ship-geometry';
import { isTransportKind } from '../../shared/transport-role';
import { transportNeedsRecovery } from './transport-recovery';
import { routeArrivals, routeTravelTicks } from '../../shared/route-selection';
import { sameGround, walkingDistance, walkableGoal } from '../../shared/terrain';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { assaultExpedition, coastOnWater } from '../policy/naval';
import { convoyCanCarry } from '../policy/convoy-load';
import { navalServices } from '../policy/naval-services';
import { activeUnitClaim } from '../policy/claims';
import { mountedMinePlan } from '../policy/mounted-mine-plan';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { isOpponentOwner } from '../policy/ownership';
import { distance, type Point } from '../policy/spatial';
import { readV6Intel } from '../policy/v6/intel';
import type { AiPolicyContext } from '../policy/types';
import { mountedThreatReach, THINK_TICKS } from './mounted-micro';

/** Rank land arrivals separately from sea-route length, which is not a sailing ETA. */
export function riderFerryCrew(snapshot: GameSnapshot, soldiers: Unit[], shore: Point, boat: Unit, options: AiPolicyContext) {
  const mission = options.memory.naval!.ferries![boat.id]!;
  const crew = mission.purpose === 'creep' ? soldiers.filter(unit => unit.id === mission.riderId) : soldiers;
  return routeArrivals(snapshot.map, crew, shore, 'land').map(({ unit }) => unit);
}

/** A spare ferry gives an idle kiter access to a free guarded mine; existing missions keep their ship. */
export function planRiderCrossing(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  if (readV6Intel(snapshot, owner, options).intrusion) return;
  const naval = (options.memory.naval ??= {}), ferries = (naval.ferries ??= {});
  const missions = Object.values(ferries);
  const busy = new Set([...(options.memory.mounted?.flatMap(job => job.unitIds) ?? []),
    ...missions.flatMap(mission => mission.purpose === 'creep' ? [mission.riderId] : mission.crewIds)]);
  const riders = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'horseArcher' && !unit.deck
    && unit.hp >= unit.maxHp * .8 && !busy.has(unit.id) && !activeUnitClaim(snapshot, owner, unit, options)
    && ['idle', 'hold', 'move', 'attackMove'].includes(unit.order.type));
  if (!riders.length) return;
  // A ready invasion gets its required lift before optional clearing trips.
  // Already assigned assault hulls can satisfy that need, leaving spare
  // ferries available to riders without reserving the entire fleet.
  const assaultBoats = snapshot.units.filter(boat=>boat.owner===owner && isTransportKind(boat.kind)
    && ferries[boat.id]?.purpose==='assault' && ferries[boat.id]?.phase!=='return');
  const home=snapshot.buildings.find(building=>building.owner===owner && building.kind==='townHall');
  const needsLift = snapshot.buildings.filter(building=>building.kind==='townHall' && home && !sameGround(snapshot.map,home,building)
    && isOpponentOwner(snapshot,owner,building.owner,options)).some(target=>{
      const expedition=assaultExpedition(snapshot,owner,options,target);
      return expedition.ready && expedition.crew.length>0 && !convoyCanCarry(snapshot,assaultBoats,expedition.crew);
    });
  if (needsLift) return;
  const reserved = navalServices(snapshot, owner, options).reserved;
  const camps = mountedMinePlan(snapshot, options.memory);
  const boats = snapshot.units.filter(boat => boat.owner === owner && isTransportKind(boat.kind) && !ferries[boat.id]
    && !transportNeedsRecovery(snapshot, boat)
    && !reserved.has(boat.id) && naval.outfit?.shipId !== boat.id && !shipPassengers(snapshot.units, boat).length
    && boat.order.type === 'idle');
  const mines = snapshot.resources.filter(mine => mine.amount > 0 && !mineClaimedByAlly(snapshot, owner, mine, options)
    && !missions.some(mission => mission.targetId === mine.id && mission.phase !== 'return')
    && camps.eligible(mine)
    && !snapshot.buildings.some(hall => hall.kind === 'townHall' && distance(hall, mine) <= GOLD_MINE_RULES.baseRange)
    && !snapshot.units.some(unit => isOpponentOwner(snapshot, owner, unit.owner, options) && sameGround(snapshot.map, unit, mine))
    && !snapshot.buildings.some(building => isOpponentOwner(snapshot, owner, building.owner, options) && sameGround(snapshot.map, building, mine)));
  const trips = boats.flatMap(boat => riders.flatMap(rider => mines.flatMap(mine => {
    if (sameGround(snapshot.map, rider, mine)) return [];
    const guards = camps.guards(mine);
    if (!guards.length) return [];
    const from = coastOnWater(snapshot, rider, boat), to = coastOnWater(snapshot, mine, boat);
    if (!from || !to) return [];
    const shore = walkableGoal(snapshot.map, from.x, from.y), landing = walkableGoal(snapshot.map, to.x, to.y);
    if (guards.some(guard => guard.speed >= rider.speed || mountedThreatReach(snapshot, guard, { ...landing, radius: rider.radius }, THINK_TICKS + rider.cooldown)
      + guard.speed * THINK_TICKS / SIM_TICKS_PER_SECOND >= rider.attackRange)) return [];
    const approach = walkingDistance(snapshot.map, boat, from, 'sea'), crossing = walkingDistance(snapshot.map, from, to, 'sea');
    const landTicks = routeTravelTicks(snapshot.map, rider, shore, 'land', rider.speed);
    return approach === undefined || crossing === undefined || landTicks === undefined ? []
      : [{ boat, rider, mine, from, to, seaRoad: approach + crossing, landTicks }];
  }))).sort((a, b) => a.seaRoad - b.seaRoad || a.landTicks - b.landTicks);
  const trip = trips[0];
  if (trip) ferries[trip.boat.id] = { purpose: 'creep', riderId: trip.rider.id, targetId: trip.mine.id,
    from: trip.from, to: trip.to, phase: 'loading', crewIds: [trip.rider.id], sinceTick: snapshot.tick };
}
