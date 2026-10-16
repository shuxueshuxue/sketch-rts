import { unitMover } from '../../shared/catalog';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { capsuleClearsBodies, expandConvex } from '../../shared/navigation-math';
import { groundSteeringRoute } from '../../shared/route-selection';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import { circleInPolygon, distanceToHull, localToWorld, shipProfile, worldToLocal, type Point } from '../../shared/ship-geometry';
import { cellCenter, isOpenGround, isWalkable, sameGround, steerPoint, walkDestination, walkableGoal } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Match public move's native deckPointOrder, including hull order and cleanup timing. */
function firstHullAt(units: readonly Unit[], point: Point) {
  return units.find(ship => {
    const profile = shipProfile(ship);
    return profile && circleInPolygon(worldToLocal(ship, point), 0, profile.hull);
  });
}

function roadLength(road: readonly Point[]) {
  return road.slice(1).reduce((length, point, index) => length + distance(road[index]!, point), 0);
}

function roadClips(snapshot: GameSnapshot, unit: Unit, road: readonly Point[], vessels = snapshot.units) {
  return road.slice(1).some((end, index) => {
    const at = constrainGroundShipStep(snapshot.map, unit, road[index]!, end, vessels);
    return at.x !== end.x || at.y !== end.y;
  });
}

/** Current live ground bodies used to admit a short backline road. */
export function groundScreenBodies(snapshot: GameSnapshot, unit: Unit) {
  return snapshot.units.filter(other => other.id !== unit.id && other.hp > 0 && !other.deck
    && !shipProfile(other) && unitMover(other.kind) === 'land' && isWalkable(snapshot.map, other.x, other.y));
}

function hullCandidates(snapshot: GameSnapshot, unit: Unit, ships: readonly Unit[], desired: Point) {
  const { map } = snapshot, candidates: Point[] = [];
  for (const ship of ships) {
    const outline = expandConvex(shipProfile(ship)!.hull.map(point => localToWorld(ship, point)), unit.radius + MOVE_ORDER_ARRIVAL_RANGE);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((desired.x - a.x) * dx + (desired.y - a.y) * dy) / (dx * dx + dy * dy)));
      candidates.push(a, { x: a.x + dx * t, y: a.y + dy * t });
    }
    const terrain = map.terrain;
    if (terrain) {
      const left = Math.max(0, Math.floor(Math.min(...outline.map(p => p.x)) / terrain.cell) - 1);
      const right = Math.min(terrain.cols - 1, Math.floor(Math.max(...outline.map(p => p.x)) / terrain.cell) + 1);
      const top = Math.max(0, Math.floor(Math.min(...outline.map(p => p.y)) / terrain.cell) - 1);
      const bottom = Math.min(terrain.rows - 1, Math.floor(Math.max(...outline.map(p => p.y)) / terrain.cell) + 1);
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++)
        candidates.push(cellCenter(terrain, row * terrain.cols + col));
    }
  }
  return candidates;
}

/** Repair a current steering segment cut by a hull within native arrival reach.
 * The selected point is one local waypoint, re-evaluated by the next think;
 * static clear roads do not certify crowd parting, future hulls or arrival. */
function groundHullDetour(snapshot: GameSnapshot, unit: Unit, desired: Point): Point | undefined {
  const { map, units } = snapshot, arrival = MOVE_ORDER_ARRIVAL_RANGE;
  // Non-ground destinations can invoke connected-deck walking before terrain
  // steering. Preserve that separate native mechanism rather than approximate it.
  if (desired.x < 0 || desired.y < 0 || desired.x > map.width || desired.y > map.height
    || !isOpenGround(map, desired.x, desired.y) || distance(unit, desired) <= arrival) return desired;
  if (unit.effects.some(effect => effect.type === 'root' || effect.type === 'stun')) return desired;
  // Public steering and hull constraints determine the blocked segment. This
  // is local prevention within arrival reach, not a copy of a native tick.
  const nearby = units.filter(ship => ship.hp > 0 && shipProfile(ship)
    && distanceToHull(ship, unit) <= unit.radius + arrival);
  if (!nearby.length) return desired;
  const aim = steerPoint(map, unit, desired);
  const blocked = nearby.filter(ship => roadClips(snapshot, unit, [unit, aim], [ship]));
  if (!blocked.length) return desired;
  const bodies = groundScreenBodies(snapshot, unit);
  let best: Point | undefined, shortest = Infinity;
  const seen = new Set<string>();
  for (const point of hullCandidates(snapshot, unit, blocked, desired)) {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (point.x < 0 || point.y < 0 || point.x > map.width || point.y > map.height
      || distance(unit, point) <= arrival || !isOpenGround(map, point.x, point.y)
      || !sameGround(map, unit, point) || firstHullAt(units, point)) continue;
    const approach = groundSteeringRoute(map, unit, point);
    if (distance(approach.at(-1)!, point) > arrival || roadClips(snapshot, unit, approach)) continue;
    // Current ground bodies may already overlap. The existing native geometry
    // admits only separating motion from that overlap, never a path through it.
    if (approach.slice(1).some((end, index) => !capsuleClearsBodies(approach[index]!, end, unit.radius, bodies))) continue;
    const onward = groundSteeringRoute(map, point, desired);
    if (distance(onward.at(-1)!, desired) > arrival || roadClips(snapshot, unit, onward)) continue;
    const length = roadLength(approach) + roadLength(onward);
    if (length < shortest) { best = point; shortest = length; }
  }
  return best;
}

/** Preserve the chosen screen point unless a hull binds its destination or cuts its current step.
 * Nearby hull edges retain the screen's preference;
 * these are current static roads, not promises about future sailing or body parting. */
export function groundScreenGoal(snapshot: GameSnapshot, unit: Unit, desired: Point, detour = true): Point | undefined {
  const { map, units } = snapshot, arrival = MOVE_ORDER_ARRIVAL_RANGE;
  const ships = units.filter(ship => shipProfile(ship));
  if (!ships.length || unit.deck || unit.order.type === 'board' || unitMover(unit.kind) !== 'land') return desired;
  const rawHull = firstHullAt(units, desired);
  // Native hull-step checks assume a genuine ground start. Do not change an
  // unrelated legacy move from an invalid start or certify it as a new road.
  if (!isOpenGround(map, unit.x, unit.y)) return rawHull ? undefined : desired;
  if (!rawHull) return detour ? groundHullDetour(snapshot, unit, desired) : desired;
  const destination = walkDestination(map, unit, walkableGoal(map, desired.x, desired.y));
  const blocked = ships.filter(ship => firstHullAt([ship], desired) || firstHullAt([ship], destination));
  // The raw-goal branch retains its earlier candidate order. Non-open-ground
  // next-step boarding remains a separate, unchanged native mechanism.
  if (!blocked.length) return desired;
  const candidates: Point[] = [destination, ...hullCandidates(snapshot, unit, blocked, desired)];
  candidates.sort((a, b) => distance(a, desired) - distance(b, desired));
  for (const point of candidates) {
    if (point.x < 0 || point.y < 0 || point.x > map.width || point.y > map.height
      || !isOpenGround(map, point.x, point.y) || !sameGround(map, unit, point) || firstHullAt(units, point)) continue;
    const road = groundSteeringRoute(map, unit, point);
    if (distance(road.at(-1)!, point) > arrival || roadClips(snapshot, unit, road)) continue;
    return point;
  }
  return undefined;
}

/** Adapt only this owner's already-chosen land moves; transport and deck work keep their owner. */
export function groundScreenMoves(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: GameCommand[]): GameCommand[] {
  const byId = new Map(snapshot.units.filter(unit => unit.owner === owner).map(unit => [unit.id, unit]));
  const ferryCrew = new Set(Object.values(options.memory.naval?.ferries ?? {}).flatMap(ferry => ferry.crewIds));
  let changed = false;
  const result = commands.flatMap((command): GameCommand[] => {
    if (command.type !== 'move') return [command];
    const replacements = command.unitIds.map(id => {
      const unit = byId.get(id);
      if (!unit || unit.deck || unit.order.type === 'board' || ferryCrew.has(id) || unitMover(unit.kind) !== 'land') return undefined;
      // A queued move starts later from a different pose. Keep its prior raw
      // destination treatment; a current-step detour must never replace it.
      const point = groundScreenGoal(snapshot, unit, command, !command.queued);
      if (point?.x === command.x && point.y === command.y) return undefined;
      changed = true;
      return point && distance(unit, point) > MOVE_ORDER_ARRIVAL_RANGE
        ? { ...command, unitIds: [id], x: point.x, y: point.y }
        : { type: 'holdPosition' as const, unitIds: [id], ...(command.queued ? { queued: true } : {}) };
    });
    if (replacements.every(replacement => replacement === undefined)) return [command];
    return command.unitIds.map((id, index) => replacements[index] ?? { ...command, unitIds: [id] });
  });
  return changed ? result : commands;
}
