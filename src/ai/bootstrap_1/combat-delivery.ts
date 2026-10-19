import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { shipPassengers } from '../../shared/ship-geometry';
import { sameGround, shoreSpots, walkingDistance, walkableGoal } from '../../shared/terrain';
import { seconds, SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { coastOnWater, ferryCrewTaskAvailable, landingSafe, outgunned } from '../policy/naval';
import { navalServices } from '../policy/naval-services';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { readV6Intel } from '../policy/v6/intel';
import { distance } from '../policy/spatial';
import { coursePerformance, windAt } from '../../shared/ship-wind';
import type { GameMap, Unit } from '../../shared/types';
import { ferryTargetAvailable } from '../policy/ferry-retries';

function voyageSeconds(ship: Unit, map: GameMap, to: { x: number; y: number }) {
  const heading = Math.atan2(to.y - ship.y, to.x - ship.x);
  const course = coursePerformance(ship, map, heading, { assumeTrimmed: true });
  const wind = windAt(map, ship);
  const beatSpeed = Math.max(...[-1, 1].map(side => {
    const angle = wind.from + side * course.beatAngle;
    return coursePerformance(ship, map, angle, { assumeTrimmed: true }).targetSpeed * Math.cos(angle - heading);
  }));
  const speed = Math.max(course.auxiliarySpeed, course.noGo ? beatSpeed : course.targetSpeed);
  const road = walkingDistance(map, ship, to, 'sea');
  return road === undefined ? Infinity : road / Math.max(1, speed);
}

/** Use the first free boat to establish a usable mineral-island beachhead.
 * Existing settlers, riders and live convoys retain their assignments. */
export function planFirstCombatCrossing(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const naval = options.memory.naval ??= {}, ferries = naval.ferries ??= {};
  if (naval.firstCombatDelivery?.deliveredTick !== undefined || Object.values(ferries).some(mission => mission.purpose === 'advance' && mission.phase !== 'return')) return;
  if (readV6Intel(snapshot, owner, options).intrusion) return;
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0);
  // A navy-only settlement has no promised army to wait for. A working land
  // producer or a real combat unit makes this a troop-delivery assignment.
  if (!own.some(unit => unit.kind !== 'worker' && unitMover(unit.kind) === 'land' && unit.expiresTick === undefined && ferryCrewTaskAvailable(unit, options))
    && !snapshot.buildings.some(building => building.owner === owner && building.complete
      && BUILDING_DEFS[building.kind].trains.some(kind => kind !== 'worker' && unitMover(kind) === 'land'))) return;
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  if (!home) return;
  const reserved = navalServices(snapshot, owner, options).reserved;
  const boat = own.find(unit => isTransportKind(unit.kind) && !ferries[unit.id] && !shipPassengers(snapshot.units, unit).length
    && (naval.ferryRetryUntil?.[unit.id] ?? 0) <= snapshot.tick
    && !reserved.has(unit.id) && naval.outfit?.shipId !== unit.id && !shipNeedsRepair(snapshot, unit));
  if (!boat) return;
  const nearBoat = walkableGoal(snapshot.map, boat.x, boat.y);
  const from = coastOnWater(snapshot, sameGround(snapshot.map, nearBoat, home) ? nearBoat : home, boat);
  if (!from) return;
  const mines = snapshot.resources.filter(mine => mine.amount > 0 && !sameGround(snapshot.map, mine, home)
    && ferryTargetAvailable(naval, boat.id, mine.id)
    && !mineClaimedByAlly(snapshot, owner, mine, options)).sort((a, b) => distance(boat, a) - distance(boat, b));
  const trips: { targetId: string; to: { x: number; y: number }; seconds: number }[] = [];
  for (const mine of mines) {
    const nearest = coastOnWater(snapshot, mine, boat);
    if (!nearest) continue;
    const shores = [nearest, ...shoreSpots(snapshot.map, BUILDING_DEFS.shipyard.radius)
      .filter(point => sameGround(snapshot.map, point, mine))
      .sort((a, b) => distance(boat, a) + distance(a, mine) * .25 - distance(boat, b) - distance(b, mine) * .25)
      .map(point => walkableGoal(snapshot.map, point.x, point.y, 'sea'))];
    const to = shores.find(point => sameGround(snapshot.map, point, boat, 'sea')
      && sameGround(snapshot.map, walkableGoal(snapshot.map, point.x, point.y), mine)
      && landingSafe(snapshot, owner, options, boat, point) && !outgunned(snapshot, owner, options, point, own));
    if (to) trips.push({ targetId: mine.id, to, seconds: voyageSeconds(boat, snapshot.map, to) });
  }
  const trip = trips.filter(trip => Number.isFinite(trip.seconds)).sort((a, b) => a.seconds - b.seconds)[0];
  if (trip) ferries[boat.id] = { purpose: 'advance', targetId: trip.targetId, from, to: trip.to, phase: 'loading', crewIds: [], sinceTick: snapshot.tick };
}

/** A seat owns its first real delivery: boarding and unloading at home do not
 * count. Keep the original clock across a lost boat or a failed mission. */
export function recordCombatDelivery(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const naval = options.memory.naval;
  if (!naval || naval.firstCombatDelivery?.deliveredTick !== undefined) return;
  const boats = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && isTransportKind(unit.kind));
  if (!boats.length && !naval.firstCombatDelivery) return;
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  if (!home) return;
  const record = naval.firstCombatDelivery ??= { firstShipTick: snapshot.tick, deadlineTick: snapshot.tick + seconds(60), attempts: {} };
  for (const boat of boats) {
    const attempt = record.attempts[boat.id] ??= { firstSeenTick: snapshot.tick, passengerIds: [], reason: 'no-target', tick: snapshot.tick };
    const mission = naval.ferries?.[boat.id];
    attempt.reason = naval.ferryDecisions?.[boat.id]?.reason ?? 'no-target';
    attempt.tick = snapshot.tick;
    if (mission) {
      attempt.targetId = mission.targetId;
      if (!record.routeBudgeted) {
        const probeMap = { ...snapshot.map };
        const approach = walkingDistance(probeMap, boat, mission.from, 'sea');
        const crossing = walkingDistance(probeMap, mission.from, mission.to, 'sea');
        if (approach !== undefined && crossing !== undefined) {
          // Berth turns and upwind legs can use the handling assist. Its
          // actual shared speed sets the route budget, rather than treating
          // terrain distance / full sail speed as an arrival guarantee.
          const maneuverSpeed = coursePerformance(boat, probeMap, undefined, { assumeTrimmed: true }).auxiliarySpeed;
          record.deadlineTick = record.firstShipTick + seconds(60) + seconds(20)
            + Math.ceil((approach + crossing) / Math.max(1, maneuverSpeed) * SIM_TICKS_PER_SECOND);
          record.routeBudgeted = true;
        }
      }
    }
    for (const unit of shipPassengers(snapshot.units, boat)) {
      if (unit.owner === owner && unit.kind !== 'worker' && unitMover(unit.kind) === 'land' && unit.expiresTick === undefined
        && combatCapability(snapshot, unit).armed && !attempt.passengerIds.includes(unit.id)) attempt.passengerIds.push(unit.id);
    }
    const landed = snapshot.units.find(unit => attempt.passengerIds.includes(unit.id) && unit.owner === owner && unit.hp > 0
      && !unit.deck && !sameGround(snapshot.map, unit, home)
      && mission && sameGround(snapshot.map, unit, walkableGoal(snapshot.map, mission.to.x, mission.to.y)));
    if (landed) {
      record.deliveredTick = snapshot.tick; record.deliveredShipId = boat.id; record.deliveredUnitId = landed.id;
      attempt.reason = 'delivered';
      break;
    }
  }
  for (const [id, attempt] of Object.entries(record.attempts)) if (!boats.some(boat => boat.id === id) && attempt.lostTick === undefined) {
    attempt.lostTick = snapshot.tick; attempt.reason = 'transport-lost'; attempt.tick = snapshot.tick;
  }
  if (snapshot.tick > record.firstShipTick + seconds(60) && record.firstMinuteBlock === undefined && record.deliveredTick === undefined) {
    const attempt = Object.values(record.attempts).find(attempt => attempt.lostTick === undefined);
    record.firstMinuteBlock = { tick: snapshot.tick, reason: attempt?.reason ?? 'transport-lost' };
  }
  if (snapshot.tick > record.deadlineTick && record.overdueTick === undefined) record.overdueTick = snapshot.tick;
}
