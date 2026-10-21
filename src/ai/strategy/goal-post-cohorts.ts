import { goalValueKey } from './goal-facts';
import type { GoalCohortOption, GoalFact, GoalPlannerInput, GoalPlanningContext } from './goal-planner-types';

type Prefix = Parameters<NonNullable<GoalPlannerInput['contextForPrefix']>>[0];
/** A selected assembly's exact post is a conditional source, not another
 * inventory. Later movements supersede it. Original HP/weapons/identity stay
 * unchanged and the producing force-at proof must be regressed normally. */
export function goalPostCohorts(effect: GoalFact, context: GoalPlanningContext, actions: Prefix): GoalCohortOption[] {
  const p = effect.predicate;
  if (p.kind !== 'force-at' && p.kind !== 'garrison-ready') return [];
  const target = p.at, requested = p.kind === 'force-at' ? p.cohort : undefined;
  const latest = new Map<string, string>();
  const posts: { fact: GoalFact; tick: number; actionId: string }[] = [];
  for (const step of [...actions].sort((a, b) => a.finishTick - b.finishTick || a.action.id.localeCompare(b.action.id))) {
    const members = step.action.executor.parameters.cohort;
    if (['assemble', 'transport-force', 'evacuate'].includes(step.action.kind) && Array.isArray(members))
      for (const ref of members) if (ref && typeof ref === 'object' && !Array.isArray(ref) && ref.kind === 'existing' && typeof ref.entityId === 'string')
        latest.set(ref.entityId, step.action.id);
    if (step.action.kind === 'assemble') for (const effect of step.action.effects) {
      const fact = effect.fact;
      if (effect.operation === 'establish' && fact.predicate.kind === 'force-at' && fact.predicate.metric === 'combat-rating')
        posts.push({ fact, tick: step.finishTick, actionId: step.action.id });
    }
  }
  return posts.flatMap(({ fact, tick, actionId }) => {
    const source = fact.predicate;
    if (source.kind !== 'force-at' || !source.cohort?.length || source.at.landId !== target.landId
      || requested && goalValueKey(requested) !== goalValueKey(source.cohort)
      || goalValueKey(source.at) === goalValueKey(target)) return [];
    const members = source.cohort.flatMap(reference => {
      if (reference.kind !== 'existing' || latest.get(reference.entityId) !== actionId) return [];
      const unit = context.snapshot.units.find(unit => unit.id === reference.entityId && unit.owner === context.owner && unit.hp > 0);
      if (!unit) return [];
      const assessment = { ...unit, x: source.at.point.x, y: source.at.point.y };
      delete assessment.deck; delete assessment.cabin;
      return [{ reference, assessment }];
    });
    return members.length === source.cohort.length ? [{ id: `selected-post:${fact.id}`, members,
      from: source.at, preconditions: [fact], availableTick: tick, factIds: [fact.id] }] : [];
  });
}
