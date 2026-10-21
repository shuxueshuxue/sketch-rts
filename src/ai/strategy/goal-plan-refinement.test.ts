import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { goalFact } from './goal-facts';
import { FactWorkQueue } from './fact-work';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import { applyGoalRefinements, createGoalPlanRefiner, type GoalRefinementMemory } from './goal-plan-refinement';
import { createGoalPlanMethods } from './goal-plan-methods';
import type { GoalActionDeclaration, GoalActionProvider, GoalFactReader, GoalPlanningContext, GoalPlannerInput } from './goal-planner-types';

it('refines only the selected ready layer and its next layer, re-regresses exact prices, and never grants a coarse proposal', () => {
  const game = sketchScene('goal-refinement-contract').map('bareDuel').replaceDefaults().player('us', { race: 'grove' })
    .player('foe', { race: 'ember' }).townHall('us', 350, 350).townHall('foe', 4000, 4000).build().createGame();
  const snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  const facts = ['first', 'second', 'third'].map(campId => goalFact({ kind: 'camp-cleared', campId }));
  const calls: string[] = [], refinement: GoalRefinementMemory = { revision: 0, entries: [] };
  // Pure search/refinement contract. These declared API actions are not a
  // world camp simulation, domain quotation or public puzzle witness.
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [] }, native => {
    const readFact: GoalFactReader = fact => ({ fact, state: 'unmet', observedTick: snapshot.tick, revision: 'unchanged', evidence: [],
      reason: { code: 'contract-unmet', factIds: [], values: {} } });
    const { readProjectedFact: _projection, ...nativeContext } = native.context;
    const context: GoalPlanningContext = { ...nativeContext, precision: 'coarse', readFact };
    const provider: GoalActionProvider = { id: 'refinement-contract', actionsFor(effect, ctx) {
      const index = facts.findIndex(fact => fact.id === effect.id); if (index < 0) return [];
      if (ctx.precision === 'exact') calls.push(effect.id);
      const exact = ctx.precision === 'exact';
      const declaration: GoalActionDeclaration = { id: `${exact ? 'exact' : 'coarse'}-${index}`, kind: 'clear-camp',
        preconditions: index ? [facts[index - 1]!] : [], effects: [{ fact: effect, operation: 'establish', at: 'finish' }],
        demands: [], flows: [], outputs: [], reasons: [], executor: { executor: 'goal.clear-camp', parameters: { campId: String(index) } },
        duration: { state: 'met', value: exact ? 3 : 1, factIds: [] },
        cost: { state: 'met', value: [{ code: 'quoted-cost', gold: exact ? 20 : 0, factIds: [] }], factIds: [] },
        successProbability: { state: 'met', value: exact ? .8 : .9, factIds: [] } };
      return [declaration];
    } };
    const refineSelected = createGoalPlanRefiner({ memory: refinement, providers: [provider],
      exactContext: () => ({ ...context, precision: 'exact' }) });
    const { previous: _previous, ...nativeInput } = native;
    const base: GoalPlannerInput = { ...nativeInput, context, goals: [{ id: 'refine-chain', owner: 'us', effects: [facts[2]!],
      rewardGold: 1000, deadlineTick: 1000, reasons: [] }], providers: [applyGoalRefinements(provider, refinement)],
      initialBalances: [], limits: { maxDepth: 12, maxExpansions: 2048, maxPlans: 1 }, refineSelected,
      declarationRevision: 'coarse-0', work: new FactWorkQueue(snapshot.tick) };
    const first = planGoals(base);
    expect(first.plans[0]!.actions).toHaveLength(3);
    expect(calls.sort()).toEqual([facts[0]!.id, facts[1]!.id].sort());
    expect(first.readyActions).toEqual([]);
    expect(first.plans[0]!.actions.filter(node => node.refinement?.state === 'known')).toHaveLength(2);
    expect(createGoalPlanMethods({ snapshot, objectives: [], output: first }).methods).toEqual([]);
    const second = planGoals({ ...base, previous: JSON.parse(JSON.stringify(first.cache)), declarationRevision: `coarse-${refinement.revision}`,
      work: new FactWorkQueue(snapshot.tick) });
    expect(second.readyActions.map(row => row.action.declaration.id)).toEqual(['exact-0']);
    const ready = second.readyActions[0]!.action;
    expect(ready.refinement?.delta).toEqual({ durationTicks: 2, costGold: 20, successProbability: -.09999999999999998 });
    expect(ready.refinement?.reason.values).toMatchObject({ durationRatio: 3, durationChangedOverHalf: true });
    expect(calls).not.toContain(facts[2]!.id);
    const live: GoalRefinementMemory = { revision: 0, entries: [] }, liveWork = new FactWorkQueue(snapshot.tick);
    const immediate = planGoals({ ...base, work: liveWork,
      providers: [applyGoalRefinements(provider, live)], declarationRevision: 'live-0', refinementRevision: () => `live-${live.revision}`,
      refineSelected: createGoalPlanRefiner({ memory: live, providers: [provider], exactContext: () => ({ ...context, precision: 'exact' }) }) });
    expect(immediate.readyActions.map(row => row.action.declaration.id)).toEqual(['exact-0']);
    expect(immediate.plans[0]!.search.work).toBe(liveWork.receipt.services.filter(service => service.key.startsWith('goal-search')).reduce((sum, service) => sum + service.work, 0));
    expect(liveWork.receipt.used).toBeLessThanOrEqual(6144);
    const partial: GoalRefinementMemory = { revision: 0, entries: [] };
    const independent = planGoals({ ...base, work: new FactWorkQueue(snapshot.tick),
      providers: [applyGoalRefinements(provider, partial)], declarationRevision: 'partial-0', refinementRevision: () => `partial-${partial.revision}`,
      refineSelected: createGoalPlanRefiner({ memory: partial, providers: [provider], exactContext: () => ({ ...context, precision: 'exact' }),
        prepareExact: plan => ({ plan, changed: false, deferActionIds: plan.actions.filter(node => node.declaration.executor.parameters.campId === '1').map(node => node.id) }) }) });
    expect(independent.readyActions.map(row => row.action.declaration.id)).toEqual(['exact-0']);
    expect(partial.entries).toHaveLength(1); // the other layer's unpublished proof does not block this ready atom
    const retained = JSON.parse(JSON.stringify(refinement.entries[0]!)) as typeof refinement.entries[number];
    const obsolete = { ...retained, coarse: { ...retained.coarse, executor: { ...retained.coarse.executor,
      parameters: { campId: 'obsolete-choice' } } }, exact: [] };
    refinement.entries.push(obsolete, { ...obsolete, planId: 'another-plan' });
    const count = refinement.entries.length;
    refineSelected(second.plans[0]!);
    expect(refinement.entries).toHaveLength(count - 1);
    expect(refinement.entries.some(entry => entry.planId === 'another-plan')).toBe(true);
    const { planIds: _pins, lastUsedThink: _used, ...unreferenced } = retained;
    const alias = { ...unreferenced, lastUsedThink: -1, coarse: { ...retained.coarse, executor: { ...retained.coarse.executor,
      parameters: { ...retained.coarse.executor.parameters, alias: 'same-region-other-logical-target' } },
      refinementFor: { providerId: provider.id, effect: facts[2]! } },
      exact: retained.exact.map(action => ({ ...action, id: 'already-priced-alias' })) };
    const bounded: GoalRefinementMemory = { revision: refinement.revision, entries: [retained, alias,
      { ...alias, lastUsedThink: -2, coarse: { ...alias.coarse, executor: { ...alias.coarse.executor,
        parameters: { ...alias.coarse.executor.parameters, alias: 'second-unused-alias' } } } }] };
    createGoalPlanRefiner({ memory: bounded, providers: [provider], maxAlternativeQuotes: 1,
      exactContext: () => ({ ...context, precision: 'exact' }) })(second.plans[0]!);
    expect(bounded.entries.some(entry => entry.coarse.executor.parameters.alias === 'same-region-other-logical-target')).toBe(true);
    expect(bounded.entries.some(entry => entry.coarse.executor.parameters.alias === 'second-unused-alias')).toBe(false);
    const stale = createGoalPlanRefiner({ memory: refinement, providers: [provider],
      exactContext: () => ({ ...context, precision: 'exact' }), sourceRevision: () => 'changed-native-world' })(second.plans[0]!);
    expect(stale.readyActionIds).toEqual([]);
    expect(stale.actions.find(node => node.id === ready.id)?.refinement?.reason.code).toBe('selected-exact-source-changed');
    const rejected: GoalRefinementMemory = { revision: 0, entries: [] };
    const impossible: GoalActionProvider = { ...provider, actionsFor: (effect, ctx) => provider.actionsFor(effect, ctx).map(action => ({
      ...action, duration: { state: 'unmet', reason: { code: 'native-endpoint-unreachable', factIds: [], values: {} } },
    })) };
    const invalid = createGoalPlanRefiner({ memory: rejected, providers: [impossible],
      exactContext: () => ({ ...context, precision: 'exact' }) })(first.plans[0]!);
    expect(invalid.readyActionIds).toEqual([]);
    expect(rejected.entries).toHaveLength(2);
    expect(rejected.entries.every(entry => entry.state === 'invalid')).toBe(true);

  });
});

it('keeps a validated choice across clock changes and rejects it when native price inputs change', () => {
  const game = sketchScene('goal-refinement-clock-contract').map('bareDuel').replaceDefaults()
    .player('us').player('foe').townHall('us', 350, 350).townHall('foe', 4000, 4000).build().createGame();
  const snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [] }, native => {
    const at = { point: { x: 350, y: 350 }, landId: 'land:1' as const };
    const make = (tick: number, precision: 'coarse' | 'exact'): GoalActionDeclaration => ({
      id: `${precision}:${tick}`, kind: 'assemble', preconditions: [goalFact({ kind: 'worker-at', at, count: 1, byTick: tick + 100 })],
      effects: [], demands: [], flows: [], outputs: [], reasons: [],
      executor: { executor: 'goal.assemble', parameters: { at, byTick: tick + 100 } },
      duration: { state: 'met', value: precision === 'exact' ? 3 : 1, factIds: [] },
      cost: { state: 'met', value: [], factIds: [] }, successProbability: { state: 'met', value: 1, factIds: [] }, precision,
    });
    // A previously validated API quotation; this checks cache substitution,
    // not a simulated worker or a granted execution.
    const previous = make(0, 'coarse'), exact = make(0, 'exact');
    const refinements: GoalRefinementMemory = { revision: 1, entries: [{ coarse: previous, state: 'known', sourceRevision: 'body-and-world-1',
      exact: [exact], reason: { code: 'validated-price', factIds: [], values: {} } }] };
    const context = { ...native.context, precision: 'coarse' as const, tick: 15 };
    const provider: GoalActionProvider = { id: 'clock-choice', actionsFor: () => [make(15, 'coarse')] };
    const same = applyGoalRefinements(provider, JSON.parse(JSON.stringify(refinements)), () => 'body-and-world-1').actionsFor(
      goalFact({ kind: 'worker-at', at, count: 1, byTick: 115 }), context);
    expect(same).toHaveLength(1); expect(same[0]!.id).toBe(exact.id);
    expect(same[0]!.precision).toBe('exact');
    expect(same[0]!.preconditions[0]!.predicate).toMatchObject({ byTick: 115 });
    expect(same[0]!.preconditions[0]!.id).toBe(goalFact({ kind: 'worker-at', at, count: 1, byTick: 115 }).id);
    expect(same[0]!.executor.parameters.byTick).toBe(115);
    const changed = applyGoalRefinements(provider, refinements, () => 'body-and-world-2').actionsFor(
      goalFact({ kind: 'worker-at', at, count: 1, byTick: 115 }), context);
    expect(changed[0]!.precision).toBe('coarse');
  });
});
