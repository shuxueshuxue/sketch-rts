import { detCos, detSin } from './det-math';
import { polygonTouchesCellForPolygon } from './navigation-math';
import { shipProfile, type Point } from './ship-geometry';
import { hullFits, type ShipPose } from './ship-navigation';
import { CELL_GROUND } from './terrain';
import type { GameMap, Unit, UnitOrder } from './types';

// @@@give-way (hulls) - An idle body gives way to its own side's movement (the rule is stated at the deck's, see
// deckGiveWay); here the body is a hull and the movement its side's land units wading the shallows, which fords, necks
// and the rim of every shore are, sailed and walked both. In the bench's stalled games four fifths of the land units held
// up stood against an own transport or carrier at rest on them, sent or stopped there by its side's script, or standing
// under a move it could not make (its turn swept the very troops pressing on it). A hull that held up a step of its
// own side's land units this tick, and stands idle or still under a move, gives way: it goes to its deep mooring, the
// nearest pose whose hull covers no ground land units walk, straight ahead or astern first (troops pressing at its
// sides are not in that way), so it lies where it cannot close the way again; then it takes up what it was doing.
// A hull holding its ground, fighting, or held for boarding or a bridge does not yield. One that has none within reach
// stays.

/** Whether a hull at the pose covers any cell a land unit may stand on. */
export function hullOnWalkway(map: Pick<GameMap, 'terrain'>, ship: Unit, pose: ShipPose): boolean {
  const terrain = map.terrain, profile = shipProfile(ship);
  if (!terrain || !profile) return false;
  const c = detCos(pose.heading), s = detSin(pose.heading);
  const hull = profile.hull.map(p => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of hull) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const cell = terrain.cell;
  for (let row = Math.max(0, Math.floor(top / cell)); row <= Math.min(terrain.rows - 1, Math.floor(bottom / cell)); row++)
    for (let col = Math.max(0, Math.floor(left / cell)); col <= Math.min(terrain.cols - 1, Math.floor(right / cell)); col++)
      if (CELL_GROUND[terrain.cells[row * terrain.cols + col]!]?.land && polygonTouchesCellForPolygon(hull, col * cell, row * cell, cell)) return true;
  return false;
}

const moorings = new WeakMap<object, Map<string, ShipPose | null>>();
/** The nearest pose off the walkway that the hull fits, by terrain alone (so the answer is the same in every replay). */
export function deepMooring(map: GameMap, ship: Unit): ShipPose | undefined {
  const profile = shipProfile(ship), terrain = map.terrain;
  if (!profile || !terrain) return undefined;
  const heading = ship.sailing?.heading ?? 0, key = `${ship.kind}:${profile.length}:${ship.x}:${ship.y}:${heading}`;
  let memo = moorings.get(terrain);
  if (!memo) { memo = new Map(); moorings.set(terrain, memo); }
  if (memo.has(key)) return memo.get(key) ?? undefined;
  const ahead = { x: detCos(heading), y: detSin(heading) };
  const step = terrain.cell, reach = profile.length * 3;
  const straight = (along: number): ShipPose => ({ x: ship.x + ahead.x * along, y: ship.y + ahead.y * along, heading });
  // A turn costs what sailing half a hull per radian does (as a crew rendezvous reckons it): a hull swung across the
  // ford would sweep the troops on either side of it.
  let found: ShipPose | undefined, best = Infinity;
  for (let distance = step; distance <= reach && distance < best; distance += step) {
    // A hull moves along its heading: straight ahead or astern, or turned and then so. A pose off to its side on the same
    // heading takes two turns to reach.
    const poses = [straight(distance), straight(-distance),
      ...[Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2].flatMap(turn => {
        const c = detCos(heading + turn), s = detSin(heading + turn);
        return [1, -1].map(sign => ({ x: ship.x + c * distance * sign, y: ship.y + s * distance * sign, heading: heading + turn }));
      })];
    for (const pose of poses) {
      const cost = distance + Math.abs(pose.heading - heading) * profile.length / 2;
      if (cost < best && hullFits(map, ship, pose) && !hullOnWalkway(map, ship, pose)) { best = cost; found = pose; }
    }
  }
  memo.set(key, found ?? null);
  return found;
}

/** Ships its owner's side keeps where they are: held for boarding or a bridge, being boarded, or ferrying crew. */
function reservedShips(units: readonly Unit[], held: ReadonlySet<string>) {
  const reserved = new Set(held);
  for (const unit of units) if (unit.hp > 0 && unit.order.type === 'board') {
    reserved.add(unit.order.transportId);
    if (unit.deck) reserved.add(unit.deck.shipId);
    if (unit.order.rendezvous) reserved.add(unit.order.rendezvous.sourceId);
  }
  return reserved;
}

/** Sends each hull its side's land units are held up by (see @@@give-way) to its deep mooring. */
export function giveWayHulls(map: GameMap, units: readonly Unit[], inTheWay: ReadonlySet<Unit>, held: ReadonlySet<string>,
  starts: ReadonlyMap<string, ShipPose>, assign: (ship: Unit, order: UnitOrder) => void) {
  if (!inTheWay.size) return;
  let reserved: Set<string> | undefined;
  for (const ship of inTheWay) {
    const sailing = ship.sailing, start = starts.get(ship.id);
    if (!sailing || ship.hp <= 0 || ship.owner === 'neutral' || !shipProfile(ship)) continue;
    const still = !!start && start.x === ship.x && start.y === ship.y && start.heading === sailing.heading;
    if (!(ship.order.type === 'idle' && !ship.orderQueue?.length || ship.order.type === 'move' && still)) continue;
    if (!hullOnWalkway(map, ship, { x: ship.x, y: ship.y, heading: sailing.heading })) continue;
    reserved ??= reservedShips(units, held);
    if (reserved.has(ship.id)) continue;
    const mooring = deepMooring(map, ship), order = ship.order;
    // Already on its way there (a route still being planned stands still): leave it be.
    if (!mooring || order.type === 'move' && order.x === mooring.x && order.y === mooring.y && order.heading === mooring.heading) continue;
    const resume = ship.order.type === 'idle' ? [] : [ship.order, ...(ship.orderQueue ?? [])];
    assign(ship, { type: 'move', x: mooring.x, y: mooring.y, heading: mooring.heading });
    if (resume.length) ship.orderQueue = resume;
  }
}
