import type { AllocationReason } from './allocation-types';
import { bindGoalAction, bindGoalFact, goalActionContributes, goalBindingsKey, goalQuantity, matchGoalFacts, type GoalBindings } from './goal-fact-matching';
import { goalResourceKey, goalValueKey } from './goal-facts';
import { projectGoalResources, type GoalScheduledAction } from './goal-resource-ledger';
import { observationJsonBytes } from './observation-json-bytes';
import { discountGold } from './utility';
import { discoverGoalActions } from './goal-provider-candidates';
import { goalActionPresentCost } from './goal-action-value';
import type { GoalSearchMemory, GoalSearchPath as Path, GoalSearchStep as Step } from './goal-search-state';
export type { GoalSearchMemory } from './goal-search-state';
import type { GoalActionDeclaration, GoalActionNode, GoalAlternative, GoalFact, GoalFactObservation, GoalPlan,
  GoalPlannerInput, GoalPlannerOutput, GoalRequest, GoalResourceBalance } from './goal-planner-types';

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const reason = (code: string, factIds: readonly string[] = [], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });
const finish = (path: Path, epoch: number) => Math.max(epoch, ...path.steps.map(step => step.finishTick));
const pathKey = (path: Path) => goalValueKey([path.steps.map(step => [step.action.id, step.startTick, step.finishTick]), path.bindings]);
const achievementTick = (path: Path, goal: GoalRequest, state: GoalSearchMemory, input: GoalPlannerInput) =>
  Math.max(input.context.tick, ...goal.effects.map(fact => satisfies(fact, path, state, input).tick));
const pathValue = (path: Path, goal: GoalRequest, state: GoalSearchMemory, input: GoalPlannerInput) =>
  discountGold(path.probability * goal.rewardGold, achievementTick(path, goal, state, input) - input.context.tick) - path.cost;
const pathOrder = (epoch: number) => (a: Path, b: Path) => a.cost - b.cost || finish(a, epoch) - finish(b, epoch) || order(pathKey(a), pathKey(b));
const validEstimate = (action: GoalActionDeclaration) => {
  const { duration, cost, successProbability } = action;
  return duration.state === 'met'
  && Number.isFinite(duration.value) && duration.value >= 0 && cost.state === 'met'
  && cost.value.every(term => Number.isFinite(term.gold) && term.gold >= 0
    && (typeof term.at !== 'object' || Number.isFinite(term.at.offsetTicks) && term.at.offsetTicks >= 0
      && term.at.offsetTicks <= duration.value))
  && successProbability.state === 'met' && Number.isFinite(successProbability.value)
  && successProbability.value >= 0 && successProbability.value <= 1;
};

/** No domain action ordering appears here. Providers are queried only for
 * achievers of a requested fact, including partial numeric contributors. */
export function planGoals(input: GoalPlannerInput): GoalPlannerOutput {
  return planGoalPass(input, 0);
}
function planGoalPass(input: GoalPlannerInput, refinementPass: number): GoalPlannerOutput {
  const { context, work } = input, plans: GoalPlan[] = [], entries: GoalPlannerOutput['cache']['entries'][number][] = [];
  const providers = [...input.providers].sort((a, b) => order(a.id, b.id));
  const runs: { goal: GoalRequest; goalKey: string; state: GoalSearchMemory; beforeWork: number }[] = [];
  for (const goal of [...input.goals].sort((a, b) => order(a.id, b.id))) {
    const goalKey = goalValueKey(['discounted-action-costs-v1', goal, input.initialBalances.map(({ asOfTick: _epoch, ...balance }) => balance)]);
    const previous = input.previous?.owner === context.owner ? input.previous.entries.find(entry => entry.goalKey === goalKey
      && entry.declarationRevision === input.declarationRevision) : undefined;
    const unchanged = previous && !previous.continuation?.deferred?.length && work.withConsumer(goal.id, previous.plan.valueGold, () => previous.dependencies.every(dependency => {
      const prior = previous.plan.facts.find(node => node.id === dependency.factId)?.observation
        ?? previous.continuation?.observed.find(observed => observed.fact.id === dependency.factId);
      if (!prior) return false;
      const current = context.readFact(prior.fact);
      return current.revision === dependency.revision && current.state === dependency.state;
    }));
    if (unchanged && previous.continuation?.phase === 'done' && !hasCapacityPressure(input, goal.id)
      && (previous.plan.status === 'ready' || previous.plan.status === 'complete')) {
      const deadline = goal.deadlineTick;
      const refreshed = { ...previous.continuation, observed: previous.continuation.observed.map(observation => context.readFact(observation.fact)) };
      const replay = emptyPath();
      let scheduleValid = true;
      for (const action of previous.plan.actions) {
        const next = scheduleAction(replay, action.declaration, refreshed, input, goal);
        if (!next) { scheduleValid = false; break; }
        replay.steps.push(next.step); replay.bindings = next.bindings;
        replay.cost += goalActionPresentCost(next.step, context.tick);
        if (next.step.action.successProbability.state === 'met') replay.probability *= next.step.action.successProbability.value;
      }
      const shifted = replay.steps.map(step => actionNode(step, input));
      const projected = projectGoalResources({ epoch: context.tick, initial: balances(previous.continuation, input),
        actions: replay.steps });
      if (scheduleValid && projected.state === 'met' && goal.effects.every(fact => { const result = satisfies(fact, replay, refreshed, input);
        return result.met && (deadline === null || result.tick <= deadline); })) {
        const valueGold = pathValue(replay, goal, refreshed, input), profitable = valueGold > 0;
        const plan: GoalPlan = { ...previous.plan, observedTick: context.tick, actions: shifted, valueGold,
          status: previous.plan.status === 'complete' ? 'complete' : profitable ? 'ready' : 'blocked',
          reasons: profitable ? [] : [reason('goal-plan-net-nonpositive', [], { valueGold })],
          readyActionIds: profitable ? shifted.filter(action => action.state === 'ready').map(action => action.id) : [],
          completedTick: previous.plan.completedTick === null ? null : achievementTick(replay, goal, refreshed, input),
          resourceTimeline: projected.timeline,
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
      delete state.coarse;
    } else state = { version: 1, phase: 'regress', requests: goal.effects.map(fact => ({ fact, depth: 0 })),
      regressed: [], observed: [], candidates: [], alternatives: [], frontier: [], active: null, solutions: [], visited: [],
      expansions: 0, depth: 0, limitReason: null };
    if (unchanged && previous.continuation?.phase !== 'done') {
      const delta = context.tick - previous.plan.observedTick;
      for (const path of [...state.frontier, ...state.solutions, ...(state.active ? [state.active.path] : [])])
        for (const step of path.steps) { step.startTick += delta; step.finishTick += delta; }
    }
    const beforeWork = state.expansions;
    work.withConsumer(goal.id, previous?.plan.valueGold ?? null, () => work.register({ key: `${input.searchScope ?? 'goal-search'}:${goal.id}`,
      kind: 'search', tier: 'critical-route', minimum: 1, run: allowance => {
      if (hasCapacityPressure(input, goal.id)) return { work: 0, done: false };
      let used = 0;
      while (used < Math.min(allowance, 64) && state.phase !== 'done') {
        if (state.expansions >= input.limits.maxExpansions) { state.limitReason = 'expansion-limit'; state.phase = 'done'; break; }
        if (state.phase === 'regress') regressOne(state, input, providers);
        else composeOne(state, input, goal);
        state.expansions++; used++;
      }
      return { work: used, done: state.phase === 'done' };
    } }));
    runs.push({ goal, goalKey, state, beforeWork });
  }
  // Register every goal before flushing, so an earlier goal cannot spend the
  // entire think before equally important goals enter the shared round robin.
  work.flush();
  for (const { goal, goalKey, state, beforeWork } of runs) {
    const plan = work.withConsumer(goal.id, null, () => projectPlan(state, input, goal, state.expansions - beforeWork));
    plans.push(plan);
    entries.push({ goalKey, declarationRevision: input.declarationRevision,
      dependencies: state.observed.map(observed => ({ factId: observed.fact.id, revision: observed.revision, state: observed.state })),
      plan, continuation: state });
  }
  // A capacity gap is explicit and cannot turn an incomplete graph into a
  // ready bundle. Preserve the pinned evidence and continuation for resumption.
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index]!, pressure = input.capacityPressure?.().filter(item => item.planIds.includes(plan.goal.id)) ?? [];
    if (!pressure.length) continue;
    const paused: GoalPlan = { ...plan, status: 'search-pending', readyActionIds: [], capacityPressure: structuredClone(pressure),
      reasons: [reason('goal-geometry-pinned-capacity', pressure.flatMap(item => item.requestIds), {
        bytes: Math.max(...pressure.map(item => item.bytes)), limitBytes: Math.min(...pressure.map(item => item.limitBytes)) })] };
    plans[index] = paused;
    const indexInCache = entries.findIndex(entry => entry.plan.goal.id === plan.goal.id);
    if (indexInCache >= 0) entries[indexInCache] = { ...entries[indexInCache]!, plan: paused };
  }
  for (let index = 0; index < plans.length; index++) {
    const coarse = plans[index]!;
    const refined = work.withConsumer(coarse.goal.id, coarse.valueGold, () => input.refineSelected?.(coarse) ?? coarse);
    const ready = refined.actions.filter(action => refined.readyActionIds.includes(action.id) && action.declaration.precision !== 'coarse');
    const gated = refined.readyActionIds.length !== ready.length ? { ...refined, status: 'waiting-facts' as const,
      readyActionIds: ready.map(action => action.id), reasons: [...refined.reasons, reason('goal-selected-actions-require-exact-facts')] } : refined;
    plans[index] = gated;
    const cached = entries.findIndex(entry => entry.plan.goal.id === gated.goal.id);
    if (cached >= 0) entries[cached] = { ...entries[cached]!, plan: gated };
  }
  input.retainFactRequests?.(plans);
  plans.sort((a, b) => order(a.goal.id, b.goal.id));
  const retained = [...entries].sort((a, b) => order(a.plan.goal.id, b.plan.goal.id));
  while (observationJsonBytes(retained) > 256 * 1024) retained.pop();
  const output: GoalPlannerOutput = { plans, ...(input.campModelUsage ? { campModelUsage: input.campModelUsage() } : {}), cache: { version: 1, owner: context.owner, entries: retained,
    ...(retained.length < entries.length ? { truncated: true as const } : {}) }, readyActions: plans.flatMap(plan => plan.actions
    .filter(action => plan.readyActionIds.includes(action.id)).map(action => ({ goalId: plan.goal.id, planId: plan.id, action }))) };
  const revision = input.refinementRevision?.();
  // Regress changed quotes while their actor/world inputs are still the same
  // native frame. Waiting an extra simulation think would invalidate a quote
  // for a moving actor before it ever reached the allocator. Geometry itself
  // still crosses its normal publication boundary, and all passes share 6144.
  if (revision !== undefined && revision !== input.declarationRevision && refinementPass < 8
    && work.receipt.used < work.receipt.limit) {
    const next = planGoalPass({ ...input, previous: output.cache, declarationRevision: revision,
      searchScope: `${input.searchScope ?? 'goal-search'}:refine:${refinementPass + 1}:${revision}` }, refinementPass + 1);
    const combined = next.plans.map(plan => ({ ...plan, search: { ...plan.search,
      work: plan.search.work + (plans.find(prior => prior.id === plan.id)?.search.work ?? 0) } }));
    return { ...next, plans: combined, cache: { ...next.cache, entries: next.cache.entries.map(entry => ({ ...entry,
      plan: combined.find(plan => plan.id === entry.plan.id) ?? entry.plan })) } };
  }
  return output;
}
const hasCapacityPressure = (input: GoalPlannerInput, planId: string) => input.capacityPressure?.().some(item => item.planIds.includes(planId)) ?? false;
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
  // An unobserved present state can still have a known future achiever. The
  // pending observation stays in the graph; only explicit effects may satisfy it.
  if (observation.derived) state.requests.push(...observation.derived.allOf.map(fact => ({ fact, depth: request.depth + 1 })));
  // A currently met numeric balance can be consumed by another action. Its
  // positive-flow alternatives must remain available to repair that prefix.
  if (observation.state === 'met' && !goalQuantity(request.fact) && request.fact.predicate.kind !== 'transport-at') return;
  if (request.depth >= input.limits.maxDepth) { state.limitReason ??= 'depth-limit'; return; }
  const discovered = providers.map(provider => discoverGoalActions(provider, request.fact, input.context));
  for (const { deferred } of discovered) for (const item of deferred) {
    state.deferred ??= [];
    if (!state.deferred.some(candidate => candidate.id === item.id && candidate.factId === request.fact.id))
      state.deferred.push({ ...item, factId: request.fact.id });
  }
  const all = discovered.flatMap(result => result.actions).filter(action => goalActionContributes(action, request.fact))
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
  // Physical presence at a post is not a second inventory beside its region
  // pool. Every caller replays these same opening balances and declared flows;
  // observation quantities never mint an extra account during regression.
  return [...input.initialBalances];
}
type Satisfaction = { met: boolean; pending: boolean; bindings: GoalBindings; tick: number; producers: string[] };
const satisfactionCaches = new WeakMap<GoalPlannerInput, WeakMap<GoalSearchMemory,
  WeakMap<object, Map<string, { revision: number; result: Satisfaction }>>>>();
function satisfies(factInput: GoalFact, path: Path, state: GoalSearchMemory, input: GoalPlannerInput, parents: readonly string[] = []): Satisfaction {
  // One immutable prefix is checked repeatedly while choosing and scheduling
  // its next atom. New observed balances invalidate this local cache. Recursive
  // derived proofs retain their own cycle guard and are never memoized here.
  if (parents.length) return satisfiesUncached(factInput, path, state, input, parents);
  let goals = satisfactionCaches.get(input); if (!goals) satisfactionCaches.set(input, goals = new WeakMap());
  let paths = goals.get(state); if (!paths) goals.set(state, paths = new WeakMap());
  let facts = paths.get(path.steps); if (!facts) paths.set(path.steps, facts = new Map());
  const key = goalValueKey([factInput.id, path.bindings]), previous = facts.get(key);
  if (previous?.revision === state.observed.length) return previous.result;
  const result = satisfiesUncached(factInput, path, state, input, parents);
  facts.set(key, { revision: state.observed.length, result }); return result;
}
function satisfiesUncached(factInput: GoalFact, path: Path, state: GoalSearchMemory, input: GoalPlannerInput, parents: readonly string[]): Satisfaction {
  const fact = bindGoalFact(factInput, path.bindings), now = input.context.tick;
  const bounded = (result: Satisfaction): Satisfaction => 'byTick' in fact.predicate && result.tick > fact.predicate.byTick
    ? { ...result, met: false } : result;
  let binding = path.bindings;
  const producers: string[] = []; let available = now;
  const current = observe(state, input, fact);
  if (current.derived && !parents.includes(fact.id) && parents.length < input.limits.maxDepth) {
    const results = current.derived.allOf.map(required => satisfies(required, path, state, input, [...parents, fact.id]));
    if (results.every(result => result.met)) return bounded({ met: true, pending: false, bindings: binding,
      tick: Math.max(now, ...results.map(result => result.tick)), producers: [...new Set(results.flatMap(result => result.producers))].sort() });
  }
  const quantity = goalQuantity(fact);
  let physical: GoalFactObservation | null = null;
  if (input.context.readProjectedFact && path.steps.length && ['force-at', 'force-available', 'worker-at', 'cargo-aboard',
    'unit-available', 'interception-capability', 'camp-staging', 'route', 'transport-at'].includes(fact.predicate.kind)) {
    const projected = physical = input.context.readProjectedFact(fact, { actions: path.steps, bindings: path.bindings });
    if (projected && !quantity) return bounded({ met: projected.state === 'met', pending: projected.state === 'pending', bindings: binding,
      tick: projected.availableTick ?? now, producers: path.steps.filter(step => step.action.effects
        .some(effect => effect.operation === 'establish' && matchGoalFacts(effect.fact, fact, binding, true))
        || step.action.demands.some(demand => demand.resource.kind === 'entity-control'
          && demand.resource.entity.kind === 'existing' && projected.entityIds?.includes(demand.resource.entity.entityId)))
        .map(step => step.action.id) });
  }
  if (quantity) {
    const projected = projectGoalResources({ epoch: now, initial: balances(state, input), actions: path.steps });
    if (projected.state === 'met') {
      const amount = projected.balances.find(balance => goalResourceKey(balance.resource) === goalResourceKey(quantity.resource))?.quantity ?? 0;
      let groupAt = (physical ?? current).state === 'met';
      if (!physical) for (const step of path.steps) for (const effect of step.action.effects) {
        const matched = matchGoalFacts(bindGoalFact(effect.fact, binding), fact, binding);
        if (matched) { groupAt = effect.operation === 'establish'; binding = matched; }
      }
      if (amount + 1e-9 >= quantity.minimum && (!('cohort' in fact.predicate) || !fact.predicate.cohort?.length || groupAt)) {
        for (const step of path.steps) for (const flow of step.action.flows) if (flow.delta > 0
          && goalResourceKey(flow.resource) === goalResourceKey(quantity.resource)) {
          producers.push(step.action.id); available = Math.max(available, flow.at === 'start' ? step.startTick
            : flow.at === 'finish' ? step.finishTick : step.startTick + flow.at.offsetTicks);
        }
        return bounded({ met: true, pending: false, bindings: binding, tick: Math.max(available, (physical ?? current).availableTick ?? now), producers });
      }
    }
    return bounded({ met: false, pending: projected.state === 'pending' || (physical ?? current).state === 'pending',
      bindings: binding, tick: now, producers: [] });
  }
  let established = current.state === 'met';
  for (const step of path.steps) for (const effect of step.action.effects) {
    const matched = matchGoalFacts(bindGoalFact(effect.fact, binding), fact, binding);
    if (!matched) continue;
    established = effect.operation === 'establish'; binding = matched;
    if (established) { producers.push(step.action.id); available = Math.max(available, effect.at === 'start' ? step.startTick
      : effect.at === 'finish' ? step.finishTick : step.startTick + effect.at.offsetTicks); }
  }
  return bounded({ met: established, pending: !established && current.state === 'pending', bindings: binding,
    tick: Math.max(available, current.availableTick ?? now), producers });
}

function composeOne(state: GoalSearchMemory, input: GoalPlannerInput, goal: GoalRequest) {
  if (input.context.precision === 'coarse') { composeCoarseOne(state, input, goal); return; }
  if (!state.active) {
    state.frontier.sort(pathOrder(input.context.tick));
    const path = state.frontier.shift();
    if (!path) { state.phase = 'done'; return; }
    const goalMet = goal.effects.every(fact => { const result = satisfies(fact, path, state, input);
      return result.met && (goal.deadlineTick === null || result.tick <= goal.deadlineTick); });
    if (goalMet) {
      state.solutions.push(path); state.solutions.sort(pathOrder(input.context.tick));
      state.solutions.splice(input.limits.maxPlans); return;
    }
    state.active = { path, next: 0 };
  }
  const active = state.active, candidateId = active.candidateIds?.[active.next++];
  const action = active.candidateIds ? state.candidates.find(candidate => candidate.id === candidateId) : state.candidates[active.next++];
  if (!action) { state.active = null; return; }
  if (active.path.steps.some(step => step.action.id === action.id) || !validEstimate(action)) return;
  const scheduled = scheduleAction(active.path, action, state, input, goal);
  if (!scheduled) return;
  const { step, bindings } = scheduled, bound = step.action;
  if (bound.cost.state !== 'met' || bound.successProbability.state !== 'met') return;
  const path: Path = { steps: [...active.path.steps, step], bindings,
    cost: active.path.cost + goalActionPresentCost(step, input.context.tick),
    probability: active.path.probability * bound.successProbability.value };
  // Equal selected sets can have different invalidations, availability and
  // prefix timing. Do not erase an ordering solely because its IDs match.
  const key = pathKey(path);
  if (state.visited.includes(key)) return;
  state.visited.push(key); state.frontier.push(path);
  if (state.frontier.length > input.limits.maxExpansions) { state.frontier.sort(pathOrder(input.context.tick));
    state.frontier.splice(input.limits.maxExpansions); state.limitReason ??= 'frontier-limit'; }
}

/** Coarse search builds one dependency proposal instead of enumerating action
 * permutations. One frame transition is one charged search step. Checkpoints
 * backtrack failed achievers; exact rejection reopens alternatives next think.
 * Exhausting this heuristic is search-pending, never proof of infeasibility. */
function composeCoarseOne(state: GoalSearchMemory, input: GoalPlannerInput, goal: GoalRequest) {
  const search = state.coarse ??= { path: emptyPath(), root: 0, stack: [] };
  const push = (fact: GoalFact) => search.stack.push({ fact, next: 0, checkpoint: search.path, prerequisite: 0 });
  const fail = () => {
    const frame = search.stack.pop()!; search.path = frame.checkpoint;
    const parent = search.stack.at(-1);
    if (parent) { search.path = parent.checkpoint; delete parent.selected; delete parent.required; parent.prerequisite = 0; }
    else { state.limitReason ??= 'coarse-proposal-needs-alternative'; state.phase = 'done'; }
  };
  if (!search.stack.length) {
    while (search.root < goal.effects.length && satisfies(goal.effects[search.root]!, search.path, state, input).met) search.root++;
    if (search.root >= goal.effects.length) { state.solutions = [search.path]; state.phase = 'done'; state.frontier = []; return; }
    push(goal.effects[search.root]!); return;
  }
  const frame = search.stack.at(-1)!;
  if (satisfies(frame.fact, search.path, state, input).met) { search.stack.pop(); return; }
  if (!frame.options) {
    if (input.contextForPrefix && frame.fact.predicate.kind === 'force-at'
      && search.path.steps.some(step => step.action.kind === 'assemble')) {
      const context = input.contextForPrefix(search.path.steps);
      for (const provider of input.providers) {
        const discovered = discoverGoalActions(provider, frame.fact, context);
        for (const item of discovered.deferred) {
          state.deferred ??= [];
          if (!state.deferred.some(candidate => candidate.id === item.id && candidate.factId === frame.fact.id))
            state.deferred.push({ ...item, factId: frame.fact.id });
        }
        for (const action of discovered.actions.filter(action => goalActionContributes(action, frame.fact))) {
          if (!state.candidates.some(candidate => candidate.id === action.id)) state.candidates.push(action);
          if (!state.alternatives.some(candidate => candidate.actionId === action.id && candidate.factId === frame.fact.id))
            state.alternatives.push({ id: `alternative:${goalValueKey([frame.fact.id, action.id])}`, factId: frame.fact.id,
              actionId: action.id, declaration: action, status: 'pending', costGold: action.cost.state === 'met'
                ? action.cost.value.reduce((sum, term) => sum + term.gold, 0) : null, finishTick: null,
              reason: reason('goal-selected-prefix-achiever', [frame.fact.id]) });
        }
      }
    }
    const cost = (action: GoalActionDeclaration) => action.cost.state === 'met' ? action.cost.value.reduce((sum, term) => sum + term.gold, 0) : Infinity;
    const probability = (action: GoalActionDeclaration) => action.successProbability.state === 'met' ? action.successProbability.value : 0;
    const complete = (action: GoalActionDeclaration) => action.effects.some(effect => effect.operation === 'establish' && matchGoalFacts(effect.fact, frame.fact)) ? 1 : 0;
    frame.options = state.candidates.filter(action => validEstimate(action) && goalActionContributes(action, frame.fact))
      .map(action => ({ action, unmet: action.preconditions.filter(fact => !satisfies(fact, search.path, state, input).met).length }))
      .sort(({ action: a, unmet: first }, { action: b, unmet: second }) => complete(b) - complete(a) || first - second
        || cost(a) - cost(b) || probability(b) - probability(a)
        || (a.duration.state === 'met' ? a.duration.value : Infinity) - (b.duration.state === 'met' ? b.duration.value : Infinity)
        || order(a.id, b.id)).map(({ action }) => action.id);
    if (observe(state, input, frame.fact).derived?.allOf.length) frame.options.unshift('@derived');
    return;
  }
  if (!frame.selected) {
    const id = frame.options[frame.next++];
    if (!id) { fail(); return; }
    if (search.path.steps.some(step => step.action.id === id)) return;
    frame.selected = id; frame.checkpoint = search.path; frame.prerequisite = 0;
    frame.required = id === '@derived' ? [...observe(state, input, frame.fact).derived!.allOf]
      : [...state.candidates.find(action => action.id === id)!.preconditions]
        .sort((a, b) => Number(a.predicate.kind === 'transport-at') - Number(b.predicate.kind === 'transport-at'));
    return;
  }
  while (frame.prerequisite < frame.required!.length && satisfies(frame.required![frame.prerequisite]!, search.path, state, input).met)
    frame.prerequisite++;
  const required = frame.required![frame.prerequisite];
  if (required) {
    if (search.stack.length >= input.limits.maxDepth || search.stack.some(parent => parent.fact.id === required.id)) {
      search.path = frame.checkpoint; delete frame.selected; delete frame.required; frame.prerequisite = 0; return;
    }
    push(required); return;
  }
  if (frame.selected === '@derived') {
    search.path = frame.checkpoint; delete frame.selected; delete frame.required; frame.prerequisite = 0; return;
  }
  const action = state.candidates.find(action => action.id === frame.selected)!;
  const next = scheduleAction(search.path, action, state, input, goal);
  if (!next || action.cost.state !== 'met' || action.successProbability.state !== 'met') {
    search.path = frame.checkpoint; delete frame.selected; delete frame.required; frame.prerequisite = 0; return;
  }
  search.path = { steps: [...search.path.steps, next.step], bindings: next.bindings,
    cost: search.path.cost + goalActionPresentCost(next.step, input.context.tick),
    probability: search.path.probability * action.successProbability.value };
  if (satisfies(frame.fact, search.path, state, input).met) { search.stack.pop(); return; }
  // A positive numeric contributor can leave a remaining deficit. Its paid
  // prefix stays in place while another distinct contributor is considered.
  frame.checkpoint = search.path; delete frame.selected; delete frame.required; frame.prerequisite = 0;
}

/** Replay uses the same scheduler as composition: effect availability and
 * release of an exclusive actor are separate temporal constraints. */
function scheduleAction(path: Path, action: GoalActionDeclaration, state: GoalSearchMemory,
  input: GoalPlannerInput, goal: GoalRequest): { step: Step; bindings: GoalBindings } | null {
  let bindings = path.bindings, startTick = input.context.tick;
  const dependencies = new Set<string>();
  for (const fact of action.preconditions) {
    const result = satisfies(fact, { ...path, bindings }, state, input);
    if (!result.met) return null;
    bindings = result.bindings; startTick = Math.max(startTick, result.tick);
    result.producers.forEach(id => dependencies.add(id));
  }
  const bound = bindGoalAction(action, bindings);
  if (!validEstimate(bound) || bound.duration.state !== 'met') return null;
  // Exclusive demands are interval constraints, distinct from consumable flows.
  for (const prior of path.steps) if (bound.demands.some(demand => prior.action.demands.some(other =>
    goalValueKey(demand.resource) === goalValueKey(other.resource)))) {
    startTick = Math.max(startTick, prior.finishTick); dependencies.add(prior.action.id);
  }
  const finishTick = startTick + bound.duration.value;
  if (!Number.isFinite(finishTick) || goal.deadlineTick !== null && startTick > goal.deadlineTick) return null;
  const step: Step = { action: bound, startTick, finishTick, dependsOn: [...dependencies].sort() };
  let projection = projectGoalResources({ epoch: input.context.tick, initial: balances(state, input), actions: [...path.steps, step] });
  if (projection.state === 'unmet' && startTick < finish(path, input.context.tick)) {
    step.startTick = finish(path, input.context.tick); step.finishTick = step.startTick + bound.duration.value;
    step.dependsOn = path.steps.map(prior => prior.action.id).sort();
    projection = projectGoalResources({ epoch: input.context.tick, initial: balances(state, input), actions: [...path.steps, step] });
  }
  if (projection.state !== 'met' || goal.deadlineTick !== null && step.startTick > goal.deadlineTick) return null;
  return { step, bindings };
}
function actionNode(step: Step, input: GoalPlannerInput): GoalActionNode {
  const currentReady = step.action.preconditions.every(fact => {
    const current = input.context.readFact(fact);
    return current.state === 'met';
  });
  return { id: step.action.id, declaration: step.action,
    prerequisiteFactIds: step.action.preconditions.map(fact => fact.id), dependsOnActionIds: step.dependsOn,
    startTick: step.startTick, finishTick: step.finishTick,
    state: currentReady ? step.startTick > input.context.tick ? 'waiting-time' : 'ready' : 'waiting-actions', reasons: [] };
}

function projectPlan(state: GoalSearchMemory, input: GoalPlannerInput, goal: GoalRequest, work: number): GoalPlan {
  const valueOrder = (a: Path, b: Path) => pathValue(b, goal, state, input) - pathValue(a, goal, state, input)
    || pathOrder(input.context.tick)(a, b);
  const path = state.solutions.filter(path => projectGoalResources({ epoch: input.context.tick,
    initial: input.initialBalances, actions: path.steps }).state === 'met').sort(valueOrder)[0];
  const valueGold = path ? pathValue(path, goal, state, input) : null;
  const profitable = valueGold !== null && valueGold > 0;
  const steps = path?.steps ?? [], chosen = new Set(steps.map(step => step.action.id));
  const unresolved = state.observed.some(observation => observation.state === 'pending')
    || !!state.deferred?.length
    || state.candidates.some(action => [action.duration, action.cost, action.successProbability].some(estimate => estimate.state === 'pending'));
  const actions = steps.map(step => actionNode(step, input));
  // These nodes describe the observed world now. A later action can restore
  // the same predicate after a move, but cannot have produced today's proof.
  // Its real consumers already depend on that action through the scheduled
  // prefix; joining it back into the current fact would invent an ancestor.
  const currentFacts = new Set(state.observed.filter(observation => observation.state === 'met').map(observation => observation.fact.id));
  const projection = projectGoalResources({ epoch: input.context.tick, initial: balances(state, input), actions: steps });
  const currentMet = goal.effects.every(fact => observe(state, input, fact).state === 'met');
  const alternatives = state.alternatives.map(alternative => ({ ...alternative,
    status: chosen.has(alternative.actionId) ? 'chosen' as const : path && state.phase === 'done' ? 'rejected' as const : 'pending' as const,
    finishTick: steps.find(step => step.action.id === alternative.actionId)?.finishTick ?? null,
    reason: reason(chosen.has(alternative.actionId) ? 'goal-achiever-chosen' : path && state.phase === 'done'
      ? alternative.costGold !== null && alternative.costGold > path.cost ? 'goal-alternative-cost-above-plan' : 'goal-alternative-not-in-selected-plan'
      : 'goal-alternative-search-unresolved', [alternative.factId], { selectedCostGold: path?.cost ?? null }) }));
  return { id: `goal-plan:${goal.id}`, goal, observedTick: input.context.tick,
    status: currentMet ? 'complete' : path ? profitable ? 'ready' : 'blocked' : unresolved ? 'waiting-facts' : state.phase !== 'done' || state.limitReason ? 'search-pending' : 'blocked',
    facts: state.observed.map(observation => {
      const producers = path ? satisfies(observation.fact, path, state, input).producers : [];
      return { id: observation.fact.id, observation,
        producerActionIds: currentFacts.has(observation.fact.id) ? [] : producers };
    }),
    ...(state.deferred?.length ? { deferredCandidates: state.deferred } : {}),
    actions, edges: actions.flatMap(action => [
      ...action.prerequisiteFactIds.map(from => ({ from, to: action.id, kind: 'requires' as const })),
      ...action.declaration.effects.filter(effect => effect.operation === 'establish' && !currentFacts.has(effect.fact.id))
        .map(effect => ({ from: action.id, to: effect.fact.id, kind: 'establishes' as const })),
      ...action.dependsOnActionIds.map(from => ({ from, to: action.id, kind: 'resource-before' as const })),
    ]).concat(state.observed.flatMap(observation => observation.derived?.allOf.map(fact => ({ from: fact.id, to: observation.fact.id, kind: 'requires' as const })) ?? [])),
    subgoals: state.observed.map(observation => ({ id: `subgoal:${observation.fact.id}`, factId: observation.fact.id,
      parentGoalId: goal.id, requestedByActionIds: steps.filter(step => step.action.preconditions.some(fact => fact.id === observation.fact.id)).map(step => step.action.id),
      state: observation.state, chosenActionId: alternatives.find(alternative => alternative.factId === observation.fact.id && alternative.status === 'chosen')?.actionId ?? null,
      chosenActionIds: alternatives.filter(alternative => alternative.factId === observation.fact.id && alternative.status === 'chosen').map(alternative => alternative.actionId),
      alternativeIds: alternatives.filter(alternative => alternative.factId === observation.fact.id).map(alternative => alternative.id) })),
    alternatives, readyActionIds: profitable ? actions.filter(action => action.state === 'ready').map(action => action.id) : [],
    resourceTimeline: projection.state === 'pending' ? [] : projection.timeline,
    costGold: path?.cost ?? null, successProbability: path?.probability ?? null,
    valueGold, completedTick: path ? achievementTick(path, goal, state, input) : null,
    search: { expansions: state.expansions, depth: state.depth, work, limitReason: state.limitReason },
    reasons: path ? profitable ? [] : [reason('goal-plan-net-nonpositive', [], { valueGold })] : [reason(state.limitReason ?? (unresolved ? 'goal-required-facts-pending' : 'goal-no-feasible-plan'))] };
}
