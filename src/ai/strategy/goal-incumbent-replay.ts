import type { GameSnapshot } from '../../shared/types';
import type { GoalActionDeclaration, GoalEntityReference, GoalFact, GoalFactObservation, GoalResourceBalance } from './goal-planner-types';
import type { GoalIncumbent, GoalIncumbentStep, GoalRegenerate, GoalRegenerateInput, GoalSearchDependency } from './goal-search-format';
import { globalizeGoalBindings, goalGlobalStepKey } from './goal-search-format';
import { goalResourceKey, goalValueKey, semanticGoalPredicate } from './goal-facts';
import { goalQuantity, matchGoalFacts } from './goal-fact-matching';
import { createGoalResourceProjector, type projectGoalResources } from './goal-resource-ledger';
import { orderGoalReplayEvents } from './goal-replay-order';
import { goalSearchWire } from './goal-search-wire';

type Prefix = GoalRegenerateInput['prefix'];
type Read = (fact: GoalFact, prefix: Prefix) => GoalFactObservation;
export type GoalIncumbentReplay = Readonly<{
  state: 'known' | 'pending' | 'invalid' | 'requote'; incumbent: GoalIncumbent;
  /** Transient declarations: persist only incumbent, never this projection. */
  prefix: Prefix; repairFrom: string | null; reason: string | null;
  requestIds: readonly string[]; work: number; regenerations: number;
  quoteChanges: readonly Readonly<{ step: string; relativeDurationDelta: number }>[];
}>;

/** Rebuild only the selected steps. World truth is read separately from a
 * conditional causal prefix. Neither the input plan nor authority is written,
 * and a pending native result is not converted into an impossibility. */
export function replayGoalIncumbent(input: Readonly<{
  snapshot: GameSnapshot; owner: string; incumbent: GoalIncumbent; regenerate: GoalRegenerate;
  readWorld: Read; readPublished: GoalRegenerateInput['readPublished'];
  initialBalances: readonly GoalResourceBalance[]; allowance: number;
  /** Use the normal published movement/region reader, never a new navigator. */
  readProjected?: (fact: GoalFact, prefix: Prefix) => GoalFactObservation | null;
  resolveCurrent: (reference: GoalEntityReference) => Extract<GoalEntityReference, { kind: 'existing' }> | null;
  /** All physical lease checks stay with the existing authority reader. */
  leaseConflict: (action: GoalActionDeclaration, startTick: number, finishTick: number) => boolean;
  retime: (action: GoalActionDeclaration, finishTick: number) => GoalActionDeclaration | null;
  /** Pure ledger port permits offline profiling; the normal port is unchanged. */
  projectResources?: typeof projectGoalResources;
}>): GoalIncumbentReplay {
  const plan = goalSearchWire({ version: 1, goals: { [input.incumbent.goalId]: { incumbent: input.incumbent } } })
    .goals[input.incumbent.goalId]!.incumbent!, now = input.snapshot.tick;
  if (!Number.isSafeInteger(input.allowance) || input.allowance < 0 || input.allowance > 6144)
    throw Error('Invalid shared goal replay allowance');
  const bindings = globalizeGoalBindings(plan), prefix: Prefix[number][] = [], steps = new Map<string, GoalIncumbentStep>();
  const ready: string[] = [], changes: { step: string; relativeDurationDelta: number }[] = [];
  let work = 0, regenerations = 0;
  const ledger = input.projectResources ?? createGoalResourceProjector();
  const proofKeys = new WeakMap<GoalFact, string>();
  const proofKey = (fact: GoalFact) => {
    let key = proofKeys.get(fact);
    if (key === undefined) { key = goalValueKey(semanticGoalPredicate(fact.predicate)); proofKeys.set(fact, key); }
    return key;
  };
  let prefixResources: ReturnType<typeof projectGoalResources> | undefined;
  const spend = (amount = 1) => work + amount <= input.allowance ? (work += amount, true) : false;
  const result = (state: GoalIncumbentReplay['state'], step: string | null, reason: string | null,
    requestIds: readonly string[] = []): GoalIncumbentReplay => ({ state, repairFrom: step, reason, requestIds,
    work, regenerations, prefix, quoteChanges: changes,
    incumbent: { ...plan, scheduledAtTick: now, steps: plan.steps.map(old => steps.get(old.id) ?? {
      ...old, startOffsetTicks: Math.max(0, plan.scheduledAtTick + old.startOffsetTicks - now),
      finishOffsetTicks: Math.max(0, plan.scheduledAtTick + old.finishOffsetTicks - now) }),
      ready: state === 'invalid' || state !== 'known' && plan.condition.state === 'invalid' ? [] : ready,
      condition: state === 'invalid' ? { state: 'invalid', step: step!, reason: reason! }
        : state === 'known' ? { state: 'valid' } : plan.condition } });
  const ordered = orderGoalReplayEvents(plan.steps.map(step => ({ id: step.id,
    tick: plan.scheduledAtTick + step.startOffsetTicks, dependsOn: step.dependsOn, value: step })),
    (a, b) => { const left = goalGlobalStepKey(plan.goalId, a.selector), right = goalGlobalStepKey(plan.goalId, b.selector);
      return left < right ? -1 : left > right ? 1 : 0; });
  if (!ordered) return result('invalid', plan.steps[0]?.id ?? '', 'goal-replay-schedule-invalid');
  for (const step of ordered) {
    if (!spend()) return result('pending', step.id, 'goal-replay-budget-pending');
    for (const ref of Object.values(bindings[step.id]!)) if (ref.kind === 'existing') {
      const entity = input.snapshot.units.find(unit => unit.id === ref.entityId)
        ?? input.snapshot.buildings.find(building => building.id === ref.entityId);
      if (!entity || entity.owner !== input.owner || entity.hp <= 0)
        return result('invalid', step.id, 'goal-replay-actor-missing');
    }
    let start = Math.max(now, plan.scheduledAtTick + step.startOffsetTicks), currentReady = false, duration = 0;
    let action: GoalActionDeclaration | undefined;
    const dependencies = new Map<string, GoalSearchDependency>();
    for (let attempt = 0; ; attempt++) {
      if (attempt > plan.steps.length + 1) return result('pending', step.id, 'goal-replay-release-pending');
      if (!spend()) return result('pending', step.id, 'goal-replay-budget-pending');
      dependencies.clear(); let exhausted = false;
      const missing: string[] = [];
      const regenerated = input.regenerate({ snapshot: input.snapshot, goalId: plan.goalId, startTick: start,
        selector: step.selector, bindings: bindings[step.id]!, prefix, readPublished: key => {
          if (!spend()) { exhausted = true; return undefined; }
          const published = input.readPublished(key);
          if (published) dependencies.set(key, { kind: 'fact', key, revision: published.revision });
          else missing.push(key);
          return published;
        } });
      regenerations++;
      if (exhausted) return result('pending', step.id, 'goal-replay-budget-pending');
      if (regenerated.state !== 'known') return result(regenerated.state, step.id, regenerated.reason,
        regenerated.state === 'pending' ? regenerated.requestIds : []);
      action = regenerated.action;
      if (missing.length && action.precision !== 'coarse') return result('pending', step.id, 'goal-replay-publication-pending', missing);
      if (action.id !== goalGlobalStepKey(plan.goalId, step.selector) || action.kind !== step.selector.kind)
        return result('invalid', step.id, 'goal-replay-selector-mismatch');
      const estimates = [action.duration, action.cost, action.successProbability];
      if (estimates.some(value => value.state === 'pending')) return result('pending', step.id, 'goal-replay-quote-pending',
        estimates.flatMap(value => value.state === 'pending' ? value.requestIds : []));
      if (action.duration.state !== 'met' || action.cost.state !== 'met' || action.successProbability.state !== 'met'
        || !Number.isFinite(action.duration.value) || action.duration.value < 0
        || action.cost.value.some(term => !Number.isFinite(term.gold) || term.gold < 0)
        || !Number.isFinite(action.successProbability.value) || action.successProbability.value < 0 || action.successProbability.value > 1)
        return result('invalid', step.id, 'goal-replay-quote-invalid');
      duration = action.duration.value;
      const offset = (at: 'start' | 'finish' | { offsetTicks: number }) => at === 'start' ? 0 : at === 'finish' ? duration : at.offsetTicks;
      const inRange = (at: 'start' | 'finish' | { offsetTicks: number }) => Number.isFinite(offset(at)) && offset(at) >= 0 && offset(at) <= duration;
      if (action.effects.some(effect => !inRange(effect.at)) || action.demands.some(demand =>
        !Number.isFinite(demand.quantity) || demand.quantity < 0 || !inRange(demand.from) || !inRange(demand.until)
        || offset(demand.from) > offset(demand.until)) || action.cost.value.some(term => !inRange(term.at ?? 'finish')))
        return result('invalid', step.id, 'goal-replay-event-window-invalid');
      let released = start;
      for (const demand of action.demands) for (const previous of prefix) for (const other of previous.action.demands) {
        if (demand.quantity === 0 || other.quantity === 0 || goalValueKey(demand.resource) !== goalValueKey(other.resource)) continue;
        const previousOffset = (at: typeof other.from) => at === 'start' ? previous.startTick
          : at === 'finish' ? previous.finishTick : previous.startTick + at.offsetTicks;
        const from = start + offset(demand.from), until = start + offset(demand.until);
        if (from < previousOffset(other.until) && previousOffset(other.from) < until)
          released = Math.max(released, previousOffset(other.until) - offset(demand.from));
      }
      if (released > start) { start = released; continue; }
      if (!Number.isFinite(start + duration)) return result('invalid', step.id, 'goal-replay-schedule-invalid');
      const retimed = input.retime(action, start + duration);
      if (!retimed) return result('invalid', step.id, 'goal-replay-safety-window-invalid');
      if (retimed.id !== action.id || retimed.kind !== action.kind || retimed.duration.state !== 'met' || retimed.duration.value !== duration)
        return result('invalid', step.id, 'goal-replay-retime-identity-invalid');
      action = retimed; let release = start; currentReady = true;
      for (const fact of action.preconditions) {
        if (!spend()) return result('pending', step.id, 'goal-replay-budget-pending');
        const world = input.readWorld(fact, []);
        dependencies.set(fact.id, { kind: 'fact', key: fact.id, revision: world.revision });
        const sameFact = (proof: GoalFactObservation) => proof.fact.id === fact.id
          && proofKey(proof.fact) === proofKey(fact);
        if (!sameFact(world)
          || world.observedTick !== now)
          return result('invalid', step.id, 'goal-replay-world-proof-invalid');
        const projected = input.readProjected?.(fact, prefix);
        if (projected && (!sameFact(projected)
          || projected.observedTick !== now || projected.availableTick !== undefined && !Number.isFinite(projected.availableTick)))
          return result('invalid', step.id, 'goal-replay-projected-proof-invalid');
        if (world.availableTick !== undefined && !Number.isFinite(world.availableTick))
          return result('invalid', step.id, 'goal-replay-world-proof-invalid');
        if (projected?.reason.code === 'projected-route-origin-mismatch')
          return result('requote', step.id, 'projected-route-origin-mismatch');
        const proof = projected ?? world;
        let available = proof.state === 'met' ? proof.availableTick ?? now : null, invalidated = false;
        const conditional = (projected ? [] : prefix).flatMap(previous => previous.action.effects.filter(effect =>
          effect.fact.predicate.kind === fact.predicate.kind
          && matchGoalFacts(effect.fact, fact, {}, effect.operation === 'invalidate')).map(effect => ({ effect, previous,
            tick: effect.at === 'start' ? previous.startTick : effect.at === 'finish'
              ? previous.finishTick : previous.startTick + effect.at.offsetTicks })))
          .sort((a, b) => a.tick - b.tick || prefix.indexOf(a.previous) - prefix.indexOf(b.previous)
            || (a.effect.at === 'start' ? 0 : a.effect.at === 'finish' ? 2 : 1) - (b.effect.at === 'start' ? 0 : b.effect.at === 'finish' ? 2 : 1));
        for (const event of conditional) {
          const through = 'throughTick' in fact.predicate ? fact.predicate.throughTick : undefined;
          if (event.effect.operation === 'invalidate' && (event.tick <= start
            || through !== undefined && event.tick <= through && available !== null && event.tick >= available)) {
            available = null; invalidated = true;
          } else if (event.effect.operation === 'establish'
            && (event.tick <= Math.max(start, available ?? start) || available === null)) {
            available = Math.max(now, event.tick); invalidated = false;
          }
        }
        const location = available, quantity = goalQuantity(fact);
        if (quantity && (input.initialBalances.some(balance => goalResourceKey(balance.resource) === goalResourceKey(quantity.resource))
          || prefix.some(previous => previous.action.flows.some(flow => goalResourceKey(flow.resource) === goalResourceKey(quantity.resource))))) {
          if (!prefixResources) {
            if (!spend(prefix.reduce((sum, row) => sum + 1 + row.action.flows.length, 0)))
              return result('pending', step.id, 'goal-replay-budget-pending');
            prefixResources = ledger({ epoch: now, initial: input.initialBalances, actions: prefix });
          }
          const projection = prefixResources;
          if (projection.state === 'pending') return result('pending', step.id, projection.reason.code);
          const key = goalResourceKey(quantity.resource), initial = input.initialBalances.find(balance => goalResourceKey(balance.resource) === key)?.quantity ?? 0;
          const events = projection.timeline.filter(event => goalResourceKey(event.resource) === key);
          let amount = initial; available = null;
          for (const event of events.filter(event => event.tick <= start)) amount = event.after;
          if (amount >= quantity.minimum) available = start;
          else for (const event of events.filter(event => event.tick > start)) if (event.after >= quantity.minimum) { available = event.tick; break; }
          if ('cohort' in fact.predicate && fact.predicate.cohort?.length && location === null) available = null;
        }
        if (available === null) {
          if (invalidated) return result('invalid', step.id, 'goal-replay-prefix-effect-invalidated');
          if (proof.state === 'pending') return result('pending', step.id, proof.reason.code, [proof.requestId]);
          return result('invalid', step.id, proof.reason.code);
        }
        if ('byTick' in fact.predicate && available > fact.predicate.byTick)
          return result('invalid', step.id, 'goal-replay-fact-deadline-missed');
        if ('throughTick' in fact.predicate && fact.predicate.throughTick !== undefined
          && fact.predicate.throughTick < Math.max(start, available))
          return result('invalid', step.id, 'goal-replay-safety-window-expired');
        currentReady &&= world.state === 'met' && (world.availableTick ?? now) <= now;
        release = Math.max(release, available);
      }
      if (release <= start) break;
      start = release;
    }
    if (!action) return result('pending', step.id, 'goal-replay-quote-pending');
    const finish = start + duration;
    if (input.leaseConflict(action, start, finish)) return result('invalid', step.id, 'goal-replay-lease-conflict');
    let liveBindings = true;
    for (const reference of Object.values(bindings[step.id]!)) {
      const resolved = reference.kind === 'existing' ? reference : input.resolveCurrent(reference);
      if (!resolved) { liveBindings = false; continue; }
      const entity = input.snapshot.units.find(unit => unit.id === resolved.entityId)
        ?? input.snapshot.buildings.find(building => building.id === resolved.entityId);
      if (!entity || entity.owner !== input.owner || entity.hp <= 0)
        return result('invalid', step.id, 'goal-replay-actor-missing');
    }
    const scheduled = { action, selector: step.selector, startTick: start, finishTick: finish,
      dependsOn: step.dependsOn.map(id => goalGlobalStepKey(plan.goalId, plan.steps.find(parent => parent.id === id)!.selector)) };
    // A no-flow step changes no cash/source event. Keep the verified prefix
    // result; later flow steps still replay the complete dependency graph.
    const replayResources = !prefixResources || action.flows.length > 0;
    const ledgerWork = replayResources ? [...prefix, scheduled].reduce((sum, row) => sum + 1 + row.action.flows.length, 0) : 1;
    if (!spend(ledgerWork)) return result('pending', step.id, 'goal-replay-budget-pending');
    const resources = replayResources ? ledger({ epoch: now, initial: input.initialBalances, actions: [...prefix, scheduled] }) : prefixResources!;
    if (resources.state === 'pending') return result('pending', step.id, resources.reason.code);
    if (resources.state === 'unmet') return result('invalid', step.id, 'goal-replay-resource-deficit');
    prefix.push(scheduled);
    prefixResources = resources;
    const ratio = step.quote.durationTicks === 0 ? duration === 0 ? 0 : 1 : Math.abs(duration - step.quote.durationTicks) / step.quote.durationTicks;
    if (ratio > .5) changes.push({ step: step.id, relativeDurationDelta: ratio });
    steps.set(step.id, { ...step, startOffsetTicks: start - now, finishOffsetTicks: finish - now,
      quote: { ...step.quote, basis: action.precision === 'coarse' ? 'forecast' : 'published', durationTicks: duration,
        costGold: action.cost.state === 'met' ? action.cost.value.reduce((sum, term) => sum + term.gold, 0) : 0,
        successProbability: action.successProbability.state === 'met' ? action.successProbability.value : 0,
        dependencies: [...dependencies.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) } });
    if (currentReady && liveBindings && start <= now && action.precision === 'exact') ready.push(step.id);
  }
  return result('known', null, null);
}
