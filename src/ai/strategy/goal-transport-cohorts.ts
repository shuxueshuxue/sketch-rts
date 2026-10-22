import { effectiveCombatRating } from '../policy/v6/strength';
import { goalFact, goalValueKey, resolveGoalCamp } from './goal-facts';
import type { GoalCandidates, GoalCohortOption, GoalFact, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import type { Target } from './types';
import { landIdAt } from './regions';
import { goalStartedCohortGroups, type GoalStartedCohortReader } from './goal-started-cohort';

/** Conditional landing shapes for existing members. These are alternatives
 * for regression, never observations or allocation bindings. Every position
 * comes from the same published physical transport options as its achiever. */
export function createGoalTransportCohorts(context: GoalPlanningContext, ports: Pick<GoalGroundingReader, 'transportOptions'> & Readonly<{
  allowedUnitIds?: readonly string[]; interruptedUnitIds?: readonly string[];
  startedCohort?: GoalStartedCohortReader;
}>):
  NonNullable<GoalGroundingReader['cohortOptions']> {
  const memo = new Map<string, GoalCandidates<GoalCohortOption>>();
  return effect => {
    const prior = memo.get(effect.id); if (prior) return prior;
    const p = effect.predicate;
    let target: Target | undefined;
    if (p.kind === 'camp-cleared') {
      const camp = resolveGoalCamp(context.snapshot, p.campId);
      if (camp.status === 'present') {
        const landId = landIdAt(context.snapshot.map, camp.exposure.camp.center);
        if (landId) target = { landId, point: camp.exposure.camp.center };
      }
    } else if ('at' in p) target = p.at;
    if (!target?.landId) return { state: 'unmet', reason: { code: 'cohort-landing-target-required', factIds: [effect.id], values: {} } };
    const byTick = 'byTick' in p ? p.byTick : (context.planThroughTick ?? context.tick + context.situation.horizonTicks);
    const worker = p.kind === 'worker-at';
    const requested = p.kind === 'worker-at' && p.worker?.kind === 'existing' ? [p.worker.entityId]
      : (p.kind === 'force-at' || p.kind === 'force-available') && p.cohort?.every(ref => ref.kind === 'existing')
        ? p.cohort.map(ref => ref.kind === 'existing' ? ref.entityId : '') : null;
    const current = new Map(context.snapshot.units.filter(unit => unit.owner === context.owner && unit.hp > 0
      && unit.expiresTick === undefined && (ports.allowedUnitIds === undefined || ports.allowedUnitIds.includes(unit.id))
      && !ports.interruptedUnitIds?.includes(unit.id)
      && (worker ? unit.kind === 'worker' : unit.kind !== 'worker' && unit.attackDamage > 0))
      .map(unit => [unit.id, unit]));
    const pools = new Map<string, { from: Target; ids: string[] }>();
    for (const unit of [...context.situation.units].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!current.has(unit.id) || requested && !requested.includes(unit.id)) continue;
      const location = unit.location;
      if (location.kind !== 'land' && location.kind !== 'aboard' || location.kind === 'land' && location.landId === target.landId) continue;
      const key = location.kind === 'land' ? location.landId : `aboard:${location.shipId}`;
      const from: Target = location.kind === 'land' ? { landId: location.landId, point: location.point }
        : { seaId: location.seaId, point: location.point };
      const group = pools.get(key) ?? { from, ids: [] }; group.ids.push(unit.id); pools.set(key, group);
    }
    const candidates: GoalCohortOption[] = [], deferred: NonNullable<Extract<GoalCandidates<never>, { state: 'met' }>['deferred']>[number][] = [];
    const preferred = !worker ? goalStartedCohortGroups(context, effect, [...current.values()], ports.startedCohort) : undefined;
    for (const [, pool] of [...pools].sort(([a], [b]) => a.localeCompare(b))) {
      const groups = preferred ? preferred.filter(group => group.every(unit => pool.ids.includes(unit.id))).map(group => group.map(unit => unit.id))
        : worker ? pool.ids.map(id => [id]) : [pool.ids, ...(pool.ids.length > 1 ? pool.ids.map(id => [id]) : [])];
      for (const ids of groups) {
        if (requested && (ids.length !== requested.length || requested.some(id => !ids.includes(id)))) continue;
        const cohort = ids.map(entityId => ({ kind: 'existing' as const, entityId }));
        // A newly spawned, unselected pool member must not move the chosen
        // group's pickup anchor merely by sorting before its members.
        const first = current.get(ids[0]!);
        const origin = preferred && pool.from.landId && first
          ? { ...pool.from, point: { x: first.x, y: first.y } } : pool.from;
        const result = ports.transportOptions(origin, target, 0, { cohort });
        const id = `landing-cohort:${goalValueKey([effect.id, cohort])}`;
        if (result.state === 'pending') { deferred.push({ id, requestIds: result.requestIds, reason: result.reason }); continue; }
        if (result.state !== 'met') continue;
        deferred.push(...(result.deferred ?? []));
        for (const option of result.candidates) {
          const from: Target = { landId: target.landId, point: option.landing.ground };
          const members = ids.map(entityId => {
            const assessment = { ...current.get(entityId)!, x: from.point.x, y: from.point.y };
            delete assessment.deck; delete assessment.cabin;
            return { reference: { kind: 'existing' as const, entityId }, assessment };
          });
          const fact: GoalFact = worker ? goalFact({ kind: 'worker-at', at: from, count: 1, worker: cohort[0]!, byTick })
            : goalFact({ kind: 'force-available', at: from, cohort, metric: 'combat-rating', byTick,
              minimum: members.reduce((sum, member) => sum + effectiveCombatRating(context.snapshot, member.assessment), 0) });
          candidates.push({ id: `${id}:${option.id}`, members, from, preconditions: [fact], availableTick: null,
            factIds: [...option.factIds, fact.id] });
        }
      }
    }
    const result: GoalCandidates<GoalCohortOption> = candidates.length ? { state: 'met', candidates,
      factIds: [...new Set(candidates.flatMap(candidate => candidate.factIds))].sort(), ...(deferred.length ? { deferred } : {}) }
      : deferred.length ? { state: 'pending', requestIds: [...new Set(deferred.flatMap(item => item.requestIds))].sort(),
        reason: { code: 'cohort-landing-facts-pending', factIds: [effect.id], values: {} } }
      : { state: 'unmet', reason: { code: 'no-existing-transport-cohort', factIds: [effect.id], values: {} } };
    memo.set(effect.id, result); return result;
  };
}
