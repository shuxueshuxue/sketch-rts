import type { Unit } from '../../shared/types';
import { effectiveCombatRating } from '../policy/v6/strength';
import { assessAllocatedForce } from './allocated-force';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { resolveGoalCamp } from './goal-facts';
import type { GoalEntityReference, GoalFact, GoalPlanningContext } from './goal-planner-types';
import { landIdAt } from './regions';

/** Same-goal, actually started work only. The owner source supplies this
 * preference; it is neither a world fact nor proof of presence or a lease. */
export type GoalStartedCohortReader = (effect: GoalFact) => readonly GoalEntityReference[] | undefined;

/** Preserve an embarked/assembling group before considering new pool members.
 * Available actors already exclude dead, foreign and interrupted members.
 * Undefined preserves the uncommitted enumeration; [] means this pool cannot
 * replace the committed group. No route, fact or authority reader is called. */
export function goalStartedCohortGroups(context: Pick<GoalPlanningContext, 'snapshot' | 'owner'>,
  effect: GoalFact, available: readonly Unit[], read?: GoalStartedCohortReader): readonly (readonly Unit[])[] | undefined {
  const p = effect.predicate;
  // An explicit cohort is a world requirement, never an invitation to drop a
  // late member. Worker/asset manifests also retain their exact membership.
  if (p.kind === 'worker-at' || p.kind === 'assets-safe'
    || (p.kind === 'force-at' || p.kind === 'force-available') && p.cohort) return undefined;
  const references = read?.(effect);
  if (!references?.length || references.some(ref => ref.kind !== 'existing')) return undefined;
  const ids = new Set(references.flatMap(ref => ref.kind === 'existing' ? [ref.entityId] : []));
  const pool = [...new Map(available.map(unit => [unit.id, unit])).values()];
  const retained = pool.filter(unit => ids.has(unit.id)).sort((a, b) => a.id.localeCompare(b.id));
  const campId = p.kind === 'camp-cleared' ? p.campId
    : (p.kind === 'force-at' || p.kind === 'force-available') && p.metric === 'camp-force' ? p.campId : undefined;
  const camp = campId ? resolveGoalCamp(context.snapshot, campId) : undefined;
  const sufficient = camp?.status === 'present' ? (group: readonly Unit[]) => {
    const force = assessAllocatedForce(context.owner, group, { metric: 'camp-force', camp: camp.exposure.camp });
    return group.length > 0 && force.force + 1e-9 >= Math.max(force.requiredForce,
      p.kind === 'force-at' || p.kind === 'force-available' ? p.minimum : 0);
  } : (p.kind === 'force-at' || p.kind === 'force-available') && p.metric !== 'camp-force' ? (group: readonly Unit[]) => {
    const force = p.metric === 'combat-rating'
      ? group.reduce((sum, unit) => sum + effectiveCombatRating(context.snapshot, unit), 0)
      : assessAllocatedForce(context.owner, group, { metric: 'field-strength', requiredForce: p.minimum }).force;
    return group.length > 0 && force + 1e-9 >= p.minimum;
  } : undefined;
  // Non-quantity protection goals retain the unchanged group. Their own
  // exact combat/safety assessment still decides adequacy; when a member is
  // lost the ordinary alternatives may replace it rather than invent a bound.
  if (!sufficient) return retained.length === ids.size ? [retained] : undefined;
  if (p.kind === 'force-at') {
    const present = retained.filter(unit => !unit.deck && !unit.cabin
      && landIdAt(context.snapshot.map, unit) === p.at.landId
      && Math.hypot(unit.x - p.at.point.x, unit.y - p.at.point.y) <= ASSEMBLY_RANGE);
    if (sufficient(present)) return [present];
  }
  if (sufficient(retained)) return [retained];
  const region = (unit: Unit) => unit.deck || unit.cabin ? `aboard:${(unit.deck ?? unit.cabin)!.shipId}`
    : landIdAt(context.snapshot.map, unit);
  const retainedRegions = new Set(retained.map(region));
  // Members partly boarding or spanning regions do not become one fictitious
  // origin. Keep their identity for the caller's pending physical check.
  if (retainedRegions.size > 1) return [retained];
  const point = 'at' in p ? p.at.point : retained.length ? {
    x: retained.reduce((sum, unit) => sum + unit.x, 0) / retained.length,
    y: retained.reduce((sum, unit) => sum + unit.y, 0) / retained.length,
  } : camp?.status === 'present' ? camp.exposure.camp.center : { x: 0, y: 0 };
  const pools = new Map<string, Unit[]>();
  for (const unit of pool) {
    const key = region(unit);
    if (!key || retained.length && key !== region(retained[0]!)) continue;
    const group = pools.get(key) ?? []; group.push(unit); pools.set(key, group);
  }
  return [...pools].sort(([a], [b]) => a.localeCompare(b)).map(([, units]) => {
    const group = [...retained];
    const extras = units.filter(unit => !ids.has(unit.id)).sort((a, b) =>
      Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y) || a.id.localeCompare(b.id));
    for (const unit of extras) {
      if (sufficient(group)) break;
      group.push(unit);
    }
    return group.sort((a, b) => a.id.localeCompare(b.id));
  }).filter(group => group.length);
}
