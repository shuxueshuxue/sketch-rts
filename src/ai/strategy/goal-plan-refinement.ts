import { boundCache, touchCache, type CacheCapacity, type CacheUse } from './bounded-cache';
import { discoverGoalActions } from './goal-provider-candidates';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalActionDeclaration, GoalActionProvider, GoalFact, GoalPlan, GoalPlanningContext } from './goal-planner-types';
import { compareConfirmedGoalChoices } from './goal-quote-comparison';

type Entry = CacheUse & { planId?: string; coarse: GoalActionDeclaration; sourceRevision?: string; state: 'pending' | 'known' | 'invalid';
  exact: GoalActionDeclaration[]; reason: GoalPlan['reasons'][number]; preferredExactIndex?: number };
export type GoalRefinementDenial = CacheUse & { planId: string; declaration: GoalActionDeclaration; sourceRevision?: string;
  proofRecipe?: GoalActionDeclaration;
  dependencies: readonly { fact: GoalFact; revision: string; state: string }[];
  rewardGold: number; value: { durationTicks: number; costs: readonly import('./goal-planner-types').GoalActionCost[]; probability: number } };
export type GoalRefinementMemory = { revision: number; entries: Entry[]; capacities?: Record<string, CacheCapacity>;
  denials?: GoalRefinementDenial[]; denialCapacity?: CacheCapacity };

/** A discarded proof leaves its exact price, never an executable declaration.
 * This temporary view is used only to compare a regenerated challenger. */
export function goalDeniedComparison(denial: GoalRefinementDenial): GoalActionDeclaration {
  return { ...denial.declaration, precision: 'exact', duration: { state: 'met', value: denial.value.durationTicks, factIds: [] },
    cost: { state: 'met', value: denial.value.costs, factIds: [] },
    successProbability: { state: 'met', value: denial.value.probability, factIds: [] } };
}
export type GoalExactPreparation = Readonly<{ plan: GoalPlan; deferActionIds: readonly string[]; changed: boolean }>;
/** Optional transient diagnostic. Never retained in owner memory or authority. */
export type GoalRefinementChange = Readonly<{ revision: number; planId: string; actionId: string;
  kind: GoalActionDeclaration['kind']; reason: string; factIds: readonly string[];
  proposalRevision: string;
  sourceRevision?: string; currentSourceRevision?: string;
  selected: readonly Readonly<{ kind: GoalActionDeclaration['kind']; parameters: GoalActionDeclaration['executor']['parameters'];
    effectId?: string }>[] }>;
/** Clock deadlines do not create a new physical proposal. Actual geometry,
 * actors and quoted bounds still participate, so a moved/changed choice cannot
 * borrow another proposal's exact validation. */
const semantic = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(semantic);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['id', 'predicateRef', 'byTick', 'throughTick', 'factIds', 'reasons', 'precision', 'refinementFor', 'regeneration'].includes(key))
      .map(([key, item]) => [key, semantic(item)]));
    return value;
  };
const choiceFamily = (action: GoalActionDeclaration) => goalValueKey([action.kind,
  action.refinementFor?.providerId, semantic(action.refinementFor?.effect.predicate)]);
function proposalKey(action: GoalActionDeclaration): string {
  return goalValueKey(semantic({ kind: action.kind, preconditions: action.preconditions.map(fact => semantic(fact))
    .sort((a, b) => goalValueKey(a).localeCompare(goalValueKey(b))), effects: action.effects,
    preconditionWindows: action.preconditionWindows?.map(window => ({ through: window.through,
      predicate: action.preconditions.find(fact => fact.id === window.factId)?.predicate })),
    executor: action.executor, demands: action.demands, flows: action.flows,
    duration: action.duration, cost: action.cost, successProbability: action.successProbability }));
}
function refreshClock(exact: GoalActionDeclaration, before: GoalActionDeclaration, current: GoalActionDeclaration): GoalActionDeclaration {
  const clocks = new Map<number, number>();
  const pair = (old: unknown, next: unknown) => {
    if (!old || !next || typeof old !== 'object' || typeof next !== 'object') return;
    for (const [key, value] of Object.entries(old)) {
      const following = (next as Record<string, unknown>)[key];
      if (['byTick', 'throughTick'].includes(key) && typeof value === 'number' && typeof following === 'number') clocks.set(value, following);
      else pair(value, following);
    }
  };
  pair(before.executor.parameters, current.executor.parameters);
  pair(before.preconditions, current.preconditions);
  const facts = new Map<string, string>();
  const visit = (value: unknown, key = ''): unknown => {
    if (['byTick', 'throughTick'].includes(key) && typeof value === 'number') return clocks.get(value) ?? value;
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (value && typeof value === 'object') {
      const row = Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name)]));
      if ('predicate' in row && typeof row.id === 'string') {
        const fact = goalFact(row.predicate as import('./goal-planner-types').GoalFactPredicate); facts.set(row.id, fact.id); return fact;
      }
      return row;
    }
    return value;
  };
  const result = visit(exact);
  const references = (value: unknown): unknown => typeof value === 'string' ? facts.get(value) ?? value
    : Array.isArray(value) ? value.map(references) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, references(item)])) : value;
  return references(result) as GoalActionDeclaration;
}
const value = (action: GoalActionDeclaration) => ({ duration: action.duration.state === 'met' ? action.duration.value : null,
  cost: action.cost.state === 'met' ? action.cost.value.reduce((sum, term) => sum + term.gold, 0) : null,
  probability: action.successProbability.state === 'met' ? action.successProbability.value : null });
const sameExecutionProof = (coarse: GoalActionDeclaration, exact: GoalActionDeclaration) => {
  const proof = (action: GoalActionDeclaration) => ({ id: action.id, kind: action.kind, preconditions: action.preconditions,
    preconditionWindows: action.preconditionWindows,
    effects: action.effects, demands: action.demands, flows: action.flows, duration: action.duration, cost: action.cost,
    successProbability: action.successProbability, executor: action.executor, outputs: action.outputs });
  return goalValueKey(proof(coarse)) === goalValueKey(proof(exact));
};
const sameChoice = (a: GoalActionDeclaration, b: GoalActionDeclaration) => {
  if (a.kind !== b.kind) return false;
  const first = a.executor.parameters, second = b.executor.parameters;
  return ['cohort', 'transport', 'unitKind', 'buildingKind', 'campId', 'garrisonMineId'].every(key =>
    first[key] === undefined || second[key] === undefined || goalValueKey(first[key]) === goalValueKey(second[key]));
};

/** Refinement is demand-driven by the chosen graph, never its rejected
 * alternatives. Newly found exact declarations re-enter ordinary regression,
 * sharing the current allowance when the owner enables same-think passes. */
export function createGoalPlanRefiner(input: Readonly<{
  memory: GoalRefinementMemory; providers: readonly GoalActionProvider[];
  exactContext: (selected: readonly GoalActionDeclaration[], plan: GoalPlan) => GoalPlanningContext;
  prepareExact?: (plan: GoalPlan, selected: GoalPlan['actions'], context: GoalPlanningContext) => GoalExactPreparation | undefined;
  sourceRevision?: (action: GoalActionDeclaration) => string;
  /** Reuse already priced alternatives for the same active action/actors.
   * Geometry pins still follow only the currently selected graph. */
  maxAlternativeQuotes?: number;
  thinkSequence?: () => number;
  onRevision?: (change: GoalRefinementChange) => void;
}>) {
  const { memory } = input;
  return (plan: GoalPlan): GoalPlan => {
    const revise = (entry: Entry, reason: string, factIds: readonly string[] = [], currentSourceRevision?: string) => {
      memory.revision++;
      input.onRevision?.({ revision: memory.revision, planId: plan.id, actionId: entry.coarse.id,
        kind: entry.coarse.kind, reason, factIds,
        proposalRevision: proposalKey(entry.coarse),
        ...(entry.sourceRevision === undefined ? {} : { sourceRevision: entry.sourceRevision }),
        ...(currentSourceRevision === undefined ? {} : { currentSourceRevision }),
        selected: plan.actions.filter(node => node.declaration.kind === entry.coarse.kind).map(node => ({ kind: node.declaration.kind,
          parameters: Object.fromEntries(Object.entries(node.declaration.executor.parameters).filter(([key]) =>
            ['cohort', 'transport', 'unitKind', 'buildingKind', 'campId', 'garrisonMineId'].includes(key))),
          ...(node.declaration.refinementFor ? { effectId: node.declaration.refinementFor.effect.id } : {}) })) });
    };
    // Retire invalid evidence, then apply the same pin/LRU policy as physical
    // publication caches. Earlier selected quotes in this think stay pinned
    // across same-snapshot re-regression; insertion order cannot starve them.
    const invalidated = new Set<string>();
    const sequence = input.thinkSequence?.() ?? plan.observedTick;
    const matchingNode = (entry: Entry) => plan.actions.find(node => entry.exact.some(exact => exact.id === node.declaration.id)
      || proposalKey(entry.coarse) === proposalKey(node.declaration));
    const bound = () => {
      const owned = memory.entries.filter(entry => entry.planId === undefined || entry.planId === plan.id);
      // A rejected/compared alternative remains a reference in the current
      // search graph. Evicting its price makes its optimistic coarse proposal
      // win another comparison and republishes the same proof forever.
      const alternativeIds = new Set(plan.alternatives.map(alternative => alternative.actionId));
      const referenced = owned.filter(entry => !!matchingNode(entry)
        || alternativeIds.has(entry.coarse.id) || entry.exact.some(exact => alternativeIds.has(exact.id))
        || entry.preferredExactIndex !== undefined && entry.preferredExactIndex >= 0
          && plan.actions.some(node => choiceFamily(node.declaration) === choiceFamily(entry.coarse)));
      for (const entry of referenced) { entry.planId = plan.id; touchCache(entry, sequence, [plan.goal.id]); }
      const result = boundCache({ kind: 'refinement', entries: owned, id: entry => entry.coarse.id,
        lastUsed: entry => entry.lastUsedThink ?? -1, plans: entry => entry.lastUsedThink === sequence ? entry.planIds ?? [] : [],
        maxEntries: referenced.length + (input.maxAlternativeQuotes ?? 0), thinkSequence: sequence,
        capacity: memory.capacities?.[plan.id] });
      const removed = new Set(result.evicted);
      memory.entries = memory.entries.filter(entry => !removed.has(entry));
      for (const entry of result.evicted) if (entry.state !== 'pending') revise(entry, 'unselected-quote-evicted');
      (memory.capacities ??= {})[plan.id] = result.capacity;
      return result.capacity.pressure;
    };
    if (plan.actions.length) memory.entries = memory.entries.filter(entry => {
      if (entry.planId !== undefined && entry.planId !== plan.id) return true;
      const node = matchingNode(entry);
      // The saved dependency contract belongs to the coarse proposal. An
      // exact declaration can additionally name the observed foundation or
      // resolved actors; that representation change is not a world change.
      const valid = entry.sourceRevision === input.sourceRevision?.(entry.coarse);
      const relevant = !!node || entry.state === 'known' && entry.exact.length > 0
        && plan.actions.some(node => entry.coarse.refinementFor && node.declaration.refinementFor
          && entry.coarse.refinementFor.providerId === node.declaration.refinementFor.providerId
          && sameChoice(entry.coarse, node.declaration));
      // A newly selected exact quote may make a different coarse alternative
      // look cheaper. Keep both published answers under the shared pin/LRU
      // bound; discarding the loser here makes regression alternate forever.
      if (valid && (relevant || entry.state === 'invalid' || entry.state === 'known' && entry.exact.length > 0)) return true;
      if (entry.state !== 'pending') {
        revise(entry, valid ? 'quote-no-longer-selected' : 'quote-source-changed', [], input.sourceRevision?.(entry.coarse));
        if (node) invalidated.add(node.id);
      }
      return false;
    });
    const pressure = plan.actions.length ? bound() : undefined;
    if (pressure) return { ...plan, status: 'search-pending', readyActionIds: [], capacityPressure: [pressure],
      reasons: [{ code: 'goal-refinement-pinned-capacity', factIds: pressure.requestIds, values: { entries: pressure.entries ?? 0 } }] };
    const first = new Set(plan.actions.filter(node => !node.dependsOnActionIds.length).map(node => node.id));
    let selected = plan.actions.filter(node => first.has(node.id)
      || node.dependsOnActionIds.length && node.dependsOnActionIds.every(id => first.has(id)));
    if (!selected.length) return plan;
    const context = input.exactContext(selected.map(node => node.declaration), plan);
    const prepared = input.prepareExact?.(plan, selected, context);
    if (prepared) {
      if (prepared.changed) return prepared.plan;
      plan = prepared.plan;
      selected = selected.filter(node => !prepared.deferActionIds.includes(node.id));
    }
    const deferred = [...(plan.deferredCandidates ?? [])];
    const annotations = new Map<string, NonNullable<GoalPlan['actions'][number]['refinement']>>();
    let changed = invalidated.size > 0;
    for (const node of selected) {
      const action = node.declaration;
      if (action.precision !== 'coarse') continue;
      const request = action.refinementFor;
      const provider = request && input.providers.find(provider => provider.id === request.providerId);
      if (!provider || !request) continue;
      const sourceRevision = input.sourceRevision?.(action);
      let entry = memory.entries.find(entry => entry.planId === plan.id && proposalKey(entry.coarse) === proposalKey(action) && entry.sourceRevision === sourceRevision);
      if (!entry) {
        entry = { planId: plan.id, coarse: action, ...(sourceRevision === undefined ? {} : { sourceRevision }), state: 'pending', exact: [], reason: { code: 'selected-exact-facts-pending', factIds: [], values: {} } };
        memory.entries.push(entry);
      }
      touchCache(entry, sequence, [plan.goal.id]);
      if (entry.state !== 'pending') continue;
      const discovered = discoverGoalActions(provider, request.effect, context);
      const compatible = discovered.actions.filter(exact => sameChoice(action, exact));
      const feasible = compatible.filter(exact => ![exact.duration, exact.cost, exact.successProbability].some(estimate => estimate.state === 'unmet'));
      const known = feasible.filter(exact => {
        const quote = value(exact); return quote.duration !== null && quote.cost !== null && quote.probability !== null;
      });
      const pendingEstimates = feasible.flatMap(exact => [exact.duration, exact.cost, exact.successProbability].filter(estimate => estimate.state === 'pending'));
      const identical = known.find(exact => sameExecutionProof(action, exact));
      const coarseTime = value(action).duration, exactTime = known[0] ? value(known[0]).duration : null;
      const durationRatio = coarseTime !== null && coarseTime > 0 && exactTime !== null ? exactTime / coarseTime : null;
      const reason = { code: identical ? 'selected-exact-action-confirmed' : known.length ? 'selected-exact-action-requires-regression' : discovered.deferred.length || feasible.length
        ? 'selected-exact-facts-pending' : 'selected-coarse-action-invalid', factIds: [...new Set([...discovered.deferred.flatMap(item => item.requestIds),
          ...pendingEstimates.flatMap(estimate => estimate.state === 'pending' ? estimate.requestIds : [])])],
        values: { pendingReasons: pendingEstimates.flatMap(estimate => estimate.state === 'pending' ? [estimate.reason.code] : []).join(','),
          durationRatio, durationChangedOverHalf: coarseTime !== null && exactTime !== null
            && Math.abs(exactTime - coarseTime) > coarseTime * .5 } };
      if (known.length) {
        entry.exact = known.map(exact => ({ ...exact, precision: 'exact', refinementFor: request }));
        entry.state = 'known'; entry.reason = reason; revise(entry, 'exact-quote-published', known.flatMap(action =>
          [action.duration, action.cost, action.successProbability].flatMap(estimate => estimate.state === 'met' ? estimate.factIds : []))); changed ||= !identical;
      } else if (!discovered.deferred.length && !feasible.length) {
        entry.state = 'invalid'; entry.reason = reason; revise(entry, 'exact-proposal-disproved', reason.factIds); changed = true;
      } else entry.reason = reason;
      annotations.set(node.id, { state: entry.state, coarse: action, ...(entry.exact[0] ? { exact: entry.exact[0] } : {}), reason });
      deferred.push(...discovered.deferred.map(item => ({ ...item, factId: request.effect.id })));
    }
    const actions = plan.actions.map(node => {
      if (invalidated.has(node.id)) return { ...node, state: 'waiting-facts' as const, refinement: {
        state: 'pending' as const, coarse: node.refinement?.coarse ?? node.declaration,
        reason: { code: 'selected-exact-source-changed', factIds: [], values: {} } } };
      const entry = memory.entries.find(entry => entry.sourceRevision === input.sourceRevision?.(entry.coarse) && entry.exact.some(exact => exact.id === node.declaration.id));
      const annotation = annotations.get(node.id);
      if (annotation) {
        const exact = annotation.exact;
        if (exact && sameExecutionProof(node.declaration, exact)) {
          const proof = exact.preconditions.map(context.readFact);
          const ready = node.state === 'ready' && proof.every(fact => fact.state === 'met' && (fact.availableTick ?? context.tick) <= context.tick);
          return { ...node, declaration: exact, refinement: annotation, state: ready ? 'ready' as const : node.state === 'ready'
            ? proof.some(fact => fact.state === 'pending') ? 'waiting-facts' as const : 'waiting-actions' as const : node.state };
        }
        return { ...node, refinement: annotation, state: 'waiting-facts' as const };
      }
      if (!entry) return node;
      if (node.state === 'ready') {
        for (const other of memory.entries) if (other.planId === entry.planId && choiceFamily(other.coarse) === choiceFamily(entry.coarse))
          delete other.preferredExactIndex;
        entry.preferredExactIndex = entry.exact.findIndex(exact => exact.id === node.declaration.id);
      }
      const coarse = value(entry.coarse), exact = value(node.declaration);
      const proof = selected.some(candidate => candidate.id === node.id) ? node.declaration.preconditions.map(context.readFact) : [];
      const ready = node.state === 'ready' && proof.every(fact => fact.state === 'met' && (fact.availableTick ?? context.tick) <= context.tick);
      return { ...node, ...(node.state === 'ready' && !ready ? { state: proof.some(fact => fact.state === 'pending')
        ? 'waiting-facts' as const : 'waiting-actions' as const } : {}), refinement: { state: 'known' as const, coarse: entry.coarse,
        exact: node.declaration, reason: entry.reason,
        ...(coarse.duration !== null && coarse.cost !== null && coarse.probability !== null && exact.duration !== null && exact.cost !== null && exact.probability !== null
          ? { delta: { durationTicks: exact.duration - coarse.duration, costGold: exact.cost - coarse.cost,
            successProbability: exact.probability - coarse.probability } } : {}) } };
    });
    const finalPressure = bound();
    if (finalPressure) return { ...plan, actions, status: 'search-pending', readyActionIds: [], capacityPressure: [finalPressure],
      reasons: [{ code: 'goal-refinement-pinned-capacity', factIds: finalPressure.requestIds, values: { entries: finalPressure.entries ?? 0 } }] };
    const ready = actions.filter(node => plan.readyActionIds.includes(node.id) && node.declaration.precision !== 'coarse' && node.state === 'ready');
    return { ...plan, actions, readyActionIds: changed ? [] : ready.map(node => node.id),
      status: plan.status === 'complete' ? 'complete' : changed || !ready.length ? 'waiting-facts' : plan.status,
      ...(deferred.length ? { deferredCandidates: deferred } : {}),
      reasons: changed ? [...plan.reasons, { code: 'selected-exact-actions-reenter-search', factIds: [], values: {} }] : plan.reasons };
  };
}

export function applyGoalRefinements(provider: GoalActionProvider, memory: GoalRefinementMemory,
  sourceRevision?: (action: GoalActionDeclaration) => string, currentPlans?: () => readonly string[]): GoalActionProvider {
  return { id: provider.id, actionsFor(effect, context) {
    const coarse = provider.actionsFor(effect, context);
    return coarse.flatMap(action => {
      const entry = memory.entries.find(entry => (entry.coarse.id === action.id || proposalKey(entry.coarse) === proposalKey(action))
        && entry.sourceRevision === sourceRevision?.(action));
      // The provider has just regenerated this coarse proposal. A cached
      // recipe can have expired prerequisites without changing the physical
      // proposal or its independently retained exact proof. Compare using the
      // current proposal, not an expired recipe's non-executable placeholder.
      if (entry && context.declarationContext && context.declarationSourceRevision) entry.coarse = { ...action,
        refinementFor: { providerId: provider.id, effect }, regeneration: { providerId: provider.id, effect,
          groundingKey: action.id, context: context.declarationContext,
          sourceRevision: context.declarationSourceRevision(action), dependencies: action.preconditions.map(fact => {
            const current = context.readFact(fact); return { fact, revision: current.revision, state: current.state };
          }) } };
      const owns = (candidate: { planId?: string }) => candidate.planId === undefined || !currentPlans || currentPlans().includes(candidate.planId);
      const incumbent = memory.entries.find(candidate => candidate.preferredExactIndex !== undefined
        && candidate.preferredExactIndex >= 0 && owns(candidate) && choiceFamily(candidate.coarse) === choiceFamily(action));
      const denied = memory.denials?.find(row => owns(row) && (row.declaration.id === action.id || proposalKey(row.declaration) === proposalKey(action))
        && row.sourceRevision === sourceRevision?.(action) && row.dependencies.every(dependency => {
          const fact = context.readFact(dependency.fact);
          return fact.revision === dependency.revision && fact.state === dependency.state;
        }));
      if (!entry && denied) {
        const confirmed = memory.entries.filter(candidate => owns(candidate) && candidate.state === 'known'
          && candidate.sourceRevision === sourceRevision?.(candidate.coarse) && choiceFamily(candidate.coarse) === choiceFamily(action))
          .flatMap(candidate => candidate.exact.map((exact, index) => candidate.preferredExactIndex === index
            ? { ...exact, reasons: [...exact.reasons, { code: 'goal-exact-incumbent-choice', factIds: [], values: {} }] } : exact));
        const priced = goalDeniedComparison(denied);
        // Compare both exact values before discarding the regenerated loser.
        // If the confirmed side disappears, rebuild the proof before granting.
        if (confirmed.some(exact => compareConfirmedGoalChoices(priced, exact, denied.rewardGold) >= 0)) return [];
        if (denied.proofRecipe?.precision === 'exact') return [denied.proofRecipe];
        return [{ ...priced, precision: 'coarse', reasons: [...action.reasons,
          { code: 'goal-denied-challenger-proof-required', factIds: denied.dependencies.map(row => row.fact.id), values: {} }] }];
      }
      if (!entry || entry.state === 'pending') return [{ ...action, ...(incumbent ? { reasons: [...action.reasons,
        { code: 'goal-exact-challenger-awaits-quote', factIds: action.refinementFor ? [action.refinementFor.effect.id] : [], values: {} }] } : {}) }];
      if (entry.state === 'invalid') return [];
      return entry.exact.map((exact, index) => {
        const current = refreshClock(exact, entry.coarse, action);
        return owns(entry) && entry.preferredExactIndex === index ? { ...current, reasons: [...current.reasons,
          { code: 'goal-exact-incumbent-choice', factIds: [], values: {} }] } : current;
      });
    });
  } };
}
