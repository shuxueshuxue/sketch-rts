import { landingSpot } from '../../shared/naval';
import { sameGround } from '../../shared/terrain';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { groundSteeringRoute } from '../../shared/route-selection';
import { constrainGroundShipStep, beginShipCollisionFrame } from '../../shared/ship-collisions';
import { planVoyageRoute, type ShipPose } from '../../shared/ship-navigation';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { coastalFireDisks, coastalFireSegmentClear } from '../policy/coastal-voyage';
import { combatCapability } from '../../shared/combat-capabilities';
import { shipProfile, distanceToHull, shipPassengers, type Point } from '../../shared/ship-geometry';
import { isEnemyOwner } from '../policy/ownership';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';
import { expeditionDeparture } from './expedition-departure';

export type BerthRecovery = {
  carrierId: string; blockerId: string; hallId: string; crewIds: string[];
  helpers: { id: string; goal: Point; home: Point }[];
  home: ShipPose; reverse: ShipPose; clear?: ShipPose; withdraw?: ShipPose;
  landings: (Point & { radius: number })[];
  phase: 'reverse' | 'clear' | 'return' | 'unload' | 'withdraw' | 'egress';
  since: number; phaseSince: number; issued: boolean; distance: number;
};
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function route(snapshot: GameSnapshot, owner: PlayerId, ship: Unit, goal: ShipPose, options: AiPolicyContext) {
  const moving: Unit = { ...ship, order: { type: 'move', x: goal.x, y: goal.y, avoidCombat: true }, orderQueue: [], sailing: { ...ship.sailing! } };
  delete moving.sailing!.route;
  const units = snapshot.units.map(unit => unit.id === ship.id ? moving : unit);
  beginShipCollisionFrame(units, snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const path = planVoyageRoute(snapshot.map, moving, { x: goal.x, y: goal.y }, shipRouteTraffic(snapshot.map, moving, units), 1024);
  if (path.partial || !path.points.length) return;
  const radius = Math.max(...shipProfile(ship)!.hull.map(point => Math.hypot(point.x, point.y)));
  const disks = [...coastalFireDisks(snapshot, ship, options, 0), ...snapshot.units
    .filter(unit => unit.sailing && isEnemyOwner(snapshot, owner, unit.owner, options) && combatCapability(snapshot, unit).armed)
    .map(unit => ({ id: unit.id, x: unit.x, y: unit.y, radius: combatCapability(snapshot, unit).range + radius }))];
  let previous = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
  for (const point of path.points) {
    if (!coastalFireSegmentClear(previous, point, disks)) return;
    previous = point;
  }
  return path;
}

function start(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): BerthRecovery | undefined {
  const foes = armedFoes(snapshot, owner, options);
  for (const carrier of snapshot.units) {
    const job = options.memory.naval?.ferries?.[carrier.id];
    if (carrier.owner !== owner || !carrier.sailing || Math.abs(carrier.sailing.speed) > 1e-7
      || job?.purpose !== 'settle' || job.phase !== 'return') continue;
    const cargo = shipPassengers(snapshot.units, carrier).filter(unit => unit.owner === owner);
    if (!cargo.length) continue;
    const pose: Unit = { ...carrier, order: { type: 'unload', ...job.from } };
    const landings = cargo.flatMap((passenger, index) => {
      const point = landingSpot(snapshot.map, pose, index, cargo.length, snapshot.units, passenger);
      return point ? [{ ...point, radius: passenger.radius }] : [];
    });
    const blocker = snapshot.units.filter(unit => unit.owner === owner && unit.sailing && unit.id !== carrier.id
      && !options.memory.naval?.ferries?.[unit.id] && !options.memory.naval?.coastalRetreat?.[unit.id]
      && Math.abs(unit.sailing.speed) < 1e-7)
      .map(unit => ({ unit, count: landings.filter(point => distanceToHull(unit, point) < point.radius + 1).length }))
      .filter(row => row.count > 0).sort((a, b) => b.count - a.count)[0]?.unit;
    if (!blocker) continue;
    const hall = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall'
      && building.complete && building.hp > 0 && gap(building, job.from) < 850)
      .find(building => landings.some(point => sameGround(snapshot.map, point, building)
        && safeLandTravelTicks(snapshot, { ...cargo[0]!, ...point, deck: undefined }, building, foes) !== undefined));
    if (!hall) continue;
    const home = { x: carrier.x, y: carrier.y, heading: carrier.sailing.heading };
    const distance = Math.ceil(shipProfile(carrier)!.length / 64) * 32;
    const reverse = { x: home.x - distance * Math.cos(home.heading), y: home.y - distance * Math.sin(home.heading), heading: home.heading };
    if (!route(snapshot, owner, carrier, reverse, options)) continue;
    const yielding = expeditionDeparture(snapshot, owner, options, new Set(), new Set(cargo.map(unit => unit.id)));
    const helpers = yielding.commands.flatMap(command => {
      if (command.type !== 'move') return [];
      return command.unitIds.flatMap(id => {
        const unit = snapshot.units.find(unit => unit.id === id)!;
        return gap(unit, blocker) < shipProfile(blocker)!.length
          ? [{ id, goal: { x: command.x, y: command.y }, home: { x: hall.x, y: hall.y } }] : [];
      });
    });
    return { carrierId: carrier.id, blockerId: blocker.id, hallId: hall.id, crewIds: cargo.map(unit => unit.id),
      helpers, home, reverse, landings, phase: 'reverse', since: snapshot.tick, phaseSince: snapshot.tick, issued: false, distance };
  }
}

/** Serialized task ownership lasts through actual shore egress, not merely an
 * empty deck. All motion uses public orders and the current native traffic. */
export function recoverBerth(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, planned: GameCommand[]): GameCommand[] {
  const memory = options.memory;
  if (!memory.berthRecovery && snapshot.tick >= (memory.berthRetryUntil ?? 0)) {
    const next = start(snapshot, owner, options); if (next) memory.berthRecovery = next;
  }
  const task = memory.berthRecovery;
  if (!task) return planned;
  const carrier = snapshot.units.find(unit => unit.id === task.carrierId && unit.owner === owner);
  const blocker = snapshot.units.find(unit => unit.id === task.blockerId && unit.owner === owner);
  const hall = snapshot.buildings.find(building => building.id === task.hallId && building.owner === owner && building.hp > 0);
  const abort = () => {
    delete memory.berthRecovery; memory.berthRetryUntil = snapshot.tick + 600;
    // A released task must not leave its old queued route running when the
    // ordinary planner has no replacement. Preserve any new emergency order.
    const controlled = new Set([task.carrierId, task.blockerId, ...task.crewIds, ...task.helpers.map(helper => helper.id)]);
    const replacement = new Set(planned.flatMap(command => 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : []));
    const stopping = snapshot.units.filter(unit => unit.owner === owner && controlled.has(unit.id) && !replacement.has(unit.id)
      && (unit.order.type === 'move' && unit.order.avoidCombat || !!unit.orderQueue?.length)).map(unit => unit.id);
    return stopping.length ? [...planned, { type: 'stop' as const, unitIds: stopping }] : planned;
  };
  if (!carrier?.sailing || !blocker?.sailing || !hall || snapshot.tick - task.since > 3600
    || snapshot.tick - task.phaseSince > 1500 || memory.naval?.coastalRetreat?.[carrier.id]
    || memory.naval?.coastalRetreat?.[blocker.id]
    || task.crewIds.some(id => !snapshot.units.some(unit => unit.id === id && unit.owner === owner))) return abort();
  for (const ship of [carrier, blocker]) {
    const radius = Math.max(...shipProfile(ship)!.hull.map(point => Math.hypot(point.x, point.y)));
    const disks = [...coastalFireDisks(snapshot, ship, options, 0), ...snapshot.units
      .filter(unit => unit.sailing && isEnemyOwner(snapshot, owner, unit.owner, options) && combatCapability(snapshot, unit).armed)
      .map(unit => ({ id: unit.id, x: unit.x, y: unit.y, radius: combatCapability(snapshot, unit).range + radius }))];
    let previous: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    for (const point of [previous, ...ship.sailing!.route?.points ?? []]) {
      if (!coastalFireSegmentClear(previous, point, disks)) return abort();
      previous = point;
    }
  }
  const advance = (phase: BerthRecovery['phase']) => { task.phase = phase; task.phaseSince = snapshot.tick; task.issued = false; };
  if (task.phase === 'reverse' && gap(carrier, task.reverse) < 3) advance('clear');
  if (task.phase === 'clear' && !task.clear) {
    for (const reach of [task.distance, task.distance * 1.5, task.distance * 2]) {
      for (const angle of [Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, 0, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4]) {
        const goal = { x: blocker.x + reach * Math.cos(angle), y: blocker.y + reach * Math.sin(angle), heading: blocker.sailing.heading };
        if (!task.landings.every(point => distanceToHull({ ...blocker, ...goal, sailing: { ...blocker.sailing!, heading: goal.heading } }, point) > point.radius + 16)) continue;
        if (route(snapshot, owner, blocker, goal, options)) { task.clear = goal; break; }
      }
      if (task.clear) break;
    }
  }
  if (task.phase === 'clear' && task.clear && gap(blocker, task.clear) < 3) advance('return');
  if (task.phase === 'return' && gap(carrier, task.home) < 3) advance('unload');
  if (task.phase === 'unload' && !shipPassengers(snapshot.units, carrier).length) {
    task.withdraw = { x: carrier.x - task.distance * Math.cos(carrier.sailing.heading),
      y: carrier.y - task.distance * Math.sin(carrier.sailing.heading), heading: carrier.sailing.heading };
    advance('withdraw');
  }
  if (task.phase === 'withdraw' && task.withdraw && gap(carrier, task.withdraw) < 3) advance('egress');
  if (task.phase === 'egress' && task.crewIds.every(id => {
    const unit = snapshot.units.find(unit => unit.id === id)!;
    return !unit.deck && gap(unit, hall) < hall.radius + 92;
  })) { delete memory.berthRecovery; memory.berthRetryUntil = snapshot.tick + 600; return planned; }
  const reserved = new Set([carrier.id, blocker.id, ...task.crewIds, ...task.helpers.map(helper => helper.id)]);
  const commands = planned.flatMap((command): GameCommand[] => {
    // New recruitment must not refill a boat while its original crew exits.
    if (command.type === 'board' && (command.transportId === carrier.id || command.transportId === blocker.id)) return [];
    if ('unitIds' in command) {
      const unitIds = command.unitIds.filter(id => !reserved.has(id) || task.phase === 'unload' && id === carrier.id);
      return unitIds.length === command.unitIds.length ? [command] : unitIds.length ? [{ ...command, unitIds }] : [];
    }
    if ('unitId' in command && reserved.has(command.unitId)) return [];
    if (command.type === 'unloadPassenger' && task.phase !== 'unload' && reserved.has(command.transportId)) return [];
    return [command];
  });
  if (!task.issued) {
    const moving = task.phase === 'clear' ? blocker : carrier;
    const goal = task.phase === 'reverse' ? task.reverse : task.phase === 'clear' ? task.clear
      : task.phase === 'return' ? task.home : task.phase === 'withdraw' ? task.withdraw : undefined;
    if (goal && route(snapshot, owner, moving, goal, options)) {
      commands.push({ type: 'stop', unitIds: [moving.id === carrier.id ? blocker.id : carrier.id] },
        { type: 'move', unitIds: [moving.id], x: goal.x, y: goal.y, avoidCombat: true });
      task.issued = true;
    } else if (task.phase === 'unload' || task.phase === 'egress') {
      commands.push({ type: 'stop', unitIds: [blocker.id] }); task.issued = true;
    }
  }
  for (const helper of task.helpers) {
    const unit = snapshot.units.find(unit => unit.id === helper.id);
    if (!unit || gap(unit, hall) < hall.radius + 92 || unit.orderQueue?.length) continue;
    if (unit.order.type !== 'move' || !unit.order.avoidCombat) commands.push(
      { type: 'move', unitIds: [unit.id], ...helper.goal, avoidCombat: true },
      { type: 'move', unitIds: [unit.id], ...helper.home, avoidCombat: true, queued: true });
  }
  const foes = armedFoes(snapshot, owner, options);
  for (const unit of snapshot.units.filter(unit => task.crewIds.includes(unit.id) && !unit.deck && gap(unit, hall) >= hall.radius + 92)) {
    if (unit.order.type === 'move' && unit.orderQueue?.length) continue;
    const clears = (road: Point[]) => road.slice(1).every((point, index) =>
      gap(constrainGroundShipStep(snapshot.map, unit, road[index]!, point, snapshot.units), point) < 1e-6);
    if (safeLandTravelTicks(snapshot, unit, hall, foes) === undefined) return abort();
    const road = groundSteeringRoute(snapshot.map, unit, hall);
    if (clears(road)) {
      if (unit.order.type !== 'move' || gap(unit.order, hall) > 1 || !unit.order.avoidCombat)
        commands.push({ type: 'move', unitIds: [unit.id], x: hall.x, y: hall.y, avoidCombat: true });
      continue;
    }
    let detour: Point | undefined;
    const ground = snapshot.units.filter(other => !other.deck && !other.sailing && other.id !== unit.id);
    for (const reach of [64, 96, 128, 192]) {
      for (let index = 0; index < 16; index++) {
        const point = { x: unit.x + reach * Math.cos(index * Math.PI / 8), y: unit.y + reach * Math.sin(index * Math.PI / 8) };
        if (!sameGround(snapshot.map, unit, point)) continue;
        const first = groundSteeringRoute(snapshot.map, unit, point), at = { ...unit, ...point };
        const second = groundSteeringRoute(snapshot.map, at, hall);
        if (gap(first.at(-1)!, point) > 8 || safeLandTravelTicks(snapshot, unit, point, foes) === undefined
          || safeLandTravelTicks(snapshot, at, hall, foes) === undefined || !clears(first) || !clears(second)
          || !first.slice(1).every((next, i) => capsuleClearsBodies(first[i]!, next, unit.radius + 1, ground))) continue;
        detour = point; break;
      }
      if (detour) break;
    }
    if (detour) commands.push({ type: 'move', unitIds: [unit.id], ...detour, avoidCombat: true },
      { type: 'move', unitIds: [unit.id], x: hall.x, y: hall.y, avoidCombat: true, queued: true });
  }
  return commands;
}
