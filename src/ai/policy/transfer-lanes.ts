import { unitMover } from '../../shared/catalog';
import { walkDestination, isWalkable } from '../../shared/terrain';
import { distanceToHull } from '../../shared/ship-geometry';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { distance } from './spatial';

const cache = new WeakMap<GameSnapshot, Map<PlayerId, GameCommand[]>>();
/** AI troops clear a crowded quay with ordinary movement. The usable crossing
 * extends into the deck, so clearing just the shore's centre line is insufficient.
 * Human units and combat orders retain their own control. */
export function clearTransferLanes(snapshot: GameSnapshot, owner: PlayerId): GameCommand[] {
  let owners = cache.get(snapshot);
  if (!owners) { owners = new Map(); cache.set(snapshot, owners); }
  const known = owners.get(owner);
  if (known) return known;
  const own = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land');
  const commands: GameCommand[] = [], assigned = new Set<string>();
  const destinations: { x: number; y: number; radius: number }[] = [];
  for (const passenger of own) {
    const order = passenger.order;
    if (order.type !== 'board' || !order.berth) continue;
    const boat = snapshot.units.find(unit => unit.id === order.transportId);
    if (!boat) continue;
    const shore = order.berth.shore ?? order.berth;
    if (distance(passenger, shore) > 300) continue;
    const dx = passenger.x - shore.x, dy = passenger.y - shore.y, length = Math.hypot(dx, dy) || 1;
    for (const unit of own) {
      if (assigned.has(unit.id) || unit.kind === 'worker' || distance(unit, shore) > 220) continue;
      if (unit.order.type === 'move' && unit.order.avoidCombat) {
        assigned.add(unit.id);
        commands.push({ type: 'move', unitIds: [unit.id], x: unit.order.x, y: unit.order.y, avoidCombat: true });
        continue;
      }
      if (!['idle', 'hold'].includes(unit.order.type)) continue;
      let goal: { x: number; y: number } | undefined;
      for (const reach of [250, 330, 410]) {
        for (const lateral of [0, 80, -80, 160, -160]) {
          const point = walkDestination(snapshot.map, unit, { x: shore.x + dx / length * reach - dy / length * lateral, y: shore.y + dy / length * reach + dx / length * lateral });
          if (!isWalkable(snapshot.map, point.x, point.y) || distance(point, shore) < 220 || distanceToHull(boat, point) < unit.radius + 80) continue;
          if (destinations.some(d => distance(d, point) < d.radius + unit.radius + 8)) continue;
          if (snapshot.units.some(other => other.id !== unit.id && !other.deck && distance(other, point) < other.radius + unit.radius + 8)) continue;
          goal = point; break;
        }
        if (goal) break;
      }
      if (!goal) continue;
      assigned.add(unit.id); destinations.push({ ...goal, radius: unit.radius });
      commands.push({ type: 'move', unitIds: [unit.id], ...goal, avoidCombat: true });
    }
  }
  owners.set(owner, commands);
  return commands;
}
