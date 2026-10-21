import type { AllocationReason } from './allocation-types';
import { bindGoalAction, bindGoalFact, goalActionContributes, goalBindingsKey, goalQuantity, matchGoalFacts, type GoalBindings } from './goal-fact-matching';
import { goalResourceKey, goalValueKey } from './goal-facts';
import { projectGoalResources, type GoalScheduledAction } from './goal-resource-ledger';
import { observationJsonBytes } from './observation-json-bytes';
import type { GoalSearchMemory, GoalSearchPath as Path, GoalSearchStep as Step } from './goal-search-state';
export type { GoalSearchMemory } from './goal-search-state';
import type { GoalActionDeclaration, GoalActionNode, GoalAlternative, GoalFact, GoalFactObservation, GoalPlan,
  GoalPlannerInput, GoalPlannerOutput, GoalRequest, GoalResourceBalance } from './goal-planner-types';

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const reason = (code: string, factIds: readonly string[] = [], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });
const finish = (path: Path, epoch: number) => Math.max(epoch, ...path.steps.map(step => step.finishTick));
const pathKey = (path: Path) => goalValueKey([path.steps.map(step => [step.action.id, step.startTick, step.finishTick]), path.bindings]);
const pathOrder = (epoch: number) => (a: Path, b: Path) => a.cost - b.cost || finish(a, epoch) - finish(b, epoch) || order(pathKey(a), pathKey(b));
const validEstimate = (action: GoalActionDeclaration) => action.duration.state === 'met'
  && Number.isFinite(action.duration.value) && action.duration.value >= 0 && action.cost.state === 'met'
  && action.cost.value.every(term => Number.isFinite(term.gold) && term.gold >= 0)
  && action.successProbability.state === 'met' && Number.isFinite(action.successProbability.value)
  && action.successProbability.value >= 0 && action.successProbability.value <= 1;

/** No domain action ordering appears here. Providers are queried only for
 * achievers of a requested fact, including partial numeric contributors. */
export function planGoals(input: GoalPlannerInput): GoalPlannerOutput {
  const { context, work } = input, plans: GoalPlan[] = [], entries: GoalPlannerOutput['cache']['entries'][number][] = [];
  const providers = [...input.providers].sort((a, b) => order(a.id, b.id));
  const runs: { goal: GoalRequest; goalKey: string; state: GoalSearchMemory; beforeWork: number }[] = [];
  for (const goal of [...input.goals].sort((a, b) => order(a.id, b.id))) {
    const goalKey = goalValueKey([goal, input.initialBalances.map(({ asOfTick: _epoch, ...balance }) => balance)]);
    const previous = input.previous?.owner === context.owner ? input.previous.entries.find(entry => entry.goalKey === goalKey
      && entry.declarationRevision === input.declarationRevision) : undefined;
    const unchanged = previous && previous.dependencies.every(dependency => {
      const prior = previous.plan.facts.find(node => node.id === dependency.factId)?.observation
        ?? previous.continuation?.observed.find(observed => observed.fact.id === dependency.factId);
      if (!prior) return false;
      const current = context.readFact(prior.fact);
      return current.revision === dependency.revision && current.state === dependency.state;
    });
    if (unchanged && previous.continuation?.phase === 'done' && previous.plan.status !== 'search-pending') {
      const delta = context.tick - previous.plan.observedTick;
      const deadline = goal.deadlineTick;
      const shifted = previous.plan.actions.map(action => ({ ...action,
        startTick: action.startTick === null ? null : action.startTick + delta,
        finishTick: action.finishTick === null ? null : action.finishTick + delta }));
      if (deadline === null || shifted.every(action => action.finishTick === null || action.finishTick <= deadline)) {
        const plan: GoalPlan = { ...previous.plan, observedTick: context.tick, actions: shifted,
          completedTick: previous.plan.completedTick === null ? null : previous.plan.completedTick + delta,
          resourceTimeline: previous.plan.resourceTimeline.map(event => ({ ...event, tick: event.tick + delta })),
          search: { ...previous.plan.search, work: 0 }, facts: previous.plan.facts.map(node => ({ ...node, observation: context.readFact(node.observation.fact) })) };
        plans.push(plan); entries.push({ ...previous, plan }); continue;
      }
    }
    let state: GoalSearchMemory;
    if (unchanged && previous.continuation && previous.plan.observedTick === context.tick)
      state = structuredClone(previous.continuation);
    else if (unchanged && previous.continuation && previous.continuation.phase !== 'done')
      state = structuredClone(previous.continuation);
    else if (unchanged && previous.continuation) {
      // Re-use the regressed alternatives, not stale absolute schedules. Time
      // can release a published fact without a second provider expansion.
      state = { ...structuredClone(previous.continuation), phase: 'compose', frontier: [emptyPath()], active: null,
        solutions: [], visited: [], expansions: 0, limitReason: null };
    } else state = { version: 1, phase: 'regress', requests: goal.effects.map(fact => ({ fact, depth: 0 })),
      regressed: [], observed: [], candidates: [], alternatives: [], frontier: [], active: null, solutions: [], visited: [],
      expansions: 0, depth: 0, limitReason: null };
    if (unchanged && previous.continuation?.phase !== 'done') {
      const delta = context.tick - previous.plan.observedTick;
      for (const path of [...state.frontier, ...state.solutions, ...(state.active ? [state.active.path] : [])])
        for (const step of path.steps) { step.startTick += delta; step.finishTick += delta; }
    }
    const beforeWork = state.expansions;
    work.register({ key: `goal-search:${goal.id}`, tier: 'critical-route', minimum: 1, run: allowance => {
      let used = 0;
      while (used < Math.min(allowance, 64) && state.phase !== 'done') {
        if (state.expansions >= input.limits.maxExpansions) { state.limitReason = 'expansion-limit'; state.phase = 'done'; break; }
        if (state.phase === 'regress') regressOne(state, input, providers);
        else composeOne(state, input, goal);
        state.expansions++; used++;
      }
      return { work: used, done: state.phase === 'done' };
    } });
    runs.push({ goal, goalKey, state, beforeWork });
  }
  // Register every goal before flushing, so an earlier goal cannot spend the
  // entire think before equally important goals enter the shared round robin.
  work.flush();
  for (const { goal, goalKey, state, beforeWork } of runs) {
    const plan = projectPlan(state, input, goal, state.expansions - beforeWork);
    plans.push(plan);
    entries.push({ goalKey, declarationRevision: input.declarationRevision,
      dependencies: state.observed.map(observed => ({ factId: observed.fact.id, revision: observed.revision, state: observed.state })),
      plan, continuation: state });
  }
  plans.sort((a, b) => order(a.goal.id, b.goal.id));
  const retained = [...entries].sort((a, b) => order(a.plan.goal.id, b.plan.goal.id));
  while (observationJsonBytes(retained) > 256 * 1024) retained.pop();
  return { plans, cache: { version: 1, owner: context.owner, entries: retained,
    ...(retained.length < entries.length ? { truncated: true as const } : {}) }, readyActions: plans.flatMap(plan => plan.actions
    .filter(action => plan.readyActionIds.includes(action.id)).map(action => ({ goalId: plan.goal.id, planId: plan.id, action }))) };
}
const emptyPath = (): Path => ({ steps: [], bindings: {}, cost: 0, probability: 1 });

function observe(state: GoalSearchMemory, input: GoalPlannerInput, fact: GoalFact) {
  const prior = state.observed.find(item => item.fact.id === fact.id);
  if (prior) return prior;
  const result = input.context.readFact(fact); state.observed.push(result); return result;
}
function regressOne(state: GoalSearchMemory, input: GoalPlannerInput, providers: GoalPlannerInput['providers']) {
  state.requests.sort((a, b) => a.depth - b.depth || order(a.fact.id, b.fact.id));
  const request = state.requests.shift();
  if (!request) { state.phase = 'compose'; state.frontier = [emptyPath()]; return; }
  if (state.regressed.includes(request.fact.id)) return;
  state.regressed.push(request.fact.id);
  const observation = observe(state, input, request.fact);
  state.depth = Math.max(state.depth, request.depth);
  if (observation.state === 'pending') return;
  // A currently met numeric balance can be consumed by another action. Its
  // positive-flow alternatives must remain available to repair that prefix.
  if (observation.state === 'met' && !goalQuantity(request.fact)) return;
  if (request.depth >= input.limits.maxDepth) { state.limitReason ??= 'depth-limit'; return; }
  const all = providers.flatMap(provider => provider.actionsFor(request.fact, input.context)).filter(action => goalActionContributes(action, request.fact))
    .sort((a, b) => order(a.id, b.id));
  for (const action of all) {
    if (!state.alternatives.some(item => item.factId === request.fact.id && item.actionId === action.id)) {
      const cost = action.cost.state === 'met' ? action.cost.value.reduce((sum, term) => sum + term.gold, 0) : null;
      state.alternatives.push({ id: `alternative:${goalValueKey([request.fact.id, action.id])}`, factId: request.fact.id,
        actionId: action.id, declaration: action, status: 'pending', costGold: cost, finishTick: null,
        reason: reason('goal-achiever-discovered', [request.fact.id]) });
    }
    if (state.candidates.some(candidate => candidate.id === action.id)) continue;
    if (state.candidates.length >= input.limits.maxExpansions) { state.limitReason ??= 'candidate-limit'; break; }
    state.candidates.push(action);
    state.requests.push(...action.preconditions.map(fact => ({ fact, depth: request.depth + 1 })));
  }
}

function balances(state: GoalSearchMemory, input: GoalPlannerInput): GoalResourceBalance[] {
  const result = [...input.initialBalances], known = new Set(result.map(balance => goalResourceKey(balance.resource)));
  for (const observation of state.observed) {
    const quantity = goalQuantity(observation.fact);
    if (!quantity || observation.quantity === undefined || known.has(goalResourceKey(quantity.resource))) continue;
    result.push({ resource: quantity.resource, quantity: observation.quantity, asOfTick: input.context.tick, factIds: [observation.fact.id] });
    known.add(goalResourceKey(quantity.resource));
  }
  return result;
}
type Satisfaction = { met: boolean; pending: boolean; bindings: GoalBindings; tick: number; producers: string[] };
function satisfies(factInput: GoalFact, path: Path, state: GoalSearchMemory, input: GoalPlannerInput): Satisfaction {
  const fact = bindGoalFact(factInput, path.bindings), now = input.context.tick;
  const bounded = (result: Satisfaction): Satisfaction => 'byTick' in fact.predicate && result.tick > fact.predicate.byTick
    ? { ...result, met: false } : result;
  let binding = path.bindings;
  const producers: string[] = []; let available = now;
  const current = observe(state, input, fact);
  const quantity = goalQuantity(fact);
  if (input.context.readProjectedFact && path.steps.length && ['force-at', 'force-available', 'worker-at', 'cargo-aboard',
    'unit-available', 'interception-capability'].includes(fact.predicate.kind)) {
    const projected = input.context.readProjectedFact(fact, { actions: path.steps, bindings: path.bindings });
    return bounded({ met: projected.state === 'met', pending: projected.state === 'pending', bindings: binding,
      tick: projected.availableTick ?? now, producers: path.steps.filter(step => step.action.effects
        .some(effect => effect.operation === 'establish' && matchGoalFacts(effect.fact, fact, binding, true))).map(step => step.action.id) });
  }
  if (quantity) {
    const projected = projectGoalResources({ epoch: now, initial: balances(state, input), actions: path.steps });
    if (projected.state !== 'pending') {
      const amount = projected.balances.find(balance => goalResourceKey(balance.resource) === goalResourceKey(quantity.resource))?.quantity ?? 0;
      if (amount + 1e-9 >= quantity.minimum && (!('cohort' in fact.predicate) || !fact.predicate.cohort?.length
        || current.state === 'met' && !path.steps.some(step => step.action.flows.some(flow => flow.delta < 0
          && goalResourceKey(flow.resource) === goalResourceKey(quantity.resource))))) {
        for (const step of path.steps) if (step.action.flows.some(flow => flow.delta > 0
          && goalResourceKey(flow.resource) === goalResourceKey(quantity.resource))) { producers.push(step.action.id); available = Math.max(available, step.finishTick); }
        return bounded({ met: true, pending: false, bindings: binding, tick: Math.max(available, current.availableTick ?? now), producers });
      }
    }
  }
  let established = current.state === 'met';
  for (const step of path.steps) for (const effect of step.action.effects) {
    const matched = matchGoalFacts(bindGoalFact(effect.fact, binding), fact, binding);
    if (!matched) continue;
    established = effect.operation === 'establish'; binding = matched;
    if (established) { producers.push(step.action.id); available = Math.max(available, effect.at === 'start' ? step.startTick
      : effect.at === 'finish' ? step.finishTick : step.startTick + effect.at.offsetTicks); }
  }
  // A numeric fact's original truth cannot survive spending its balance.
  if (quantity && !producers.length && path.steps.some(step => step.action.flows.some(flow => flow.delta < 0
    && goalResourceKey(flow.resource) === goalResourceKey(quantity.resource)))) established = false;
  return bounded({ met: established, pending: !established && current.state === 'pending', bindings: binding,
    tick: Math.max(available, current.availableTick ?? now), producers });
}

function composeOne(state: GoalSearchMemory, input: GoalPlannerInput, goal: GoalRequest) {
  if (!state.active) {
    state.frontier.sort(pathOrder(input.context.tick));
    const path = state.frontier.shift();
    if (!path) { state.phase = 'done'; return; }
    const goalMet = goal.effects.every(fact => satisfies(fact, path, state, input).met);
    if (goalMet) {
      state.solutions.push(path); state.solutions.sort(pathOrder(input.context.tick));
      state.solutions.splice(input.limits.maxPlans); return;
    }
    state.active = { path, next: 0 };
  }
  const active = state.active, action = state.candidates[active.next++];
  if (!action) { state.active = null; return; }
  if (active.path.steps.some(step => step.action.id === action.id) || !validEstimate(action)) return;
  let bindings = active.path.bindings, startTick = input.context.tick;
  const dependencies = new Set<string>();
  for (const fact of action.preconditions) {
    const result = satisfies(fact, { ...active.path, bindings }, state, input);
    if (!result.met) return;
    bindings = result.bindings; startTick = Math.max(startTick, result.tick);
    result.producers.forEach(id => dependencies.add(id));
  }
  const bound = bindGoalAction(action, bindings);
  if (bound.duration.state !== 'met' || bound.cost.state !== 'met' || bound.successProbability.state !== 'met') return;
  // Exclusive demands are interval constraints, distinct from consumable flows.
  for (const prior of active.path.steps) if (bound.demands.some(demand => prior.action.demands.some(other =>
    goalValueKey(demand.resource) === goalValueKey(other.resource)))) {
    startTick = Math.max(startTick, prior.finishTick); dependencies.add(prior.action.id);
  }
  const finishTick = startTick + bound.duration.value;
  if (!Number.isFinite(finishTick) || goal.deadlineTick !== null && finishTick > goal.deadlineTick) return;
  const step: Step = { action: bound, startTick, finishTick, dependsOn: [...dependencies].sort() };
  let projection = projectGoalResources({ epoch: input.context.tick, initial: balances(state, input), actions: [...active.path.steps, step] });
  if (projection.state === 'unmet' && startTick < finish(active.path, input.context.tick)) {
    step.startTick = finish(active.path, input.context.tick); step.finishTick = step.startTick + bound.duration.value;
    step.dependsOn = active.path.steps.map(prior => prior.action.id).sort();
    projection = projectGoalResources({ epoch: input.context.tick, initial: balances(state, input), actions: [...active.path.steps, step] });
  }
  if (projection.state !== 'met' || goal.deadlineTick !== null && step.finishTick > goal.deadlineTick) return;
  const path: Path = { steps: [...active.path.steps, step], bindings,
    cost: active.path.cost + bound.cost.value.reduce((sum, term) => sum + term.gold, 0),
    probability: active.path.probability * bound.successProbability.value };
  // Equal selected sets can have different invalidations, availability and
  // prefix timing. Do not erase an ordering solely because its IDs match.
  const key = pathKey(path);
  if (state.visited.includes(key)) return;
  state.visited.push(key); state.frontier.push(path);
  if (state.frontier.length > input.limits.maxExpansions) { state.frontier.sort(pathOrder(input.context.tick));
    state.frontier.splice(input.limits.maxExpansions); state.limitReason ??= 'frontier-limit'; }
}

function projectPlan(state: GoalSearchMemory, input: GoalPlannerInput, goal: GoalRequest, work: number): GoalPlan {
  const valueOrder = (a: Path, b: Path) => (b.probability * goal.rewardGold - b.cost) - (a.probability * goal.rewardGold - a.cost)
    || pathOrder(input.context.tick)(a, b);
  const path = [...state.solutions].sort(valueOrder)[0];
  const steps = path?.steps ?? [], chosen = new Set(steps.map(step => step.action.id));
  const unresolved = state.observed.some(observation => observation.state === 'pending')
    || state.candidates.some(action => [action.duration, action.cost, action.successProbability].some(estimate => estimate.state === 'pending'));
  const actions: GoalActionNode[] = steps.map(step => ({ id: step.action.id, declaration: step.action,
    prerequisiteFactIds: step.action.preconditions.map(fact => fact.id), dependsOnActionIds: step.dependsOn,
    startTick: step.startTick, finishTick: step.finishTick,
    state: step.dependsOn.length ? 'waiting-actions' : step.startTick > input.context.tick ? 'waiting-time' : 'ready', reasons: [] }));
  const projection = projectGoalResources({ epoch: input.context.tick, initial: balances(state, input), actions: steps });
  const currentMet = goal.effects.every(fact => observe(state, input, fact).state === 'met');
  const alternatives = state.alternatives.map(alternative => ({ ...alternative,
    status: chosen.has(alternative.actionId) ? 'chosen' as const : path && state.phase === 'done' ? 'rejected' as const : 'pending' as const,
    finishTick: steps.find(step => step.action.id === alternative.actionId)?.finishTick ?? null,
    reason: reason(chosen.has(alternative.actionId) ? 'goal-achiever-chosen' : path && state.phase === 'done'
      ? alternative.costGold !== null && alternative.costGold > path.cost ? 'goal-alternative-cost-above-plan' : 'goal-alternative-not-in-selected-plan'
      : 'goal-alternative-search-unresolved', [alternative.factId], { selectedCostGold: path?.cost ?? null }) }));
  return { id: `goal-plan:${goal.id}`, goal, observedTick: input.context.tick,
    status: currentMet ? 'complete' : path ? 'ready' : state.phase !== 'done' || state.limitReason ? 'search-pending' : unresolved ? 'waiting-facts' : 'blocked',
    facts: state.observed.map(observation => ({ id: observation.fact.id, observation,
      producerActionIds: steps.filter(step => goalActionContributes(step.action, observation.fact)).map(step => step.action.id) })),
    actions, edges: actions.flatMap(action => [
      ...action.prerequisiteFactIds.map(from => ({ from, to: action.id, kind: 'requires' as const })),
      ...action.declaration.effects.filter(effect => effect.operation === 'establish').map(effect => ({ from: action.id, to: effect.fact.id, kind: 'establishes' as const })),
      ...action.dependsOnActionIds.map(from => ({ from, to: action.id, kind: 'resource-before' as const })),
    ]), subgoals: state.observed.map(observation => ({ id: `subgoal:${observation.fact.id}`, factId: observation.fact.id,
      parentGoalId: goal.id, requestedByActionIds: steps.filter(step => step.action.preconditions.some(fact => fact.id === observation.fact.id)).map(step => step.action.id),
      state: observation.state, chosenActionId: alternatives.find(alternative => alternative.factId === observation.fact.id && alternative.status === 'chosen')?.actionId ?? null,
      chosenActionIds: alternatives.filter(alternative => alternative.factId === observation.fact.id && alternative.status === 'chosen').map(alternative => alternative.actionId),
      alternativeIds: alternatives.filter(alternative => alternative.factId === observation.fact.id).map(alternative => alternative.id) })),
    alternatives, readyActionIds: actions.filter(action => action.state === 'ready').map(action => action.id),
    resourceTimeline: projection.state === 'pending' ? [] : projection.timeline,
    costGold: path?.cost ?? null, successProbability: path?.probability ?? null,
    valueGold: path ? path.probability * goal.rewardGold - path.cost : null, completedTick: path ? finish(path, input.context.tick) : null,
    search: { expansions: state.expansions, depth: state.depth, work, limitReason: state.limitReason },
    reasons: path ? [] : [reason(state.limitReason ?? (unresolved ? 'goal-required-facts-pending' : 'goal-no-feasible-plan'))] };
}
