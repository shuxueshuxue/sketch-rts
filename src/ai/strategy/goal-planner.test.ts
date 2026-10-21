import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { FactWorkQueue } from './fact-work';
import { goalCampId, goalFact } from './goal-facts';
import { planGoals } from './goal-planner';
import { bindGoalFact, matchGoalFacts } from './goal-fact-matching';
import type { GoalActionDeclaration, GoalFact, GoalFactObservation, GoalPlannerInput, GoalPlanningContext } from './goal-planner-types';

/** Algorithm contract tests use small declarative operators, not the public
 * puzzle bridge or a claim that the real domain/source has been integrated. */
function example() {
  const game = sketchScene('generic-goal-regression').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: UNIT_DEFS.footman.cost })
    .townHall('us', 350, 350).townHall('foe', 4000, 4000).goldMine('ore', 2000, 2000, 10000)
    .unit('neutral', 'ogreWarrior', 1800, 1800, { id: 'guard-a' })
    .unit('neutral', 'ogreWarrior', 2200, 2200, { id: 'guard-b' }).build().createGame();
  const snapshot = snapshotGame(game), at = { landId: 'land:1' as const, point: { x: 2000, y: 2000 } };
  const bank = (minimum: number) => goalFact({ kind: 'gold', minimum, byTick: 10000 });
  const recruit = goalFact({ kind: 'unit-available', unitKind: 'footman', count: 1, at, byTick: 10000 });
  const campA = goalFact({ kind: 'camp-cleared', campId: goalCampId(['guard-a']) });
  const campB = goalFact({ kind: 'camp-cleared', campId: goalCampId(['guard-b']) });
  const hall = goalFact({ kind: 'hall-complete', mineId: 'ore', at });
  const declare = (id: string, preconditions: readonly GoalFact[], effects: readonly GoalFact[],
    flows: GoalActionDeclaration['flows'], cost: number, duration = 10): GoalActionDeclaration => ({
    id, kind: id === 'build' ? 'build' : id === 'train' ? 'train' : 'clear-camp', preconditions,
    effects: effects.map(fact => ({ fact, operation: 'establish', at: 'finish' })), demands: [], flows,
    duration: { state: 'met', value: duration, factIds: [] }, cost: { state: 'met', value: [{ code: 'native-test-cost', gold: cost, factIds: [] }], factIds: [] },
    successProbability: { state: 'met', value: 1, factIds: [] }, executor: { executor: 'test-operator', parameters: {} }, outputs: [], reasons: [],
  });
  const bounty = BUILDING_DEFS.townHall.cost / 2;
  const actions = [
    declare('train', [bank(UNIT_DEFS.footman.cost)], [recruit], [
      { resource: { kind: 'gold' }, delta: -UNIT_DEFS.footman.cost, at: 'start', factIds: [] },
      { resource: { kind: 'unit-pool', unitKind: 'footman', at }, delta: 1, at: 'finish', factIds: [] }], UNIT_DEFS.footman.cost),
    ...[campA, campB].map((camp, index) => declare(`clear-${index}`, [recruit], [camp], [
      { resource: { kind: 'gold' }, delta: bounty, at: 'finish', factIds: [], source: { kind: 'event', id: camp.id } }], 5)),
    declare('build', [bank(BUILDING_DEFS.townHall.cost)], [hall], [
      { resource: { kind: 'gold' }, delta: -BUILDING_DEFS.townHall.cost, at: 'start', factIds: [] }], BUILDING_DEFS.townHall.cost),
    declare('expensive-bounty', [], [campA], [{ resource: { kind: 'gold' }, delta: BUILDING_DEFS.townHall.cost,
      at: 'finish', factIds: [], source: { kind: 'event', id: 'separate-costly-reward' } }], 1000),
  ];
  const readFact = (fact: GoalFact): GoalFactObservation => {
    const p = fact.predicate, quantity = p.kind === 'gold' ? snapshot.players.us!.gold
      : p.kind === 'unit-available' ? snapshot.units.filter(unit => unit.owner === 'us' && unit.kind === p.unitKind && unit.hp > 0).length : undefined;
    const met = quantity !== undefined && quantity >= (p.kind === 'unit-available' ? p.count : p.kind === 'gold' ? p.minimum : Infinity);
    return { fact, state: met ? 'met' : 'unmet', observedTick: snapshot.tick, revision: JSON.stringify([fact.id, quantity ?? false]),
      reason: { code: 'native-contract-world', factIds: [fact.id], values: {} }, evidence: [], ...(quantity === undefined ? {} : { quantity }) };
  };
  const context: GoalPlanningContext = { snapshot, owner: 'us', tick: 0, version: 'v9_summoner', readFact,
    situation: { tick: 0, owner: 'us', horizonTicks: 10000, lands: [], seas: [], assets: [], units: [], opportunities: [],
      economy: { cashGold: snapshot.players.us!.gold, predictedIncomeGold: 0, horizonTicks: 10000, ledger: [] }, limitations: [] } };
  const input = (limit = 6144): GoalPlannerInput => ({ context,
    goals: [{ id: 'mine', owner: 'us', effects: [hall], rewardGold: 2000, deadlineTick: 10000, reasons: [] }],
    providers: [{ id: 'unordered-operators', actionsFor: () => actions }],
    initialBalances: [{ resource: { kind: 'gold' }, quantity: snapshot.players.us!.gold, asOfTick: context.tick, factIds: [] }],
    declarationRevision: 'operators-v1', limits: { maxDepth: 8, maxExpansions: 512, maxPlans: 8 }, work: new FactWorkQueue(context.tick, limit) });
  return { input, actions, bank, context, snapshot };
}

it('regresses an unordered domain and combines two partial bounties without overdrawing native capital', () => {
  const { input, snapshot } = example(), request = input(), before = JSON.stringify(snapshot);
  const output = planGoals(request), plan = output.plans[0]!;
  expect(plan.status).toBe('ready');
  expect(plan.actions.map(action => action.id).sort()).toEqual(['build', 'clear-0', 'clear-1', 'train']);
  expect(plan.readyActionIds).toEqual(['train']);
  expect(plan.actions.find(action => action.id === 'build')!.dependsOnActionIds).toEqual(expect.arrayContaining(['clear-0', 'clear-1']));
  expect(plan.resourceTimeline.every(event => event.after >= 0)).toBe(true);
  expect(plan.costGold).toBeCloseTo(UNIT_DEFS.footman.cost / (1 + 10 / 2400) + 10 / (1 + 20 / 2400)
    + BUILDING_DEFS.townHall.cost / (1 + 30 / 2400), 10);
  expect(plan.alternatives.find(alternative => alternative.actionId === 'expensive-bounty')).toMatchObject({ status: 'rejected', declaration: { id: 'expensive-bounty' } });
  expect(request.work.receipt.used).toBe(plan.search.work); expect(request.work.receipt.used).toBeLessThanOrEqual(6144);
  expect(JSON.stringify(snapshot)).toBe(before);
  const reversed = input();
  expect(planGoals({ ...reversed, providers: [{ ...reversed.providers[0]!, actionsFor: () => [...example().actions].reverse() }] })).toEqual(output);
});

it('does not spend work at zero allowance and resumes a JSON frontier instead of restarting it each think', () => {
  const { input } = example(), first = input(0), initial = planGoals(first);
  expect(initial.plans[0]!.status).toBe('search-pending'); expect(first.work.receipt.used).toBe(0);
  let previous = JSON.parse(JSON.stringify(initial.cache)), complete = false;
  for (let tick = 15; tick <= 3000; tick += 15) {
    const next = input(5), context = { ...next.context, tick, snapshot: { ...next.context.snapshot, tick } };
    const result = planGoals({ ...next, context, work: new FactWorkQueue(tick, 5),
      initialBalances: next.initialBalances.map(balance => ({ ...balance, asOfTick: tick })), previous });
    expect(result.plans[0]!.search.work).toBeLessThanOrEqual(5);
    previous = JSON.parse(JSON.stringify(result.cache));
    if (result.plans[0]!.status === 'ready') { complete = true; break; }
  }
  expect(complete).toBe(true);
});

it('reuses an unchanged declarative graph and invalidates it when a relevant world answer changes', () => {
  const { input, context } = example(), initial = planGoals(input());
  const unchanged = input(), reused = planGoals({ ...unchanged, previous: initial.cache });
  expect(reused.plans[0]!.search.work).toBe(0); expect(unchanged.work.receipt.used).toBe(0);
  const original = context.readFact;
  const changed = { ...context, readFact: (fact: GoalFact) => {
    const result = original(fact);
    return fact.predicate.kind === 'hall-complete' ? { ...result, state: 'met' as const, revision: 'native-hall-finished' } : result;
  } };
  const completed = planGoals({ ...input(), context: changed, previous: initial.cache });
  expect(completed.plans[0]!.status).toBe('complete'); expect(completed.readyActions).toEqual([]);
});

it('preserves pending facts, bounded search and output-reference unification without fake entity IDs', () => {
  const { input, context } = example();
  const pending = planGoals({ ...input(), providers: [], context: { ...context, readFact: fact => ({ fact, state: 'pending', observedTick: 0,
    revision: 'queued', requestId: 'shared-field', requestedTick: 0, reason: { code: 'queued', factIds: [], values: {} }, evidence: [] }) } });
  expect(pending.plans[0]!.status).toBe('waiting-facts'); expect(pending.readyActions).toEqual([]);
  const bounded = planGoals({ ...input(), limits: { maxDepth: 1, maxExpansions: 2, maxPlans: 1 } });
  expect(bounded.plans[0]!.status).toBe('search-pending'); expect(bounded.plans[0]!.search.limitReason).not.toBeNull();
  const output = { kind: 'output' as const, actionId: 'build-yard', output: 'building' };
  const required = goalFact({ kind: 'building-complete', buildingKind: 'shipyard', at: { point: { x: 2000, y: 2000 } }, building: { kind: 'binding', name: 'hull' } });
  const produced = goalFact({ ...required.predicate as Extract<GoalFact['predicate'], { kind: 'building-complete' }>, building: output });
  const bindings = matchGoalFacts(produced, required)!;
  expect(bindings).toEqual({ hull: output }); expect(bindGoalFact(required, bindings).predicate).toMatchObject({ building: output });
});

it('releases a cached future availability at its fixed absolute tick instead of shifting it away', () => {
  const { input, context } = example(), original = context.readFact;
  const clocked: GoalPlanningContext = { ...context, readFact: fact => {
    const value = original(fact);
    return fact.predicate.kind === 'gold' && fact.predicate.minimum === UNIT_DEFS.footman.cost
      ? { ...value, availableTick: 100, revision: 'paid-job-ready-at-100' } : value;
  } };
  const first = planGoals({ ...input(), context: clocked });
  expect(first.plans[0]!.actions.find(action => action.id === 'train')).toMatchObject({ startTick: 100, state: 'waiting-time' });
  const at100: GoalPlannerInput = { ...input(), context: { ...clocked, tick: 100, snapshot: { ...clocked.snapshot, tick: 100 } },
    initialBalances: input().initialBalances.map(balance => ({ ...balance, asOfTick: 100 })), work: new FactWorkQueue(100) };
  const cached = planGoals({ ...at100, previous: JSON.parse(JSON.stringify(first.cache)) }), cold = planGoals({ ...at100, work: new FactWorkQueue(100) });
  expect(cached.plans[0]!.actions).toEqual(cold.plans[0]!.actions);
  expect(cached.plans[0]!.readyActionIds).toEqual(['train']); expect(cached.plans[0]!.search.work).toBe(0);
});


it('consumes an arrival-offset effect while its producer still holds its actor, equally after JSON cache reuse', () => {
  const { input, actions, context } = example(), at = { landId: 'land:1' as const, point: { x: 2000, y: 2000 } };
  const safe = goalFact({ kind: 'site-safe', site: at, throughTick: 1000 });
  const hall = goalFact({ kind: 'hall-complete', mineId: 'ore', at });
  const cleared = goalFact({ kind: 'camp-cleared', campId: goalCampId(['guard-a']) });
  const actor = (unitId: string) => ({ resource: { kind: 'unit' as const, unitId }, quantity: 1, from: 'start' as const, until: 'finish' as const });
  const base = (id: string, preconditions: readonly GoalFact[], fact: GoalFact, duration: number, unit: string): GoalActionDeclaration => ({
    ...actions[0]!, id, preconditions, effects: [{ fact, operation: 'establish', at: 'finish' }], flows: [], demands: [actor(unit)],
    cost: { state: 'met', value: [], factIds: [] }, duration: { state: 'met', value: duration, factIds: [] },
  });
  const defend = base('guard-window', [], safe, 200, 'guard');
  const operators = [{ ...defend, effects: [{ fact: safe, operation: 'establish' as const, at: { offsetTicks: 20 } }] },
    base('construction', [safe], hall, 10, 'worker'), base('redeploy-guard', [hall], cleared, 10, 'guard')];
  const request = input(), configured = { ...request, goals: [{ ...request.goals[0]!, effects: [cleared] }],
    providers: [{ id: 'window-operators', actionsFor: () => operators }] };
  const first = planGoals(configured), schedule = first.plans[0]!.actions;
  expect(schedule.find(action => action.id === 'construction')).toMatchObject({ startTick: 20, finishTick: 30, state: 'waiting-actions' });
  expect(schedule.find(action => action.id === 'redeploy-guard')).toMatchObject({ startTick: 200, finishTick: 210 });
  const next = { ...configured, context: { ...context, tick: 15, snapshot: { ...context.snapshot, tick: 15 } },
    initialBalances: configured.initialBalances.map(balance => ({ ...balance, asOfTick: 15 })), work: new FactWorkQueue(15) };
  const reused = planGoals({ ...next, previous: JSON.parse(JSON.stringify(first.cache)) });
  const cold = planGoals({ ...next, work: new FactWorkQueue(15) });
  expect(reused.plans[0]!.actions).toEqual(cold.plans[0]!.actions);
  expect(reused.plans[0]!.actions.find(action => action.id === 'construction')).toMatchObject({ startTick: 35, finishTick: 45 });
  expect(reused.plans[0]!.search.work).toBe(0);
});


it('prices the whole remaining chain and withholds its ready bundle when later losses make it unprofitable', () => {
  const { input, actions } = example(), request = input();
  const costly = actions.filter(action => action.id !== 'expensive-bounty').map(action => ({ ...action,
    cost: { state: 'met' as const, value: [{ code: 'remaining-native-cost', gold: action.id === 'train' ? 1 : 1000, factIds: [] }], factIds: [] } }));
  const output = planGoals({ ...request, goals: [{ ...request.goals[0]!, rewardGold: 500 }],
    providers: [{ id: 'whole-chain-cost', actionsFor: () => costly }] });
  const plan = output.plans[0]!;
  expect(plan.status).toBe('blocked'); expect(plan.costGold).toBeCloseTo(1 / (1 + 10 / 2400)
    + 2000 / (1 + 20 / 2400) + 1000 / (1 + 30 / 2400), 10);
  expect(plan.valueGold).toBeLessThan(0); expect(plan.completedTick).toBeGreaterThan(0);
  expect(plan.actions.find(action => action.id === 'train')!.declaration.cost).toMatchObject({ value: [{ gold: 1 }] });
  expect(plan.readyActionIds).toEqual([]); expect(output.readyActions).toEqual([]);
  expect(plan.reasons[0]!.code).toBe('goal-plan-net-nonpositive');
});

it('preserves deferred grounding as waiting evidence and retries its published alternatives after JSON continuation', () => {
  const { input, actions, context } = example(), action = { ...actions.find(action => action.id === 'build')!, preconditions: [], flows: [] };
  let published = false, withDeferred = false;
  const unavailable = { state: 'unmet' as const, reason: { code: 'contract-unused-port', factIds: [], values: {} } };
  const grounding: NonNullable<GoalPlanningContext['grounding']> = {
    buildSites: () => published ? { state: 'met', candidates: [], factIds: [], ...(withDeferred ? { deferred: [{ id: 'other-site',
      requestIds: ['shared-geometry:other-site'], reason: { code: 'geometry-publication-pending', factIds: [], values: {} } }] } : {}) }
      : { state: 'pending', requestIds: ['shared-geometry:site'], reason: { code: 'geometry-publication-pending', factIds: [], values: {} } },
    productionOptions: () => unavailable, transportOptions: () => unavailable,
  };
  const provider = { id: 'pending-domain-contract', actionsFor: (fact: GoalFact, ctx: GoalPlanningContext) => {
    if (fact.predicate.kind !== 'hall-complete') return [];
    return ctx.grounding!.buildSites('townHall', fact.predicate.at).state === 'met' ? [action] : [];
  } };
  const configured = { ...input(), context: { ...context, grounding }, providers: [provider] };
  const first = planGoals({ ...configured, work: new FactWorkQueue(0, 1) });
  expect(first.plans[0]!.status).toBe('waiting-facts'); expect(first.readyActions).toEqual([]);
  expect(first.plans[0]!.facts[0]!.observation.state).toBe('unmet'); // world truth was not changed
  expect(first.plans[0]!.deferredCandidates).toMatchObject([{ requestIds: ['shared-geometry:site'] }]);
  published = true; withDeferred = true;
  const next = planGoals({ ...configured, work: new FactWorkQueue(0), previous: JSON.parse(JSON.stringify(first.cache)) });
  expect(next.plans[0]!.status).toBe('ready'); expect(next.readyActions).toHaveLength(1);
  expect(next.plans[0]!.deferredCandidates).toMatchObject([{ id: 'other-site', requestIds: ['shared-geometry:other-site'] }]);
});

it('never turns an unsatisfied empty cached graph into a profitable ready plan', () => {
  const { input } = example();
  let previous: GoalPlannerInput['previous'];
  for (let sequence = 1; sequence <= 10; sequence++) {
    const result = planGoals({ ...input(), providers: [], work: new FactWorkQueue(0, 6144, undefined, sequence),
      ...(previous ? { previous } : {}) });
    expect(result.plans[0]!.status).toBe('blocked');
    expect(result.plans[0]!.actions).toEqual([]); expect(result.readyActions).toEqual([]);
    expect(result.plans[0]!.valueGold).toBeNull();
    expect(result.plans[0]!.reasons[0]!.code).toBe('goal-no-feasible-plan');
    previous = JSON.parse(JSON.stringify(result.cache));
  }
});

it('reports pinned-capacity pressure on the owning plan and keeps its ready bundle out of allocation', () => {
  const { input } = example(), pressure = { kind: 'geometry' as const, thinkSequence: 1, bytes: 17000, limitBytes: 16000,
    planIds: [input().goals[0]!.id], requestIds: ['geometry-root'], overflowCount: 1 };
  const paused = planGoals({ ...input(), capacityPressure: () => [pressure] });
  expect(paused.plans[0]!.status).toBe('search-pending'); expect(paused.readyActions).toEqual([]);
  expect(paused.plans[0]!.capacityPressure).toEqual([pressure]);
  expect(paused.plans[0]!.reasons[0]!.code).toBe('goal-geometry-pinned-capacity');
  expect(paused.plans[0]!.search.work).toBe(0);
  const resumed = planGoals({ ...input(), previous: JSON.parse(JSON.stringify(paused.cache)), capacityPressure: () => [] });
  expect(resumed.plans[0]!.status).toBe('ready'); expect(resumed.readyActions.length).toBeGreaterThan(0);
});

it('discovers explicit future achievers for a pending world fact while retaining its unobserved current state', () => {
  const { input, context, actions } = example(), request = input(), hall = request.goals[0]!.effects[0]!;
  const future = { ...actions.find(action => action.id === 'build')!, preconditions: [], flows: [] };
  const native = context.readFact;
  const output = planGoals({ ...request, context: { ...context, readFact: fact => fact.id === hall.id ? {
    fact, state: 'pending', observedTick: context.tick, revision: 'world-window-not-published', requestId: 'window', requestedTick: context.tick,
    reason: { code: 'world-window-pending', factIds: [], values: {} }, evidence: [],
  } : native(fact) }, providers: [{ id: 'future-achiever', actionsFor: () => [future] }] });
  expect(output.plans[0]!.status).toBe('ready'); expect(output.readyActions.map(row => row.action.id)).toEqual(['build']);
  expect(output.plans[0]!.facts.find(node => node.id === hall.id)!.observation.state).toBe('pending');
  expect(output.plans[0]!.facts.find(node => node.id === hall.id)!.producerActionIds).toEqual(['build']);
});

it('meets a protection deadline at effect activation while retaining its actor through the promised window', () => {
  const { input, actions } = example(), request = input();
  const safe = goalFact({ kind: 'site-safe', site: { landId: 'land:1', point: { x: 2000, y: 2000 } }, throughTick: 200 });
  const guard: GoalActionDeclaration = { ...actions[0]!, id: 'continuous-guard', kind: 'defend', preconditions: [],
    effects: [{ fact: safe, operation: 'establish', at: { offsetTicks: 20 } }], flows: [],
    demands: [{ resource: { kind: 'unit', unitId: 'guard' }, quantity: 1, from: 'start', until: 'finish' }],
    duration: { state: 'met', value: 200, factIds: [] }, cost: { state: 'met', value: [{ code: 'full-window-loss', gold: 10, factIds: [] }], factIds: [] } };
  const configured = { ...request, goals: [{ ...request.goals[0]!, effects: [safe], deadlineTick: 20 }],
    providers: [{ id: 'guard-window', actionsFor: () => [guard] }] };
  const output = planGoals(configured), plan = output.plans[0]!;
  expect(plan.status).toBe('ready'); expect(plan.completedTick).toBe(20);
  expect(plan.costGold).toBeCloseTo(10 / (1 + 200 / 2400), 12);
  expect(plan.actions[0]).toMatchObject({ startTick: 0, finishTick: 200 });
  expect(plan.actions[0]!.declaration.demands[0]!.until).toBe('finish');
  const cached = planGoals({ ...configured, work: new FactWorkQueue(0), previous: JSON.parse(JSON.stringify(output.cache)) });
  expect(cached.plans[0]!.actions).toEqual(plan.actions); expect(cached.plans[0]!.completedTick).toBe(20);
  const late = planGoals({ ...configured, work: new FactWorkQueue(0), goals: [{ ...configured.goals[0]!, deadlineTick: 19 }] });
  expect(late.plans[0]!.status).toBe('blocked'); expect(late.readyActions).toEqual([]);
});
