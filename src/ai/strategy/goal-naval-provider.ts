import { bodyMass } from '../../shared/physical-body';
import { isTransportKind } from '../../shared/transport-role';
import { goalFact, goalValueKey } from './goal-facts';
import { declareGoalGarrison } from './goal-garrison-action';
import { declareGoalAssembly, declareGoalCampClearing, declareGoalDefense, declareGoalEvacuation,
  declareGoalForceTransport, declareGoalShoreClearing, declareGoalTransportReposition,
  declareGoalWorkerTransport, goalAssemblyPostSource, type GoalNavalEstimates, type GoalNavalMember } from './goal-naval-actions';
import { effectiveCombatRating } from '../policy/v6/strength';
import { withGoalSafetyPreconditionWindows } from './goal-safety-preconditions';
import type { GoalActionDeclaration, GoalActionProvider, GoalCombatOption, GoalFact, GoalPlanningContext } from './goal-planner-types';

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function resolved(option: GoalCombatOption, context: GoalPlanningContext): readonly GoalNavalMember[] | null {
  const candidates = context.grounding?.resolveCohort?.(option.cohort);
  if (!candidates || candidates.state !== 'met') return null;
  const selected = [...new Map(candidates.candidates.map(member => [goalValueKey(member.reference), member])).values()]
    .sort((a, b) => order(goalValueKey(a.reference), goalValueKey(b.reference)));
  if (goalValueKey(selected.map(member => goalValueKey(member.reference))) !== goalValueKey([...new Set(option.cohort.map(goalValueKey))].sort())) return null;
  const from = option.from;
  const force = selected.reduce((sum, member) => sum + effectiveCombatRating(context.snapshot, member.assessment), 0);
  const conditional = from?.landId && (goalAssemblyPostSource(option.preconditions, from,
    selected.map(member => member.reference), force) || option.preconditions.some(fact => {
    const p = fact.predicate;
    return p.kind === 'force-available' && p.at.landId === from.landId && p.cohort
      && goalValueKey([...new Set(p.cohort.map(goalValueKey))].sort()) === goalValueKey(selected.map(member => goalValueKey(member.reference)))
      || p.kind === 'worker-at' && p.at.landId === from.landId && selected.length === 1 && p.worker
        && goalValueKey(p.worker) === goalValueKey(selected[0]!.reference);
  }));
  if (conditional && selected.every(member => member.reference.kind === 'existing')) {
    return selected.flatMap(member => {
      const actual = context.snapshot.units.find(unit => member.reference.kind === 'existing' && unit.id === member.reference.entityId);
      return actual && actual.owner === context.owner && actual.hp > 0 ? [{ reference: member.reference,
        assessment: { ...actual, x: from.point.x, y: from.point.y, deck: undefined, cabin: undefined } }] : [];
    });
  }
  return selected;
}
function withFacts(action: GoalActionDeclaration | null, preconditions: readonly GoalFact[]): GoalActionDeclaration | null {
  if (!action) return null;
  return { ...action, preconditions: [...new Map([...action.preconditions, ...preconditions].map(fact => [fact.id, fact])).values()]
    .sort((a, b) => order(a.id, b.id)) };
}

/** Enumerates one world-effect achiever per shared physical option. There is
 * no action order here. Routes, selected cohorts, future shapes and estimates
 * come from the owner-think source, including pending answers. */
export const goalNavalActionProvider: GoalActionProvider = {
  id: 'goal:naval-and-defense',
  actionsFor(effect, context) {
    const predicate = effect.predicate;
    if (!['gold', 'camp-cleared', 'shore-safe', 'site-safe', 'garrison-ready', 'assets-safe', 'force-at', 'force-available', 'worker-at', 'transport-at'].includes(predicate.kind)) return [];
    const candidates = context.grounding?.combatOptions?.(effect);
    if (!candidates || candidates.state !== 'met') return [];
    const actions: GoalActionDeclaration[] = [];
    for (const option of candidates.candidates) {
      const cohort = resolved(option, context);
      if (!cohort?.length) continue;
      const estimates: GoalNavalEstimates = { duration: option.duration, cost: option.cost, successProbability: option.successProbability };
      const base = { snapshot: context.snapshot, owner: context.owner, cohort, byTick: option.byTick, estimates };
      let action: GoalActionDeclaration | null = null;
      if (predicate.kind === 'camp-cleared') action = declareGoalCampClearing({ ...base, campId: predicate.campId,
        at: option.target, routes: option.preconditions });
      else if (predicate.kind === 'gold' && option.campId) action = declareGoalCampClearing({ ...base, campId: option.campId,
        at: option.target, routes: option.preconditions });
      else if (predicate.kind === 'garrison-ready') action = declareGoalGarrison({ ...option, mineId: predicate.mineId,
        at: predicate.at, throughTick: option.byTick }, context);
      else if (predicate.kind === 'site-safe') action = declareGoalDefense({ ...base, site: predicate.site,
        post: option.target,
        ...(option.effectDelayTicks ? { effectDelayTicks: option.effectDelayTicks } : {}),
        throughTick: predicate.throughTick, requiredForce: option.requiredForce, routes: option.preconditions });
      else if (predicate.kind === 'shore-safe') {
        const observation = context.readFact(effect);
        if (observation.threats?.unitIds.length) action = declareGoalShoreClearing({ ...base,
          landing: predicate.landing, threatIds: observation.threats.unitIds, requiredForce: option.requiredForce,
          throughTick: predicate.throughTick, routes: option.preconditions });
      } else if (predicate.kind === 'assets-safe' && option.from) {
        // A rescue action may not silently acquire workers outside the target.
        const ids = cohort.flatMap(member => member.reference.kind === 'existing' ? [member.reference.entityId] : []);
        if (ids.length === cohort.length && goalValueKey(ids.slice().sort()) === goalValueKey(predicate.unitIds.slice().sort()))
          action = declareGoalEvacuation({ ...base, from: option.from, shelter: predicate.at,
            throughTick: predicate.throughTick, routes: option.preconditions });
      } else if (predicate.kind === 'transport-at') {
        const member = cohort.find(member => goalValueKey(member.reference) === goalValueKey(predicate.transport));
        const current = predicate.transport.kind === 'existing'
          ? context.snapshot.units.find(unit => predicate.transport.kind === 'existing' && unit.id === predicate.transport.entityId) : undefined;
        if (member && isTransportKind(member.assessment.kind) && member.assessment.owner === context.owner && member.assessment.hp > 0
          && (predicate.transport.kind !== 'existing' || current && current.hp > 0 && current.owner === context.owner && current.kind === member.assessment.kind)) {
          const id = predicate.transport.kind === 'existing' ? predicate.transport.entityId : null;
          const cargo = id ? context.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === id) : [];
          if (cargo.every(unit => unit.owner === context.owner)) action = declareGoalTransportReposition({ transport: predicate.transport,
            at: predicate.at, dependentUnitIds: cargo.map(unit => unit.id), tolerance: predicate.tolerance,
            tick: context.tick, byTick: predicate.byTick, estimates, preconditions: option.preconditions });
        }
      } else if (predicate.kind === 'force-at' && option.from?.landId && option.from.landId === predicate.at.landId) {
        action = declareGoalAssembly({ ...base, from: option.from, at: predicate.at,
          ...(predicate.metric === 'camp-force' ? { campId: predicate.campId } : {}),
          safePost: predicate.metric === 'camp-force' ? goalFact({ kind: 'camp-staging', campId: predicate.campId, at: predicate.at, cohort: option.cohort })
            : goalFact({ kind: 'assembly-post', at: predicate.at, cohort: option.cohort }), routes: option.preconditions });
      } else if ((predicate.kind === 'force-available' || predicate.kind === 'worker-at') && option.from
        && (option.from.seaId || option.from.landId !== predicate.at.landId)) {
        const mass = cohort.filter(member => !member.assessment.deck && !member.assessment.cabin)
          .reduce((sum, member) => sum + bodyMass(member.assessment), 0);
        const transport = context.grounding!.transportOptions(option.from, predicate.at, mass, { cohort: option.cohort });
        if (transport.state === 'met') for (const crossing of transport.candidates) {
          const hull = crossing.transport.kind === 'existing'
            ? context.snapshot.units.find(unit => crossing.transport.kind === 'existing' && unit.id === crossing.transport.entityId) : undefined;
          // A future hull's radius is a shared physical assessment, never a
          // catalog default inferred from the producer action's spelling.
          const hullMembers = context.grounding!.resolveCohort?.([crossing.transport]);
          const radius = hull?.radius ?? (hullMembers?.state === 'met' ? hullMembers.candidates[0]?.assessment.radius : undefined);
          if (radius === undefined) continue;
          const unquoted = (field: string) => ({ state: 'pending' as const, requestIds: [crossing.id],
            reason: { code: `transport-option-${field}-unquoted`, factIds: crossing.factIds, values: {} } });
          const input = { ...base, option: crossing, berthTolerance: radius, pickupRoutes: [], estimates: {
            duration: crossing.duration, cost: crossing.cost ?? unquoted('cost'),
            successProbability: crossing.successProbability ?? unquoted('probability'),
          } };
          const carried = withFacts(predicate.kind === 'worker-at' ? declareGoalWorkerTransport(input) : declareGoalForceTransport(input), option.preconditions);
          if (carried) actions.push(carried);
        }
      }
      const augmented = withFacts(action, option.preconditions);
      if (augmented) actions.push(augmented);
    }
    return [...new Map(actions.map(action => [action.id, action])).values()]
      .map(action => withGoalSafetyPreconditionWindows(action, context.tick)).map(action => context.precision === 'coarse'
      ? { ...action, precision: 'coarse' as const, reasons: [...action.reasons, {
        code: 'coarse-naval-conditional-quotation', factIds: action.preconditions.map(fact => fact.id),
        values: { optimisticSearchOnly: true, exactRefinementRequired: true },
      }] } : action).sort((a, b) => order(a.id, b.id));
  },
};
