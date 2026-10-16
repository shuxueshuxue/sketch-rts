import { unitMover } from '../../shared/catalog';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { expandConvex } from '../../shared/navigation-math';
import { groundSteeringRoute } from '../../shared/route-selection';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import { circleInPolygon, localToWorld, shipProfile, worldToLocal, type Point } from '../../shared/ship-geometry';
import { cellCenter, isOpenGround, sameGround, walkDestination, walkableGoal } from '../../shared/terrain';
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

/** Preserve the chosen screen point unless a current hull binds its destination.
 * Nearby hull edges retain the screen's preference;
 * these are current static roads, not promises about future sailing or body parting. */
export function groundScreenGoal(snapshot: GameSnapshot, unit: Unit, desired: Point): Point | undefined {
  const { map, units } = snapshot, arrival = MOVE_ORDER_ARRIVAL_RANGE;
  const ships = units.filter(ship => shipProfile(ship));
  if (!ships.length || unit.deck || unit.order.type === 'board' || unitMover(unit.kind) !== 'land') return desired;
  // Native hull-step checks assume a genuine ground start. Do not change an
  // unrelated legacy move from an invalid start or certify it as a new road.
  if (!isOpenGround(map, unit.x, unit.y)) return firstHullAt(units, desired) ? undefined : desired;
  const destination = walkDestination(map, unit, walkableGoal(map, desired.x, desired.y));
  const blocked = ships.filter(ship => firstHullAt([ship], desired) || firstHullAt([ship], destination));
  // Preserve unrelated formation moves without building a road for each actor.
  // Raw non-open-ground next-step boarding and mid-road hull clips are separate
  // native mechanisms; neither is an observed trigger for this repair.
  if (!blocked.length) return desired;
  const clips = (road: readonly Point[], vessels: readonly Unit[]) => road.slice(1).some((end, index) => {
    const at = constrainGroundShipStep(map, unit, road[index]!, end, vessels);
    return at.x !== end.x || at.y !== end.y;
  });
  const candidates: Point[] = [destination];
  for (const ship of blocked) {
    // The body's radius and native move arrival range define the standing clearance.
    const outline = expandConvex(shipProfile(ship)!.hull.map(point => localToWorld(ship, point)), unit.radius + arrival);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((desired.x - a.x) * dx + (desired.y - a.y) * dy) / (dx * dx + dy * dy)));
      candidates.push(a, { x: a.x + dx * t, y: a.y + dy * t });
    }
    // Native terrain cells supply alternatives when the closest edge is not open ground.
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
  candidates.sort((a, b) => distance(a, desired) - distance(b, desired));
  for (const point of candidates) {
    if (point.x < 0 || point.y < 0 || point.x > map.width || point.y > map.height
      || !isOpenGround(map, point.x, point.y) || !sameGround(map, unit, point) || firstHullAt(units, point)) continue;
    const road = groundSteeringRoute(map, unit, point);
    if (distance(road.at(-1)!, point) > arrival || clips(road, units)) continue;
    return point;
  }
  return undefined;
}

/** Only this backline's already-chosen land moves change; transport and deck work keep their owner. */
export function groundScreenMoves(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: GameCommand[]): GameCommand[] {
  const byId = new Map(snapshot.units.filter(unit => unit.owner === owner).map(unit => [unit.id, unit]));
  const ferryCrew = new Set(Object.values(options.memory.naval?.ferries ?? {}).flatMap(ferry => ferry.crewIds));
  let changed = false;
  const result = commands.flatMap((command): GameCommand[] => {
    if (command.type !== 'move') return [command];
    const replacements = command.unitIds.map(id => {
      const unit = byId.get(id);
      if (!unit || unit.deck || unit.order.type === 'board' || ferryCrew.has(id) || unitMover(unit.kind) !== 'land') return undefined;
      const point = groundScreenGoal(snapshot, unit, command);
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
