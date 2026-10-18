import { ABILITY_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { BOARDING_GAP, landingSpot } from '../../shared/naval';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { groundSteeringRoute, routePrefix } from '../../shared/route-selection';
import { constrainGroundShipStep, shipSolidTraffic } from '../../shared/ship-collisions';
import { distanceToHull, shipPassengers, shipProfile, type Point } from '../../shared/ship-geometry';
import { shipMotionLimits } from '../../shared/ship-handling';
import { isTransportKind } from '../../shared/transport-role';
import { sameGround } from '../../shared/terrain';
import { perTick } from '../../shared/time';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import { clearTransferLanes } from '../policy/transfer-lanes';
import type { AiPolicyContext } from '../policy/types';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';

/** A stationary return can be pinned by landed bodies even though its distant
 * move destination is clear. Yield only the idle bodies in its real first
 * forward/reverse or yaw sweeps; ferry ownership and repair policy stay intact. */
export function expeditionDeparture(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  recovering: ReadonlySet<string>, protectedUnits: ReadonlySet<string>) {
  const ids = new Set<string>(), commands: GameCommand[] = [];
  const assigned: (Point & { radius: number })[] = [];
  const memory = options.memory, missions = Object.values(memory.naval?.ferries ?? {});
  const occupied = new Set([...protectedUnits, ...missions.flatMap(mission => mission.crewIds),
    ...memory.mounted?.flatMap(job => job.unitIds) ?? [],
    ...Object.entries(memory.unitClaims).filter(([, claim]) => claim.expiresTick > snapshot.tick).map(([id]) => id),
    ...memory.v6?.raid?.unitIds ?? [], ...memory.v6?.closeout?.unitIds ?? [], ...memory.v6?.creep?.group ?? [],
    ...memory.support?.unitIds ?? [], ...[memory.loot?.unitId, memory.shopping?.unitId, memory.mercenaryCourier?.unitId].filter((id): id is string => !!id)]);
  // A return berth may be blocked indirectly: a grounded soldier pins the
  // friendly escort whose hull covers the native passenger landing.
  const landingBlockers = new Set<string>();
  for (const carrier of snapshot.units) {
    const job = memory.naval?.ferries?.[carrier.id];
    if (carrier.owner !== owner || !carrier.sailing || job?.purpose !== 'settle' || job.phase !== 'return') continue;
    const cargo = shipPassengers(snapshot.units, carrier);
    const pose = { ...carrier, order: { type: 'unload' as const, ...job.from } };
    cargo.forEach((passenger, index) => {
      const point = landingSpot(snapshot.map, pose, index, cargo.length, snapshot.units, passenger);
      if (!point) return;
      for (const hull of snapshot.units) {
        if (hull.owner === owner && hull.sailing && hull.id !== carrier.id
          && distanceToHull(hull, point) < passenger.radius + 1) landingBlockers.add(hull.id);
      }
    });
  }
  const goingHome = (unit: GameSnapshot['units'][number]) => unit.order.type === 'move'
    && snapshot.buildings.some(hall => hall.owner === owner && hall.kind === 'townHall' && hall.complete
      && hall.hp > 0 && distance(hall, unit.order as Point) < 200);
  const ground = snapshot.units.filter(unit => !unit.deck && unitMover(unit.kind) === 'land');
  const idle = ground.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unit.expiresTick === undefined
    && unit.hp === unit.maxHp && !occupied.has(unit.id) && !unit.orderQueue?.length
    && !UNIT_DEFS[unit.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'heal')
    && (unit.order.type === 'idle' || unit.order.type === 'move' && (unit.order.avoidCombat || goingHome(unit))));
  if (!idle.length) return { ids, commands };
  const foes = armedFoes(snapshot, owner, options);
  const targets = [...snapshot.units.filter(unit => !unit.deck), ...snapshot.buildings]
    .filter(target => target.hp > 0 && isEnemyOwner(snapshot, owner, target.owner, options));
  const transfers = clearTransferLanes(snapshot, owner);
  for (const boat of snapshot.units) {
    const mission = memory.naval?.ferries?.[boat.id];
    const landingBlocker = landingBlockers.has(boat.id);
    const departingTransport = isTransportKind(boat.kind) && boat.order.type === 'move' && boat.order.avoidCombat
      && (recovering.has(boat.id) || mission?.phase === 'return' || mission?.phase === 'sailing');
    if (boat.owner !== owner || !boat.sailing || boat.sailing.speed > 1e-7
      || !(landingBlocker || departingTransport)) continue;
    const profile = shipProfile(boat)!, radius = Math.max(...profile.hull.map(point => Math.hypot(point.x, point.y)));
    const nearby = idle.filter(unit => (landingBlocker || unit.order.type !== 'move' || unit.order.avoidCombat) && !ids.has(unit.id) && distance(unit, boat) <= radius + unit.radius + BOARDING_GAP
      && !targets.some(target => sameGround(snapshot.map, unit, target)));
    if (!nearby.length) continue;
    const from = { x: boat.x, y: boat.y, heading: boat.sailing.heading };
    const stride = Math.max(snapshot.map.terrain?.cell ?? 0, ...nearby.map(unit => unit.radius * 2));
    const yaw = perTick(shipMotionLimits(boat).turnRate);
    const dx = Math.cos(from.heading) * stride, dy = Math.sin(from.heading) * stride;
    const departures = [{ ...from, x: from.x + dx, y: from.y + dy }, { ...from, x: from.x - dx, y: from.y - dy },
      { ...from, heading: from.heading + yaw }, { ...from, heading: from.heading - yaw }];
    const solid = shipSolidTraffic(snapshot.map, boat, snapshot.units);
    if ((landingBlocker ? departures.slice(2) : departures).some(pose => solid(from, pose))) continue;
    for (const unit of nearby) {
      if (!departures.some(pose => !shipSolidTraffic(snapshot.map, boat, [boat, unit])(from, pose))) continue;
      const clearRoad = (point: Point) => {
        if (!sameGround(snapshot.map, unit, point) || distanceToHull(boat, point) < unit.radius + BOARDING_GAP * 3
          || assigned.some(other => distance(other, point) < other.radius + unit.radius + BOARDING_GAP)
          || ground.some(other => other.id !== unit.id && distance(other, point) < other.radius + unit.radius + BOARDING_GAP)
          || safeLandTravelTicks(snapshot, unit, point, foes) === undefined) return false;
        const road = groundSteeringRoute(snapshot.map, unit, point);
        if (distance(road[road.length - 1]!, point) > 8) return false;
        if (road.slice(1).some((next, index) => distance(constrainGroundShipStep(snapshot.map, unit, road[index]!, next, snapshot.units), next) > 1e-6)) return false;
        // The endpoint is reserved above; the next physical step must also
        // leave the crowd. Native unit steering handles later moving bodies.
        const prefix = routePrefix(unit, road.slice(1), perTick(unit.speed));
        return prefix.slice(1).every((next, index) => capsuleClearsBodies(prefix[index]!, next, unit.radius,
          ground.filter(other => other.id !== unit.id)));
      };
      const transfer = transfers.find(command => command.type === 'move' && command.unitIds.includes(unit.id));
      const existing = transfer?.type === 'move' ? transfer : unit.order.type === 'move' ? unit.order : undefined;
      let goal = existing && clearRoad(existing) ? { x: existing.x, y: existing.y } : undefined;
      if (!goal) {
        const rally = [...snapshot.resources, ...snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall')]
          .filter(point => sameGround(snapshot.map, unit, point)).sort((a, b) => distance(unit, a) - distance(unit, b))[0];
        const preferred = rally ? Math.atan2(rally.y - unit.y, rally.x - unit.x) : Math.atan2(unit.y - boat.y, unit.x - boat.x);
        const angles = Array.from({ length: 32 }, (_, index) => index * Math.PI / 16)
          .sort((a, b) => Math.abs(Math.atan2(Math.sin(a - preferred), Math.cos(a - preferred))) - Math.abs(Math.atan2(Math.sin(b - preferred), Math.cos(b - preferred))));
        for (const angle of angles) {
          for (const reach of (landingBlocker ? [2, 3, 5, 7, 9] : [3, 5, 7, 9]).map(scale => scale * stride)) {
            const point = { x: unit.x + Math.cos(angle) * reach, y: unit.y + Math.sin(angle) * reach };
            if (!clearRoad(point)) continue;
            goal = point; break;
          }
          if (goal) break;
        }
      }
      if (!goal) continue;
      ids.add(unit.id); assigned.push({ ...goal, radius: unit.radius });
      if (unit.order.type !== 'move' || distance(unit.order, goal) > 1)
        commands.push({ type: 'move', unitIds: [unit.id], ...goal, avoidCombat: true });
    }
  }
  return { ids, commands };
}
