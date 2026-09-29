import type { GameMap, GameSnapshot, Unit } from "../../../shared/types";
import { averagePoint, distance, type Point } from "../spatial";
import { neutralCamps, type Camp } from "../v7/creep";

// @@@v9-march-round-camps - V9's army walks round the creep camps on its way (attacking, falling back, going home) instead
// of through them. An attack-move takes on every creep within the auto-acquire range (230) of a walker, and the straight
// line between two players' bases runs through the middle of the map, where a map keeps its strongest camps: V9's five
// lancers set out for V8's natural at 4:50, walked into the middle's brutes 234 from the line and lost four of five to
// them before 5:15, with no enemy in sight (moonlitCauseway, generated). A player walks round such a camp; V9 steps its
// march out to the side of the first camp in the way, far enough that the walk from there on clears it, and goes on to
// the target from there. A camp by the target is fought where it stands (no walk round it reaches the target); one the
// march has come up to is still walked round, the march bending round it on the way (a march that stopped counting a
// camp once 500 from it walked into the middle's brutes and witches the same way, chalkFen generated, 5:10).
const PASS_CLEARANCE = 300;
const DETOUR_GAP = 460;
const END_CLEARANCE = 450;
const EDGE_MARGIN = 120;

// Units still on the way (farther than ARRIVED from the point) head for the march point from their middle; units at the
// point already hold it.
const ARRIVED = 350;

export function marchArrived(unit: Point, point: Point) {
  return distance(unit, point) <= ARRIVED;
}

export function marchHeading(snapshot: GameSnapshot, units: readonly Unit[], point: Point): Point {
  const away = units.filter((unit) => !marchArrived(unit, point));
  return away.length === 0 ? point : marchPoint(snapshot, averagePoint(away), point);
}

// Where the march from `from` to `to` should head now: `to` itself, or a point beside the first camp in the way.
export function marchPoint(snapshot: GameSnapshot, from: Point, to: Point): Point {
  const camps = neutralCamps(snapshot).filter((camp) => distance(camp.center, to) > camp.reach + END_CLEARANCE);
  const blocking = firstInTheWay(camps, from, to);
  if (!blocking) return to;
  const length = distance(from, to);
  if (length < 1) return to;
  const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const left = { x: -along.y, y: along.x };
  const offset = cross(along, { x: blocking.center.x - from.x, y: blocking.center.y - from.y });
  // The side of the line away from the camp first, then the other.
  const sides = offset >= 0 ? [-1, 1] : [1, -1];
  const gap = blocking.reach + DETOUR_GAP;
  const others = camps.filter((camp) => camp !== blocking);
  for (const side of sides) {
    const waypoint = { x: blocking.center.x + left.x * gap * side, y: blocking.center.y + left.y * gap * side };
    if (!onMap(snapshot.map, waypoint)) continue;
    if (clearOf(others, from, waypoint) && clearOf(others, waypoint, to)) return waypoint;
  }
  return to;
}

function firstInTheWay(camps: Camp[], from: Point, to: Point): Camp | undefined {
  return camps
    .filter((camp) => camp.creeps.some((creep) => segmentDistance(home(creep), from, to) <= PASS_CLEARANCE))
    .sort((a, b) => distance(a.center, from) - distance(b.center, from))[0];
}

function clearOf(camps: Camp[], from: Point, to: Point) {
  return camps.every((camp) => camp.creeps.every((creep) => segmentDistance(home(creep), from, to) > PASS_CLEARANCE));
}

function onMap(map: GameMap, point: Point) {
  return point.x >= EDGE_MARGIN && point.y >= EDGE_MARGIN && point.x <= map.width - EDGE_MARGIN && point.y <= map.height - EDGE_MARGIN;
}

function home(unit: Unit): Point {
  return { x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y };
}

function cross(a: Point, b: Point) {
  return a.x * b.y - a.y * b.x;
}

function segmentDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}
