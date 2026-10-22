import { compareConfirmedGoalChoices } from './goal-quote-comparison';
import type { GoalActionDeclaration, GoalAlternative, GoalFactReader, GoalPlan, GoalPlanCacheEntry } from './goal-planner-types';
import type { GoalRefinementDenial, GoalRefinementMemory } from './goal-plan-refinement';
import { boundCache, touchCache } from './bounded-cache';
import { goalPlanningOrderKey, goalPlanningResidentBytes } from './goal-planning-references';

const cost = (action: GoalActionDeclaration) => action.cost.state === 'met'
  ? action.cost.value.reduce((sum, term) => sum + term.gold, 0) : Infinity;
const order = (a: GoalAlternative, b: GoalAlternative, reward: number) => {
  const first = a.declaration, second = b.declaration;
  if (!first || !second) return (a.costGold ?? Infinity) - (b.costGold ?? Infinity) || a.id.localeCompare(b.id);
  return Number(second.precision === 'exact') - Number(first.precision === 'exact')
    || compareConfirmedGoalChoices(first, second, reward) || cost(first) - cost(second)
    || goalPlanningOrderKey(a.actionId).localeCompare(goalPlanningOrderKey(b.actionId));
};

/** One incumbent and one priced opponent at each comparison point. The coarse
 * provider remains the deterministic generator of all other achievers. */
export function retainGoalComparisons(plan: GoalPlan, resident = false): GoalPlan {
  const selected = new Set(plan.actions.map(action => action.id));
  const opponents = new Map<string, GoalAlternative>();
  for (const alternative of plan.alternatives) if (!selected.has(alternative.actionId)) {
    // Unpriced candidates are deterministic provider output. They are useful
    // during this pass, but only a confirmed challenger price belongs in the
    // resident comparison protocol; the frontier retains its choice cursor.
    const quote = alternative.declaration;
    if (resident && (!quote || quote.precision !== 'exact' || quote.duration.state !== 'met'
      || quote.cost.state !== 'met' || quote.successProbability.state !== 'met')) continue;
    const prior = opponents.get(alternative.factId);
    if (!prior || order(alternative, prior, plan.goal.rewardGold) < 0) opponents.set(alternative.factId, alternative);
  }
  // Comparison points belong to the chosen dependency graph, rather than
  // every rejected branch's recursive subgraph.
  const facts = new Set([...plan.goal.effects.map(fact => fact.id), ...plan.actions.flatMap(action => [
    ...action.prerequisiteFactIds, ...action.declaration.effects.map(effect => effect.fact.id)])]);
  const alternatives = plan.alternatives.filter(alternative => facts.has(alternative.factId)
    && (selected.has(alternative.actionId) || opponents.get(alternative.factId) === alternative));
  for (;;) {
    const before = facts.size;
    for (const fact of plan.facts) if (facts.has(fact.id))
      for (const required of fact.observation.derived?.allOf ?? []) facts.add(required.id);
    if (facts.size === before) break;
  }
  const alternativeIds = new Set(alternatives.map(alternative => alternative.id));
  return { ...plan, ...(resident ? { actions: plan.actions.map(({ refinement: _comparisonTrace, ...action }) => action) } : {}),
    alternatives, facts: plan.facts.filter(fact => facts.has(fact.id)),
    ...(plan.deferredCandidates ? { deferredCandidates: plan.deferredCandidates.filter(candidate => facts.has(candidate.factId)) } : {}),
    edges: plan.edges.filter(edge => (facts.has(edge.from) || selected.has(edge.from)) && (facts.has(edge.to) || selected.has(edge.to))),
    subgoals: plan.subgoals.filter(subgoal => facts.has(subgoal.factId)).map(subgoal => ({ ...subgoal,
      alternativeIds: subgoal.alternativeIds.filter(id => alternativeIds.has(id)) })) };
}

/** Retention changes reachability, not quotation revisions. Selected exact
 * quotes and each live opponent keep their source evidence across thinks. */
export function retainGoalRefinementChoices(memory: GoalRefinementMemory, plans: readonly GoalPlan[], readFact?: GoalFactReader, sequence = 0): void {
  const ids = new Map(plans.map(plan => [plan.id, new Set(plan.actions.flatMap(node => [node.id,
    ...(node.refinement ? [node.refinement.coarse.id, ...(node.refinement.exact ? [node.refinement.exact.id] : [])] : [])])
    .concat(plan.alternatives.map(alternative => alternative.actionId)))]));
  const facts = new Map(plans.map(plan => [plan.id, new Set(plan.facts.map(fact => fact.id))]));
  const retained = memory.entries.filter(entry => {
    const choices = entry.planId ? ids.get(entry.planId) : new Set([...ids.values()].flatMap(set => [...set]));
    if (!choices) return false;
    return choices.has(entry.coarse.id) || entry.exact.some(exact => choices.has(exact.id))
      || entry.state === 'invalid' && !!entry.coarse.refinementFor
        && (entry.planId ? facts.get(entry.planId)?.has(entry.coarse.refinementFor.effect.id)
          : [...facts.values()].some(set => set.has(entry.coarse.refinementFor!.effect.id)));
  });
  if (readFact) for (const entry of memory.entries) if (!retained.includes(entry) && entry.state === 'known' && entry.planId) {
    const plan = plans.find(plan => plan.id === entry.planId);
    if (!plan) continue;
    const exact = [...entry.exact].sort((a, b) => compareConfirmedGoalChoices(a, b, plan.goal.rewardGold))[0];
    if (!exact || exact.duration.state !== 'met' || exact.cost.state !== 'met' || exact.successProbability.state !== 'met') continue;
    const denial: GoalRefinementDenial = { planId: entry.planId, declaration: entry.coarse,
      ...(exact.regeneration ? { proofRecipe: exact } : {}),
      ...(entry.sourceRevision === undefined ? {} : { sourceRevision: entry.sourceRevision }),
      dependencies: entry.coarse.preconditions.map(fact => { const proof = readFact(fact);
        return { fact, revision: proof.revision, state: proof.state }; }), rewardGold: plan.goal.rewardGold,
      value: { durationTicks: exact.duration.value, costs: exact.cost.value.map(({ factIds: _ids, ...cost }) => ({ ...cost, factIds: [] })),
        probability: exact.successProbability.value } };
    const rows = memory.denials ??= [];
    const prior = rows.findIndex(row => row.planId === denial.planId && row.declaration.id === denial.declaration.id);
    if (prior >= 0) rows.splice(prior, 1);
    touchCache(denial, sequence, [plan.goal.id]); rows.push(denial);
  }
  memory.entries = retained;
  if (memory.denials) {
    const live = memory.denials.filter(row => plans.some(plan => plan.id === row.planId));
    const result = boundCache({ kind: 'refinement-denial', entries: live, id: row => row.declaration.id,
      plans: row => plans.filter(plan => plan.id === row.planId).map(plan => plan.goal.id),
      lastUsed: row => row.lastUsedThink ?? 0, maxBytes: 256 * 1024, bytes: goalPlanningResidentBytes,
      thinkSequence: sequence, capacity: memory.denialCapacity });
    memory.denials = result.entries; memory.denialCapacity = result.capacity;
  }
}

/** The saved frontier is a choice cursor with its actual scheduled prefix.
 * Candidate lists are regenerated by the same providers, inside charged
 * search transitions. Nothing here truncates facts, prices or parameters. */
export function retainGoalSearchEntry(entry: GoalPlanCacheEntry): GoalPlanCacheEntry {
  const plan = retainGoalComparisons(entry.plan, true), state = entry.continuation;
  if (!state || !state.demandDriven) return { ...entry, plan };
  const ids = new Set(plan.actions.map(action => action.id));
  plan.alternatives.forEach(alternative => ids.add(alternative.actionId));
  const factIds = new Set(plan.facts.map(fact => fact.id));
  const path = (path: import('./goal-search-state').GoalSearchPath) => path.steps.forEach(step => {
    ids.add(step.action.id); step.action.preconditions.forEach(fact => factIds.add(fact.id));
  });
  state.frontier.forEach(path); state.solutions.forEach(path); if (state.active) path(state.active.path);
  if (state.coarse) {
    path(state.coarse.path);
    for (const frame of state.coarse.stack) {
      factIds.add(frame.fact.id); frame.required?.forEach(fact => factIds.add(fact.id)); path(frame.checkpoint);
      if (frame.selected && frame.selected !== '@derived') ids.add(frame.selected);
    }
  }
  const observed = state.observed.filter(observation => factIds.has(observation.fact.id));
  return { ...entry, plan, dependencies: entry.dependencies.filter(dependency => factIds.has(dependency.factId)),
    continuation: { ...state, requests: [], regressed: [], visited: [], observed,
      ...(state.deferred ? { deferred: state.deferred.filter(candidate => factIds.has(candidate.factId)) } : {}),
      candidates: state.candidates.filter(action => ids.has(action.id)), alternatives: plan.alternatives as GoalAlternative[],
      ...(state.coarse ? { coarse: { ...state.coarse, stack: state.coarse.stack.map(frame => {
        const { options: _options, ...cursor } = frame; return cursor;
      }) } } : {}) } };
}
