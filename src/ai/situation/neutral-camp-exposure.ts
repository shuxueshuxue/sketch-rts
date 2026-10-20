import { NEUTRAL_ALERT_RANGE, NEUTRAL_ASSIST_RANGE, NEUTRAL_DAMAGE_RESPONSE_RANGE, NEUTRAL_LEASH_RANGE, NEUTRAL_RETURN_STOP_RANGE } from '../../shared/combat-acquisition';
import type { GameSnapshot, Unit } from '../../shared/types';
import { neutralCamps, type Camp } from '../policy/v7/creep';
import { strengthOf } from '../policy/v6/strength';
export { unitAutoAcquireRadius } from '../../shared/combat-acquisition';

type Point = Readonly<{ x: number; y: number }>;
export type NeutralCampMemberExposure = Readonly<{
  id: string; point: Point; home: Point; responseOrigin: Point;
  alertRadius: number; assistRadius: number; pursuitRadius: number; responseRadius: number;
  activeTargetId: string | null; active: boolean; returning: boolean;
}>;
export type NeutralCampExposure = Readonly<{
  /** The existing neutralCamps group, for creepForce/forceFor. Read-only by contract. */
  camp: Readonly<Camp>; memberIds: readonly string[]; members: readonly NeutralCampMemberExposure[];
}>;
export type NeutralCampExposureFacts = Readonly<{ tick: number; camps: readonly NeutralCampExposure[] }>;

type Group = { ids: readonly string[]; center: Camp['center']; reach: number };
// Snapshot map wrappers and unit lists are replaced every think. Grouping is a
// terrain-scoped fact; keep one current dynamic value, never a history of frames.
const geometry = new WeakMap<object, { key: string; groups: readonly Group[] }>();
const states = new WeakMap<object, { groups: readonly Group[]; camps: readonly NeutralCampExposure[] }>();
const frames = new WeakMap<GameSnapshot, NeutralCampExposureFacts>();

function sameRecord(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b) || Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
  let count = 0, previous = 0;
  for (const key in a) if (Object.hasOwn(a, key)) {
    if (!Object.hasOwn(b, key) || !sameRecord((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    count++;
  }
  for (const key in b) if (Object.hasOwn(b, key)) previous++;
  return count === previous;
}

/** Shared situation facts, independent of owner, task, route or policy memory.
 * Home grouping is recomputed only on membership/home changes; moving, wounded,
 * activated, returning or dead members refresh dynamic facts, including in-place edits.
 * No map ID or second camp numbering scheme. Target exemptions use member IDs.
 */
export function neutralCampExposure(snapshot: GameSnapshot): NeutralCampExposureFacts {
  const neutrals = snapshot.units.filter(unit => unit.owner === 'neutral' && unit.attackDamage > 0 && unit.hp > 0);
  const namespace = snapshot.map.terrain ?? snapshot.map;
  const groupKey = neutrals.map(unit => `${unit.id}:${unit.homeX ?? unit.x}:${unit.homeY ?? unit.y}`).join('|');
  let retained = states.get(namespace);
  {
    let layout = geometry.get(namespace);
    if (!layout || layout.key !== groupKey) {
      layout = { key: groupKey, groups: neutralCamps({ ...snapshot, units: neutrals }).map(camp =>
        ({ ids: Object.freeze(camp.creeps.map(unit => unit.id)), center: Object.freeze({ ...camp.center }), reach: camp.reach })) };
      geometry.set(namespace, layout);
    }
    const byId = new Map<string, Unit>();
    for (const unit of neutrals) byId.set(unit.id, unit);
    let changed = retained?.groups !== layout.groups;
    const camps = layout.groups.map((group, index) => {
      const previous = retained?.groups === layout.groups ? retained.camps[index] : undefined;
      if (previous && previous.camp.creeps.every(unit => sameRecord(byId.get(unit.id), unit))) return previous;
      changed = true;
      const creeps = Object.freeze(group.ids.map(id => {
        const unit = byId.get(id)!;
        const copy = structuredClone(unit);
        Object.freeze(copy.order); return Object.freeze(copy);
      }));
      const members = creeps.map(unit => {
        const point = Object.freeze({ x: unit.x, y: unit.y });
        const home = Object.freeze({ x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y });
        const order = unit.order;
        const responseOrigin = Object.freeze({ x: order.type === 'attack' ? order.leashX ?? home.x : home.x,
          y: order.type === 'attack' ? order.leashY ?? home.y : home.y });
        return Object.freeze({ id: unit.id, point, home, responseOrigin,
          alertRadius: NEUTRAL_ALERT_RANGE, assistRadius: NEUTRAL_ASSIST_RANGE,
          pursuitRadius: NEUTRAL_LEASH_RANGE, responseRadius: NEUTRAL_DAMAGE_RESPONSE_RANGE,
          activeTargetId: order.type === 'attack' ? order.targetId : null, active: order.type === 'attack',
          returning: order.type === 'move' && Math.hypot(order.x - home.x, order.y - home.y) <= NEUTRAL_RETURN_STOP_RANGE });
      });
      return Object.freeze({ camp: Object.freeze({ center: group.center, creeps, reach: group.reach, strength: strengthOf(creeps) }),
        memberIds: group.ids, members: Object.freeze(members) });
    });
    if (changed) { retained = { groups: layout.groups, camps: Object.freeze(camps) }; states.set(namespace, retained); }
  }
  const previous = frames.get(snapshot);
  if (previous && previous.tick === snapshot.tick && previous.camps === retained!.camps) return previous;
  const facts = Object.freeze({ tick: snapshot.tick, camps: retained!.camps }); frames.set(snapshot, facts); return facts;
}
