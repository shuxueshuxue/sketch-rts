import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { GoalActionDeclaration, GoalFact, GoalFactObservation, GoalFactPredicate } from './goal-planner-types';
import type { GoalIncumbent, GoalIncumbentStep } from './goal-search-format';
import { goalGlobalStepKey, goalSemanticDecision } from './goal-search-format';
import { goalValueKey, semanticGoalPredicate } from './goal-facts';
import { retimeGoalActionPreconditions } from './goal-action-facts';
import { replayGoalIncumbent } from './goal-incumbent-replay';
import { createGoalRegenerate } from './goal-regenerate';
import { goalSearchWire } from './goal-search-wire';
import { createGoalResourceProjector, projectGoalResources } from './goal-resource-ledger';

const fact = (predicate: GoalFactPredicate): GoalFact => ({ id: `fact:${goalValueKey(semanticGoalPredicate(predicate))}`, predicate });
const protectedSite = fact({ kind: 'site-safe', site: { point: { x: 64, y: 64 }, landId: 'land:1' }, throughTick: 20000 });
const step = (id: string, dependsOn: string[] = []): GoalIncumbentStep => ({ id,
  selector: { provider: 'fixture', kind: 'build', grounding: { site: id } }, bindings: {}, dependsOn,
  startOffsetTicks: 0, finishOffsetTicks: 10,
  quote: { basis: 'published', durationTicks: 10, costGold: 0, successProbability: 1, dependencies: [] } });
function setup(steps = [step('one')]) {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-authority-paid-build-t15.json.gz', import.meta.url))).toString());
  const snapshot = frame.tick.snapshot as GameSnapshot, owner = frame.tick.authority.owner as string;
  const plan: GoalIncumbent = { goalId: 'native-paid-build', scheduledAtTick: snapshot.tick, steps, ready: [], condition: { state: 'valid' } };
  const declarations = new Map<string, GoalActionDeclaration>(steps.map(step => [String(step.selector.grounding.site), {
    id: goalGlobalStepKey(plan.goalId, step.selector), kind: 'build', precision: 'exact',
    preconditions: [], effects: [], demands: [], flows: [], outputs: [], reasons: [],
    duration: { state: 'met', value: 10, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
    successProbability: { state: 'met', value: 1, factIds: [] }, executor: { executor: 'goal.build', parameters: {} },
  } satisfies GoalActionDeclaration]));
  const observe = (input: GoalFact, met = true): GoalFactObservation => ({ fact: input, state: met ? 'met' : 'unmet',
    observedTick: snapshot.tick, availableTick: snapshot.tick, revision: 'current-native-view', evidence: [],
    reason: { code: met ? 'native-current' : 'native-unmet', factIds: [input.id], values: {} } });
  const regenerate = createGoalRegenerate([{ id: 'fixture', regenerate: input => ({ state: 'known', action: declarations.get(String(input.selector.grounding.site))! }) }]);
  const input: Parameters<typeof replayGoalIncumbent>[0] = { snapshot, owner, incumbent: plan, regenerate,
    readWorld: input => observe(input), readPublished: () => undefined, initialBalances: [], allowance: 6144,
    resolveCurrent: () => null, leaseConflict: () => false,
    retime: (action, finish) => retimeGoalActionPreconditions(action, finish, fact) };
  const update = (id: string, patch: Partial<GoalActionDeclaration>) => declarations.set(id, { ...declarations.get(id)!, ...patch });
  return { input, snapshot, plan, declarations, observe, update };
}

it('rebuilds deterministically across JSON without writing the input snapshot/plan or storing transient declarations', () => {
  const { input } = setup(), before = JSON.stringify(input.incumbent), snapshot = JSON.stringify(input.snapshot);
  const first = replayGoalIncumbent(input), restored = replayGoalIncumbent({ ...input, incumbent: JSON.parse(before) });
  expect(first).toEqual(restored); expect(first.state).toBe('known'); expect(first.incumbent.ready).toEqual(['one']);
  expect(goalSemanticDecision(first.incumbent)).toBe(goalSemanticDecision(restored.incumbent));
  expect(JSON.stringify(input.incumbent)).toBe(before); expect(JSON.stringify(input.snapshot)).toBe(snapshot);
  const wire = goalSearchWire({ version: 1, goals: { [first.incumbent.goalId]: { incumbent: first.incumbent } } });
  expect(wire.goals[first.incumbent.goalId]!.incumbent!.steps[0]).not.toHaveProperty('action');
});

it.each(['start', 'finish', { offsetTicks: 3 }] as const)('schedules from the effect time %j without calling it current world truth', at => {
  const { input, update, observe } = setup([step('producer'), step('consumer', ['producer'])]);
  update('producer', { effects: [{ fact: protectedSite, operation: 'establish', at }] });
  update('consumer', { preconditions: [protectedSite] });
  const result = replayGoalIncumbent({ ...input, readWorld: input => observe(input, false) });
  expect(result.state).toBe('known');
  expect(result.incumbent.steps[1]!.startOffsetTicks).toBe(at === 'start' ? 0 : at === 'finish' ? 10 : 3);
  expect(result.incumbent.ready).toEqual(['producer']);
});

it('retains a sustained actor until finish even when its safety effect activates at start', () => {
  const { input, update, observe, snapshot } = setup([step('guard'), step('next', ['guard'])]);
  const actor = { kind: 'unit' as const, unitId: snapshot.units.find(unit => unit.owner === input.owner && unit.hp > 0)!.id };
  update('guard', { duration: { state: 'met', value: 12000, factIds: [] },
    effects: [{ fact: protectedSite, operation: 'establish', at: 'start' }],
    demands: [{ resource: actor, quantity: 1, from: 'start', until: 'finish' }] });
  update('next', { preconditions: [protectedSite], demands: [{ resource: actor, quantity: 1, from: 'start', until: 'finish' }] });
  const result = replayGoalIncumbent({ ...input, readWorld: input => observe(input, false) });
  expect(result.state).toBe('known'); expect(result.incumbent.steps[0]!.finishOffsetTicks).toBe(12000);
  expect(result.incumbent.steps[1]!.startOffsetTicks).toBe(12000);
});

it('rebinds completion safety to the actual delayed finish and keeps a fixed hold obligation unchanged', () => {
  const { input, update, observe } = setup([step('producer'), step('consumer', ['producer'])]);
  update('producer', { effects: [{ fact: protectedSite, operation: 'establish', at: 'finish' }] });
  const relative = fact({ ...protectedSite.predicate as Extract<GoalFactPredicate, { kind: 'site-safe' }>, throughTick: 1 });
  update('consumer', { preconditions: [protectedSite, relative], preconditionWindows: [{ factId: relative.id, through: 'finish' }],
    effects: [{ fact: protectedSite, operation: 'establish', at: 'start' }] });
  const result = replayGoalIncumbent({ ...input, readWorld: input => observe(input, input.id !== protectedSite.id) });
  expect(result.state).toBe('known');
  const last = result.prefix[1]!;
  expect(last.action.preconditions.some(fact => 'throughTick' in fact.predicate && fact.predicate.throughTick === last.finishTick)).toBe(true);
  expect(last.action.effects[0]!.fact.predicate).toEqual(protectedSite.predicate);
});

it('rejects a conditional safety window invalidated after start but before the protected finish', () => {
  const { input, update } = setup([step('protection'), step('consumer', ['protection'])]);
  update('protection', { effects: [{ fact: protectedSite, operation: 'invalidate', at: { offsetTicks: 5 } }] });
  update('consumer', { preconditions: [protectedSite] });
  expect(replayGoalIncumbent(input)).toMatchObject({ state: 'invalid', repairFrom: 'consumer',
    reason: 'goal-replay-prefix-effect-invalidated' });
});

it('keeps the valid prefix and first repair step when the resource event prefix becomes insolvent', () => {
  const { input, update } = setup([step('prefix'), step('purchase', ['prefix'])]);
  update('purchase', { flows: [{ resource: { kind: 'gold' }, delta: -120, at: 'start', factIds: [] }] });
  const result = replayGoalIncumbent({ ...input, initialBalances: [{ resource: { kind: 'gold' }, quantity: 119, asOfTick: input.snapshot.tick, factIds: [] }] });
  expect(result).toMatchObject({ state: 'invalid', repairFrom: 'purchase', reason: 'goal-replay-resource-deficit' });
  expect(result.prefix).toHaveLength(1); expect(result.incumbent.ready).toEqual([]);
  expect(result.incumbent.steps.map(step => step.id)).toEqual(['prefix', 'purchase']);
});

it('rejects dead/foreign actual bindings and lease conflicts before declaring ready', () => {
  const { input } = setup();
  const unit = input.snapshot.units.find(unit => unit.owner === input.owner)!;
  const incumbent = { ...input.incumbent, steps: [{ ...input.incumbent.steps[0]!, bindings: { actor: { kind: 'existing' as const, entityId: unit.id } } }] };
  for (const patch of [{ hp: 0 }, { owner: 'somebody-else' }]) expect(replayGoalIncumbent({ ...input, incumbent,
    snapshot: { ...input.snapshot, units: input.snapshot.units.map(value => value.id === unit.id ? { ...value, ...patch } : value) } }))
    .toMatchObject({ state: 'invalid', reason: 'goal-replay-actor-missing' });
  expect(replayGoalIncumbent({ ...input, leaseConflict: () => true })).toMatchObject({ state: 'invalid', reason: 'goal-replay-lease-conflict' });
});

it('preserves invalid versus pending and does not spend beyond the shared replay allowance', () => {
  const { input } = setup();
  const result = replayGoalIncumbent({ ...input, allowance: 0, incumbent: { ...input.incumbent,
    condition: { state: 'invalid', step: 'one', reason: 'previous-death' } } });
  expect(result).toMatchObject({ state: 'pending', work: 0, regenerations: 0 });
  expect(result.incumbent.condition).toEqual({ state: 'invalid', step: 'one', reason: 'previous-death' });
});

it('keeps missing native proof pending and routes a projected origin mismatch to requote', () => {
  const { input, update, observe } = setup(); update('one', { preconditions: [protectedSite] });
  expect(replayGoalIncumbent({ ...input, readWorld: current => ({ ...observe(current), state: 'pending',
    requestId: 'native-request', requestedTick: input.snapshot.tick }) })).toMatchObject({ state: 'pending', requestIds: ['native-request'] });
  expect(replayGoalIncumbent({ ...input, readProjected: input => ({ ...observe(input, false),
    reason: { code: 'projected-route-origin-mismatch', factIds: [input.id], values: {} } }) }))
    .toMatchObject({ state: 'requote', reason: 'projected-route-origin-mismatch', incumbent: { condition: { state: 'valid' } } });
});

it('does not classify an unqueued pending estimate as an impossible action', () => {
  const { input, update } = setup();
  update('one', { duration: { state: 'pending', requestIds: [], reason: { code: 'await-domain-publication', factIds: [], values: {} } } });
  expect(replayGoalIncumbent(input)).toMatchObject({ state: 'pending', requestIds: [], reason: 'goal-replay-quote-pending' });
});

it('rejects stale/future proof and never resurrects an earlier location over the projected actual region', () => {
  const { input, update, observe } = setup([step('move'), step('next', ['move'])]);
  update('move', { effects: [{ fact: protectedSite, operation: 'establish', at: 'start' }] });
  update('next', { preconditions: [protectedSite] });
  for (const delta of [-1, 1]) expect(replayGoalIncumbent({ ...input, readWorld: fact => ({ ...observe(fact), observedTick: input.snapshot.tick + delta }) }))
    .toMatchObject({ state: 'invalid', reason: 'goal-replay-world-proof-invalid' });
  expect(replayGoalIncumbent({ ...input, readProjected: input => observe(input, false) }))
    .toMatchObject({ state: 'invalid', repairFrom: 'next' });
});

it('requires actual current bindings for ready and reports duration changes only beyond 50 percent', () => {
  const { input, update } = setup();
  const incumbent = { ...input.incumbent, steps: [{ ...input.incumbent.steps[0]!, bindings: { actor: { kind: 'binding' as const, name: 'future-worker' } } }] };
  expect(replayGoalIncumbent({ ...input, incumbent }).incumbent.ready).toEqual([]);
  update('one', { precision: 'coarse' }); expect(replayGoalIncumbent(input).incumbent.ready).toEqual([]);
  update('one', { duration: { state: 'met', value: 15, factIds: [] } }); expect(replayGoalIncumbent(input).quoteChanges).toEqual([]);
  update('one', { duration: { state: 'met', value: 16, factIds: [] } });
  expect(replayGoalIncumbent(input).quoteChanges).toEqual([{ step: 'one', relativeDurationDelta: .6 }]);
});

it('rejects expired safety, nonfinite availability and invalid effect intervals', () => {
  const { input, update, observe } = setup();
  const expired = fact({ ...protectedSite.predicate as Extract<GoalFactPredicate, { kind: 'site-safe' }>, throughTick: input.snapshot.tick - 1 });
  update('one', { preconditions: [expired] });
  expect(replayGoalIncumbent(input)).toMatchObject({ state: 'invalid', reason: 'goal-replay-safety-window-expired' });
  update('one', { preconditions: [protectedSite] });
  expect(replayGoalIncumbent({ ...input, readWorld: fact => ({ ...observe(fact), availableTick: NaN }) }))
    .toMatchObject({ state: 'invalid', reason: 'goal-replay-world-proof-invalid' });
  update('one', { preconditions: [], effects: [{ fact: protectedSite, operation: 'establish', at: { offsetTicks: 11 } }] });
  expect(replayGoalIncumbent(input)).toMatchObject({ state: 'invalid', reason: 'goal-replay-event-window-invalid' });
});

it('refuses an absent provider, a changed semantic selector and a cross-goal causal prefix', () => {
  const { input, declarations } = setup(); let calls = 0;
  expect(createGoalRegenerate([])({ snapshot: input.snapshot, goalId: input.incumbent.goalId,
    selector: input.incumbent.steps[0]!.selector, bindings: {}, prefix: [], readPublished: input.readPublished }))
    .toMatchObject({ state: 'invalid', reason: 'goal-regeneration-provider-missing' });
  const regenerate = createGoalRegenerate([{ id: 'fixture', regenerate: () => { calls++;
    return { state: 'known', action: { ...declarations.get('one')!, id: 'wrong-step' } }; } }]);
  expect(replayGoalIncumbent({ ...input, regenerate })).toMatchObject({ state: 'invalid', reason: 'goal-regeneration-selector-mismatch' });
  expect(calls).toBe(1);
  const selector = input.incumbent.steps[0]!.selector;
  expect(regenerate({ snapshot: input.snapshot, goalId: input.incumbent.goalId, selector, bindings: {}, readPublished: input.readPublished,
    prefix: [{ selector, action: { ...declarations.get('one')!, id: goalGlobalStepKey('another-goal', selector) }, startTick: 0, finishTick: 10 }] }))
    .toMatchObject({ state: 'invalid', reason: 'goal-regeneration-prefix-invalid' });
  expect(calls).toBe(1);
});

it('regenerates at the released start and records only the final current publication dependencies', () => {
  const { input, update, observe, declarations } = setup([step('producer'), step('consumer', ['producer'])]);
  update('producer', { effects: [{ fact: protectedSite, operation: 'establish', at: 'finish' }] });
  update('consumer', { preconditions: [protectedSite] });
  const starts: number[] = [];
  const result = replayGoalIncumbent({ ...input, readWorld: input => observe(input, false),
    readPublished: () => ({ ...observe(protectedSite), revision: 'published-route-2' }),
    regenerate: createGoalRegenerate([{ id: 'fixture', regenerate: input => {
      const action = declarations.get(String(input.selector.grounding.site))!;
      if (input.selector.grounding.site !== 'consumer') return { state: 'known', action };
      starts.push(input.startTick!); input.readPublished('native-route');
      return { state: 'known', action: { ...action, duration: { state: 'met', value: input.startTick === input.snapshot.tick ? 10 : 20, factIds: [] } } };
    } }]) });
  expect(result.state).toBe('known'); expect(starts).toEqual([input.snapshot.tick, input.snapshot.tick + 10]);
  expect(result.incumbent.steps[1]!.finishOffsetTicks).toBe(30);
  expect(result.incumbent.steps[1]!.quote.dependencies).toContainEqual({ kind: 'fact', key: 'native-route', revision: 'published-route-2' });
  expect(result.incumbent.steps[1]!.quote.dependencies).toHaveLength(2);
});

it('cannot turn a missing requested publication into an exact ready quote', () => {
  const { input, declarations } = setup();
  const regenerate = createGoalRegenerate([{ id: 'fixture', regenerate: input => {
    input.readPublished('unpublished-native-query'); return { state: 'known', action: declarations.get('one')! };
  } }]);
  expect(replayGoalIncumbent({ ...input, regenerate })).toMatchObject({ state: 'pending',
    reason: 'goal-replay-publication-pending', requestIds: ['unpublished-native-query'] });
});

it('releases exclusive intervals at their declared offsets without shortening a full hold', () => {
  const { input, update, snapshot } = setup([step('first'), step('second', ['first'])]);
  const actor = { kind: 'unit' as const, unitId: snapshot.units.find(unit => unit.owner === input.owner)!.id };
  update('first', { demands: [{ resource: actor, quantity: 1, from: { offsetTicks: 3 }, until: { offsetTicks: 7 } }] });
  update('second', { demands: [{ resource: actor, quantity: 1, from: { offsetTicks: 2 }, until: { offsetTicks: 4 } }] });
  const result = replayGoalIncumbent(input);
  expect(result.state).toBe('known'); expect(result.incumbent.steps[1]!.startOffsetTicks).toBe(5);
  expect(result.incumbent.steps[0]!.finishOffsetTicks).toBe(10);
  update('second', { demands: [{ resource: actor, quantity: 1, from: { offsetTicks: 7 }, until: { offsetTicks: 9 } }] });
  expect(replayGoalIncumbent(input).incumbent.steps[1]!.startOffsetTicks).toBe(0);
});

it('rejects an output resolved to a dead actual actor without adding the invalid step to the verified prefix', () => {
  const { input, snapshot } = setup();
  const actor = snapshot.units.find(unit => unit.owner === input.owner)!;
  const incumbent = { ...input.incumbent, steps: [{ ...input.incumbent.steps[0]!,
    bindings: { actor: { kind: 'binding' as const, name: 'future-actor' } } }] };
  expect(replayGoalIncumbent({ ...input, incumbent,
    snapshot: { ...snapshot, units: snapshot.units.map(unit => unit.id === actor.id ? { ...unit, hp: 0 } : unit) },
    resolveCurrent: () => ({ kind: 'existing', entityId: actor.id }) }))
    .toMatchObject({ state: 'invalid', reason: 'goal-replay-actor-missing', prefix: [] });
});

it('projects a shared cash prefix once for repeated quantitative facts and charges every ledger input row', () => {
  const { input, update, observe } = setup([step('income'), step('purchase', ['income'])]);
  const gold = fact({ kind: 'gold', minimum: 10, byTick: input.snapshot.tick + 100 });
  update('income', { flows: [{ resource: { kind: 'gold' }, delta: 10, at: 'finish', source: { kind: 'event', id: 'native-reward' }, factIds: [] }] });
  update('purchase', { preconditions: [gold, { ...gold, id: `${gold.id}-second` }],
    flows: [{ resource: { kind: 'gold' }, delta: -10, at: 'start', factIds: [] }] });
  let calls = 0;
  const result = replayGoalIncumbent({ ...input, readWorld: current => observe(current, false), projectResources: current => {
    calls++; return projectGoalResources(current);
  } });
  expect(result.state).toBe('known'); expect(result.incumbent.steps[1]!.startOffsetTicks).toBe(10);
  expect(calls).toBe(2); expect(result.work).toBeLessThanOrEqual(input.allowance);
});

it('accepts same-region pool point aliases while retaining exact site and region identity', () => {
  const { input, update, observe } = setup();
  const pool = fact({ kind: 'unit-available', unitKind: 'footman', count: 1,
    at: { landId: 'land:1', point: { x: 64, y: 64 } }, byTick: input.snapshot.tick + 10 });
  update('one', { preconditions: [pool] });
  const alias = { ...pool, predicate: { ...pool.predicate, at: { landId: 'land:1', point: { x: 80, y: 80 } } } as GoalFactPredicate };
  expect(replayGoalIncumbent({ ...input, readWorld: () => observe(alias) }).state).toBe('known');
  const other = { ...pool, predicate: { ...pool.predicate, at: { landId: 'land:2', point: { x: 80, y: 80 } } } as GoalFactPredicate };
  expect(replayGoalIncumbent({ ...input, readWorld: () => observe(other) }))
    .toMatchObject({ state: 'invalid', reason: 'goal-replay-world-proof-invalid' });
});

it('reuses ledger results through no-flow steps while a later debit still checks the full causal prefix', () => {
  const { input, update } = setup([step('before'), step('no-flow', ['before']), step('debit', ['no-flow'])]);
  update('debit', { flows: [{ resource: { kind: 'gold' }, delta: -1, at: 'start', factIds: [] }] });
  const projector = createGoalResourceProjector(), sizes: number[] = [];
  const result = replayGoalIncumbent({ ...input, projectResources: current => { sizes.push(current.actions.length); return projector(current); } });
  expect(sizes).toEqual([1, 3]);
  expect(result).toMatchObject({ state: 'invalid', repairFrom: 'debit', reason: 'goal-replay-resource-deficit' });
});
