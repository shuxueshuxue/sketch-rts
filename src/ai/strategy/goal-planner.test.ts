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
  expect(plan.costGold).toBe(UNIT_DEFS.footman.cost + 10 + BUILDING_DEFS.townHall.cost);
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
  const pending = planGoals({ ...input(), context: { ...context, readFact: fact => ({ fact, state: 'pending', observedTick: 0,
    revision: 'queued', requestId: 'shared-field', requestedTick: 0, reason: { code: 'queued', factIds: [], values: {} }, evidence: [] }) } });
  expect(pending.plans[0]!.status).toBe('waiting-facts'); expect(pending.readyActions).toEqual([]);
  const bounded = planGoals({ ...input(), limits: { maxDepth: 1, maxExpansions: 2, maxPlans: 1 } });
  expect(bounded.plans[0]!.status).toBe('search-pending'); expect(bounded.plans[0]!.search.limitReason).not.toBeNull();
  const output = { kind: 'output' as const, actionId: 'train-hull', output: 'unit-0' };
  const required = goalFact({ kind: 'transport-in', seaId: 'sea:1', capacity: 10, byTick: 1000, transport: { kind: 'binding', name: 'hull' } });
  const produced = goalFact({ ...required.predicate as Extract<GoalFact['predicate'], { kind: 'transport-in' }>, transport: output });
  const bindings = matchGoalFacts(produced, required)!;
  expect(bindings).toEqual({ hull: output }); expect(bindGoalFact(required, bindings).predicate).toMatchObject({ transport: output });
});
