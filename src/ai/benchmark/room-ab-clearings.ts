import type { GameSnapshot } from '../../shared/types';
import type { Clearing, RoomSeatMetrics } from './room-ab-metrics';

/** Output-only #570 normalization. A conquest can clear a road camp without clearing its target mine's guard. */
export function canonicalRoomAbClearings<T extends {
  clearings: Clearing[]; seats: Record<string, RoomSeatMetrics>; events: unknown[];
}>(raw: T, initial: Pick<GameSnapshot, 'units' | 'resources'>) {
  const units = new Map(initial.units.map(u => [u.id, u]));
  const clearingAssociations = raw.clearings.map(c => {
    const members = c.memberIds.map(id => units.get(id));
    const mine = initial.resources.find(m => m.id === c.mineId);
    if (!mine || !members.length || members.some(u => !u)) throw new Error(`Cannot resolve clearing membership/mine: ${c.id}`);
    const x = members.reduce((sum, u) => sum + (u!.homeX ?? u!.x), 0) / members.length;
    const y = members.reduce((sum, u) => sum + (u!.homeY ?? u!.y), 0) / members.length;
    const distance = Math.hypot(x - mine.x, y - mine.y);
    return { id: c.id, owner: c.owner, mineId: c.mineId, distance, association: distance <= 450 ? 'mine-guard' as const : 'road-camp' as const };
  });
  const guards = new Set(clearingAssociations.filter(c => c.association === 'mine-guard').map(c => c.id));
  const completed = raw.clearings.filter(c => guards.has(c.id) && c.start !== null && c.complete !== null);
  const first = (values: (number | null)[]) => values.reduce<number | null>((result, value) =>
    value === null ? result : result === null ? value : Math.min(result, value), null);
  const seats = Object.fromEntries(Object.entries(raw.seats).map(([owner, metric]) => {
    const own = raw.clearings.filter(c => c.owner === owner && guards.has(c.id));
    const done = completed.filter(c => c.owner === owner);
    return [owner, { ...metric, firstIslandClearStart: first(own.map(c => c.start)),
      firstIslandClearComplete: first(done.map(c => c.complete)),
      completed: { ...metric.completed, islandClears: done.length },
      completedBy15m: { ...metric.completedBy15m, islandClears: done.filter(c => c.complete! <= 18_000).length } }];
  }));
  const events = raw.events.filter(event => {
    const row = event as { type?: string; kind?: string };
    return row.type !== 'goal-completed' || row.kind !== 'islandClears';
  }).concat(completed.map(c => ({ type: 'goal-completed', kind: 'islandClears', owner: c.owner,
    tick: c.complete, clearingId: c.id, association: 'mine-guard' })));
  return { ...raw, version: 2, seats, events, clearingAssociations };
}
