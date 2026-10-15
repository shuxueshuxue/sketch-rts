import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { isInCabin } from '../../shared/ship-cabin';
import { LANDING_REACH, passengerLandingSpot, canReach } from '../../shared/naval';
import { nearestShipPose } from '../../shared/ship-navigation';
import { localToWorld, shipPassengers, shipProfile } from '../../shared/ship-geometry';
import { sameGround, shoreSpots, walkableGoal, walkingDistance } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { assaultExpedition } from '../policy/naval';
import { isOpponentOwner } from '../policy/ownership';
import { effectiveCombatRating } from '../policy/v6/strength';
import type { AiPolicyContext } from '../policy/types';

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Query real passenger bodies at a terrain-clear berth. This is a landing
 * feasibility query; the sailing executor still owns reaching that berth. */
export function assaultBeachBodies(snapshot: GameSnapshot, boat: Unit, goal: Point, target: Point, atCurrentPose = false) {
  const pose = atCurrentPose ? { x: boat.x, y: boat.y, heading: boat.sailing!.heading } : nearestShipPose(snapshot.map, boat, goal);
  if (!pose) return undefined;
  const ship: Unit = { ...boat, x: pose.x, y: pose.y, order: { type: 'unload', ...goal },
    sailing: { ...boat.sailing!, heading: pose.heading, speed: 0, velocityX: 0, velocityY: 0 } };
  const shadow = snapshot.units.map(unit => unit.id === boat.id ? ship : unit.deck?.shipId === boat.id
    ? { ...unit, ...localToWorld(ship, unit.deck) } : unit);
  const passengers = shipPassengers(shadow, ship).filter(unit => unit.owner === boat.owner);
  if (!passengers.length || passengers.some(isInCabin)) return undefined;
  const landed: Unit[] = [];
  for (const passenger of passengers) {
    const point = passengerLandingSpot(snapshot.map, ship, passenger.id, shadow);
    if (!point || !sameGround(snapshot.map, point, target)) return undefined;
    const unit = { ...passenger, ...point, deck: undefined, cabin: undefined };
    shadow[shadow.indexOf(passenger)] = unit;
    landed.push(unit);
  }
  return { pose, landed };
}

/** A landing goal can lie outside a guard radius while its actual passengers
 * step inward under that guard's bow. Check the native landing bodies. */
export function assaultBeachExposure(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  boat: Unit, goal: Point, target: Point, atCurrentPose = false) {
  const placement = assaultBeachBodies(snapshot, boat, goal, target, atCurrentPose);
  if (!placement) return undefined;
  const guards = [...snapshot.units, ...snapshot.buildings].filter(foe =>
    (foe.owner === 'neutral' || isOpponentOwner(snapshot, owner, foe.owner, options)) && combatCapability(snapshot, foe).armed
    && placement.landed.some(passenger => distance(foe, passenger) <= combatCapability(snapshot, foe).range
      && (!('order' in foe) || canReach(snapshot.map, foe, passenger, snapshot.units, combatCapability(snapshot, foe).range))));
  return { ...placement, guards };
}

/** Every native landing lies within hull radius + LANDING_REACH. A coast
 * outside all weapon envelopes does not need another passenger packing query. */
function beachMayBeCovered(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit, goal: Point) {
  const pose = nearestShipPose(snapshot.map, boat, goal);
  if (!pose) return true;
  const span = Math.max(...shipProfile(boat)!.hull.map(point => Math.hypot(point.x, point.y))) + LANDING_REACH;
  return [...snapshot.units, ...snapshot.buildings].some(foe =>
    (foe.owner === 'neutral' || isOpponentOwner(snapshot, owner, foe.owner, options))
    && combatCapability(snapshot, foe).armed && distance(foe, pose) <= combatCapability(snapshot, foe).range + span);
}

/** Keep the existing expedition admission and ferry owner. An enemy's nearest
 * dock need not be the beach from which the army can actually deploy together. */
export function reviseAssaultBeaches(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const ferries = options.memory.naval?.ferries;
  if (!ferries || !snapshot.map.terrain) return;
  const own = snapshot.units.filter(unit => unit.owner === owner);
  const groups = new Map<string, Unit[]>();
  for (const boat of own) {
    const mission = ferries[boat.id];
    if (mission?.purpose !== 'assault' || mission.phase === 'return' || !shipPassengers(snapshot.units, boat).length) continue;
    const group = groups.get(mission.targetId) ?? [];
    group.push(boat); groups.set(mission.targetId, group);
  }
  for (const [targetId, boats] of groups) {
    const target = snapshot.buildings.find(building => building.id === targetId);
    if (!target || own.some(unit => !unit.deck && unitMover(unit.kind) === 'land' && unit.kind !== 'worker'
      && sameGround(snapshot.map, unit, target))) continue;
    const power = boats.flatMap(boat => shipPassengers(snapshot.units, boat))
      .filter(unit => unit.kind !== 'worker' && !unit.expiresTick)
      .reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
    if (power < assaultExpedition(snapshot, owner, options, target).required) continue;
    if (boats.every(boat => !beachMayBeCovered(snapshot, owner, options, boat, ferries[boat.id]!.to))) continue;
    const current = boats.map(boat => assaultBeachExposure(snapshot, owner, options, boat, ferries[boat.id]!.to, target));
    if (current.every(entry => entry && !entry.guards.length)) continue;
    // One sample per hull-width terrain tile avoids scanning equivalent
    // neighbouring shores. All candidates still need real native landings.
    const tile = snapshot.map.terrain.cell * Math.max(1,
      Math.ceil(Math.max(...boats.map(boat => shipProfile(boat)!.beam)) / snapshot.map.terrain.cell));
    const seen = new Set<string>();
    const candidates = shoreSpots(snapshot.map, BUILDING_DEFS.shipyard.radius)
      .filter(point => sameGround(snapshot.map, point, target))
      .map(point => walkableGoal(snapshot.map, point.x, point.y, 'sea'))
      .flatMap(point => {
        const key = `${Math.floor(point.x / tile)}:${Math.floor(point.y / tile)}`;
        if (seen.has(key) || boats.some(boat => !sameGround(snapshot.map, boat, point, 'sea'))) return [];
        const roads = boats.map(boat => walkingDistance(snapshot.map, boat, point, 'sea'));
        if (roads.some(road => road === undefined)) return [];
        seen.add(key);
        return [{ point, road: Math.max(...roads as number[]) }];
      }).sort((a, b) => a.road - b.road);
    let selected: Point | undefined;
    for (const { point } of candidates.slice(0, 64)) {
      if (!boats.every(boat => {
        const query = assaultBeachExposure(snapshot, owner, options, boat, point, target);
        return query && !query.guards.length;
      })) continue;
      selected = point; break;
    }
    if (!selected) continue;
    for (const boat of boats) {
      const placement = assaultBeachBodies(snapshot, boat, selected, target)!;
      ferries[boat.id]!.to = { ...selected };
      ferries[boat.id]!.approach = { x: placement.pose.x, y: placement.pose.y };
    }
  }
}

/** A native unload may disembark on an incidental shore of the same island
 * while its voyage is paused. Selected beaches therefore own an explicit
 * movement approach, followed by a real current-body stop and unload. */
export function orderBootstrapAssaultLanding(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit, goal: Point, ordinary: GameCommand[]): GameCommand[] {
  const mission = options.memory.naval?.ferries?.[boat.id];
  if (!mission?.approach || mission.purpose !== 'assault' || mission.phase !== 'sailing')
    return ordinary;
  const target = snapshot.buildings.find(building => building.id === mission.targetId);
  const current = target && assaultBeachExposure(snapshot, owner, options, boat, goal, target, true);
  if (current && !current.guards.length) {
    const ferries = options.memory.naval!.ferries!;
    const convoy = snapshot.units.filter(other => {
      const assignment = ferries[other.id];
      if (other.owner !== owner || assignment?.purpose !== 'assault' || assignment.phase !== 'sailing'
        || assignment.targetId !== mission.targetId || !shipPassengers(snapshot.units, other).length) return false;
      const road = walkingDistance(snapshot.map, boat, other, 'sea');
      return distance(boat, other) <= 450 && road !== undefined && road <= 450;
    });
    const landed = snapshot.units.some(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker'
      && unitMover(unit.kind) === 'land' && sameGround(snapshot.map, unit, target!));
    let simultaneousCrew: Unit[] | undefined;
    if (!landed && convoy.length > 1) {
      // Both real hulls must be able to unload now, including each preceding
      // passenger's occupied land body. A clear position for one half of the
      // army does not commit that half to a battle the other cannot yet join.
      let shadow = snapshot;
      let ready = true;
      for (const ship of convoy) {
        const query = assaultBeachExposure(shadow, owner, options, ship, ferries[ship.id]!.to, target!, true);
        if (!query || query.guards.length) { ready = false; break; }
        if (ship.id === boat.id) simultaneousCrew = query.landed;
        const bodies = new Map(query.landed.map(unit => [unit.id, unit]));
        shadow = { ...shadow, units: shadow.units.map(unit => bodies.get(unit.id) ?? unit) };
      }
      if (!ready || convoy.some(ship => Math.abs(ship.sailing!.speed) > .1
        || Math.hypot(ship.sailing!.velocityX ?? 0, ship.sailing!.velocityY ?? 0) > 1e-6))
        return boat.order.type === 'idle' && Math.abs(boat.sailing!.speed) <= .1 ? [] : [{ type: 'stop', unitIds: [boat.id] }];
    }
    const motion = boat.sailing!;
    if (Math.abs(motion.speed) > .1 || Math.hypot(motion.velocityX ?? 0, motion.velocityY ?? 0) > 1e-6)
      return [{ type: 'stop', unitIds: [boat.id] }];
    if (simultaneousCrew) {
      // The ordinary helm unload starts moving again on the next simulation
      // tick. Public portrait unloads execute at this actual stopped pose,
      // before either hull can turn away from its proven landing bodies.
      const issued = new Set(ordinary.flatMap(command => command.type === 'unloadPassenger' ? [command.passengerId] : []));
      return [...ordinary, ...simultaneousCrew.filter(unit => !issued.has(unit.id)).map(unit =>
        ({ type: 'unloadPassenger' as const, transportId: boat.id, passengerId: unit.id }))];
    }
    return ordinary;
  }
  const approach = mission.approach, order = boat.order;
  return order.type === 'move' && order.x === approach.x && order.y === approach.y && order.avoidCombat
    ? [] : [{ type: 'move', unitIds: [boat.id], ...approach, avoidCombat: true }];
}
