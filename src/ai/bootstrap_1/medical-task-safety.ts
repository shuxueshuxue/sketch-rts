import { groundSteeringRoute, routeClearsDisks } from '../../shared/route-selection';
import { pointSegmentDistanceSquared } from '../../shared/navigation-math';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { steerPoint } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';
import { hostileDamageDisks } from './damage-footprints';
import { mountedThreatReach, THINK_TICKS } from './mounted-micro';

/** Native building-aware steering, stopped at the first actual spell-range entry.
 * Crowd detours and movement after the observed target moves remain live simulation work. */
export function medicalApproachRoad(snapshot: GameSnapshot, healer: Unit, target: Point, range: number): [Point, ...Point[]] | undefined {
  if (distance(healer, target) <= range) return [healer];
  const route = groundSteeringRoute(snapshot.map, healer, target), road: [Point, ...Point[]] = [healer];
  for (const point of route.slice(1)) {
    const previous = road[road.length - 1]!, dx = point.x - previous.x, dy = point.y - previous.y;
    const px = previous.x - target.x, py = previous.y - target.y;
    const a = dx * dx + dy * dy, b = 2 * (px * dx + py * dy), c = px * px + py * py - range * range;
    const discriminant = b * b - 4 * a * c;
    const entry = a > 0 && discriminant >= 0 ? (-b - Math.sqrt(discriminant)) / (2 * a) : -1;
    if (entry >= 0 && entry <= 1) {
      road.push({ x: previous.x + dx * entry, y: previous.y + dy * entry });
      return road;
    }
    road.push(point);
  }
  return range === 0 && distance(road[road.length - 1]!, target) <= MOVE_ORDER_ARRIVAL_RANGE ? road : undefined;
}

/** Medical work may wait or approach only outside known attack and active-area coverage.
 * The moving-foe margin is one think, not a prediction that a long road stays safe forever. */
export function medicalRoadIsSafe(snapshot: GameSnapshot, healer: Unit, target: Point, range: number, foes: readonly (Unit | Building)[]) {
  const road = medicalApproachRoad(snapshot, healer, target, range);
  if (!road) return false;
  const disks = [...foes.map(foe => ({ x: foe.x, y: foe.y,
    radius: mountedThreatReach(snapshot, foe, healer, THINK_TICKS)
      + ('speed' in foe ? foe.speed * THINK_TICKS / SIM_TICKS_PER_SECOND : 0) })),
  ...hostileDamageDisks(snapshot, healer, foes, THINK_TICKS)];
  return disks.every(disk => distance(healer, disk) > disk.radius) && routeClearsDisks(road, disks);
}

/** A covered remote range entry does not prevent safe progress this think.
 * Publish only the first native steering waypoint; no cast can continue down
 * the rejected remainder before the next medical/backline reassessment. */
export function medicalApproachWaypoint(snapshot: GameSnapshot, healer: Unit, target: Point, range: number, foes: readonly (Unit | Building)[]) {
  // A mobile threat can leave the remote road before we get there. Known fixed
  // fire and active ground damage still need a viable complete range entry.
  if (!medicalRoadIsSafe(snapshot, healer, target, range, foes.filter(foe => !('speed' in foe)))) return undefined;
  const point = steerPoint(snapshot.map, healer, target);
  return distance(healer, point) > MOVE_ORDER_ARRIVAL_RANGE
    && medicalRoadIsSafe(snapshot, healer, point, 0, foes) ? point : undefined;
}

/** A short backline escape must not cross a worse known coverage margin on its
 * actual steering road. This checks the road, not just the scored endpoint. */
export function medicalEscapeRoadAllows(snapshot: GameSnapshot, healer: Unit, foes: readonly (Unit | Building)[]) {
  const disks = [...foes.map(foe => ({ x: foe.x, y: foe.y,
    radius: mountedThreatReach(snapshot, foe, healer, THINK_TICKS + healer.cooldown)
      + ('speed' in foe ? foe.speed * THINK_TICKS / SIM_TICKS_PER_SECOND : 0) })),
  ...hostileDamageDisks(snapshot, healer, foes, THINK_TICKS + healer.cooldown)];
  const start = Math.min(...disks.map(disk => distance(healer, disk) - disk.radius));
  return (goal: Point) => {
    if (goal === healer) return true;
    const road = medicalApproachRoad(snapshot, healer, goal, 0);
    return !!road && road.slice(1).every((point, index) => disks.every(disk =>
      Math.sqrt(pointSegmentDistanceSquared(disk, road[index]!, point)) - disk.radius >= Math.min(0, start) - 1e-9));
  };
}
