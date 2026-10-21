import type { GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import { goalValueKey } from './goal-facts';

/** Geometry in this view is a search relaxation, explicitly identified in
 * provenance. The view cannot supply executor facts or validate a ready atom. */
export function readGoalCoarseGeometryFact(fact: GoalFact, context: GoalPlanningContext): GoalFactObservation | null {
  if (context.precision !== 'coarse') return null;
  const p = fact.predicate;
  if (!['route', 'build-site', 'spawn-exit', 'camp-staging', 'assembly-post'].includes(p.kind)) return null;
  const componentsDiffer = p.kind === 'route' && (p.mover === 'land'
    ? p.from.landId && p.to.landId && p.from.landId !== p.to.landId
    : p.from.seaId && p.to.seaId && p.from.seaId !== p.to.seaId);
  return { fact, state: componentsDiffer ? 'unmet' : 'met', observedTick: context.tick,
    revision: `coarse:${goalValueKey(p)}`, availableTick: context.tick, evidence: [],
    reason: { code: componentsDiffer ? 'coarse-components-disconnected' : 'coarse-geometry-optimistic-bound',
      factIds: [fact.id], values: { precision: 'coarse' } },
    ...(p.kind === 'route' ? { route: { distance: Math.hypot(p.from.point.x - p.to.point.x, p.from.point.y - p.to.point.y),
      ticks: 0, points: [p.from.point, p.to.point] } } : {}) };
}
