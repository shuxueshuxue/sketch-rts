import { shipContactGoal, shipTraffic, shipTrafficKey } from './ship-avoidance';
import { shipProfile } from './ship-geometry';
import { followShipRoute } from './ship-guidance';
import { shipMotionLimits } from './ship-handling';
import { headingDifference, hullPassageClear, roundVoyageCorner, type ShipPose } from './ship-navigation';
import { coursePerformance } from './ship-wind';
import { windAt } from './wind-field';
import type { GameMap, Unit, UnitOrder } from './types';

type Move = Extract<UnitOrder, { type: 'move' }>;
const plainMove = (order: UnitOrder | undefined): order is Move => order?.type === 'move'
  && order.heading === undefined && order.rendezvousFor === undefined
  && order.deckPoint === undefined && order.deckShipId === undefined;

/** Only adjacent ordinary moves share a bend. A berth, action or change in
 * combat intent still runs through the normal exact-arrival order handling. */
export function followQueuedShipCourse(ship: Unit, map: GameMap, units: readonly Unit[], pace: number): boolean {
  if (!shipProfile(ship) || !ship.sailing || pace <= 0) return false;
  const motion = ship.sailing, current = ship.order, next = ship.orderQueue?.[0];
  let route = motion.route;
  const compatible = plainMove(current) && plainMove(next) && !!current.avoidCombat === !!next.avoidCombat;
  const wind = windAt(map, ship);
  if (!compatible || shipMotionLimits(ship).speed <= 0 || route?.queuedX !== undefined
    && (route.goalX !== current.x || route.goalY !== current.y || route.queuedX !== next.x || route.queuedY !== next.y || route.windKey !== wind.key)) {
    if (route?.queuedX !== undefined) motion.route = undefined;
    return false;
  }
  if (route?.queuedX === undefined) {
    if (route?.partial || route?.points.some(point => point.exact || point.pivot || point.tack)
      || shipContactGoal(ship, current, units) || shipContactGoal(ship, next, units)) return false;
    const from = { x: ship.x, y: ship.y, heading: motion.heading };
    // A continuous straight approach must be a useful sailing course. An
    // upwind order keeps its ordinary tack plan rather than cutting across it.
    const headings = [Math.atan2(current.y - ship.y, current.x - ship.x), Math.atan2(next.y - current.y, next.x - current.x)];
    if (headings.some(heading => {
      const performance = coursePerformance(ship, map, heading, { assumeTrimmed: true });
      return !performance.calm && (performance.noGo || performance.targetSpeed < performance.auxiliarySpeed);
    })) return false;
    const traffic = shipTraffic(ship, units, Infinity);
    let points = roundVoyageCorner(map, ship, from, current, next, traffic);
    let handoffIndex = points ? points.length - 2 : -1;
    // A mark on the same straight course is also a passage, with no reason
    // to furl the sails, stop, and accelerate again at every queue boundary.
    if (!points && Math.abs(headingDifference(from.heading, headings[0]!)) < .01
      && Math.abs(headingDifference(headings[0]!, headings[1]!)) < .01) {
      const straight: ShipPose[] = [
        { x: current.x, y: current.y, heading: headings[0]!, curvature: 0 },
        { x: next.x, y: next.y, heading: headings[1]!, curvature: 0 },
      ];
      if (hullPassageClear(map, ship, from, straight[0]!) && traffic(from, straight[0]!)
        && hullPassageClear(map, ship, straight[0]!, straight[1]!) && traffic(straight[0]!, straight[1]!)) {
        points = straight; handoffIndex = 0;
      }
    }
    if (!points) return false;
    route = motion.route = {
      goalX: current.x, goalY: current.y, queuedX: next.x, queuedY: next.y,
      points: points.map((point, index) => ({ ...point, ...(index === handoffIndex ? { queuedTurn: true } : {}) })),
      end: { x: next.x, y: next.y }, startX: ship.x, startY: ship.y, startHeading: motion.heading,
      legX: ship.x, legY: ship.y, windKey: wind.key, windTried: true,
      trafficKey: shipTrafficKey(ship, units), partial: false, cruise: true, age: 0, blockedTicks: 0,
    };
  }
  route.age = (route.age ?? 0) + 1;
  const followed = followShipRoute(ship, map, units, pace);
  if (followed !== true) {
    route.blockedTicks = (route.blockedTicks ?? 0) + 1;
    if (followed === 'maneuver' || route.blockedTicks >= 20) {
      motion.route = undefined;
      return false;
    }
    return true;
  }
  route.blockedTicks = 0;
  if (route.queuedPassed) {
    // Consume exactly the previewed queue head. The current curve and its
    // outgoing tangent continue without an idle tick or a new departure arc.
    ship.order = ship.orderQueue!.shift()!;
    route.goalX = next.x; route.goalY = next.y;
    delete route.queuedX; delete route.queuedY; delete route.queuedPassed;
    delete ship.arrivedAt;
  }
  return true;
}
