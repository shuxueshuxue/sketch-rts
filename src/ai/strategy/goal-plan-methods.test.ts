import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, type Game } from '../../shared/sim';
import { UNIT_DEFS } from '../../shared/catalog';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { createGoalPlanMethods } from './goal-plan-methods';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import { goalFact } from './goal-facts';
import { landIdAt, regionIndex } from './regions';
import { allocateStrategy } from './allocator';
import { createStrategyCommandGateway } from './command-gateway';
import { goalTrainExecutor } from './executors/goal-economy';
import { goalTrainingReader } from './goal-training-ledger';
import { settleAllocationState } from './allocation-lifecycle';
import type { AllocationMethodQuoteInput } from './allocation-types';
import type { DecisionFacts } from './decision';
import type { Objective } from './types';
import type { GoalPlannerInput, GoalPlannerOutput } from './goal-planner-types';
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));

/** Explicit API goal for command-bridge contracts. It is not the ordinary
 * Objective collector or a claim about a public puzzle's selected plan. */
function withNativeTraining(run: (input: GoalPlannerInput, output: GoalPlannerOutput,
  objective: DecisionFacts<Objective>, game: Game) => void) {
  const game = sketchScene('goal-plan-command-bridge').map('bareDuel').replaceDefaults().player('us', { race: 'grove' })
    .player('foe', { race: 'ember' }).playerState('us', { gold: 3000 }).townHall('us', 350, 350).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 350, 650, { id: 'producer' }).worker('us', 450, 350).build().createGame();
  game.scriptedVictory = true; regionIndex(game.map);
  const snapshot = snapshotGame(game), at = { point: { x: 350, y: 650 }, landId: landIdAt(game.map, { x: 350, y: 650 })! };
  const goal = { id: 'bridge-contract', owner: 'us', effects: [goalFact({ kind: 'unit-available', unitKind: 'footman', count: 1, at, byTick: 10000 })],
    rewardGold: 2000, deadlineTick: 10000, reasons: [] };
  const objective: DecisionFacts<Objective> = { id: goal.id, kind: 'ExpandLand', owner: 'us', target: at, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: null },
    status: 'candidate', rank: null, sinceTick: 0, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  let memory = createAiPolicyMemory(), found = false;
  for (let sequence = 1; sequence <= 10 && !found; sequence++) {
    strict(() => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [goal] }, input => {
      const output = planGoals(input); memory.goalPlanning!.cache = output.cache;
      if (output.readyActions.length) { found = true; run(input, output, objective, game); }
    }));
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(found).toBe(true);
}

it('passes a real ready training atom through one plan bundle, the existing allocator, executor and public SDK', () => {
  withNativeTraining((input, output, objective, game) => {
    const bridge = createGoalPlanMethods({ snapshot: input.context.snapshot, objectives: [objective], output });
    expect(bridge.methods).toHaveLength(1); expect(bridge.methods[0]!.actions).toHaveLength(1);
    const method = bridge.methods[0]!; expect(method.kind).toBe('goal-plan'); expect(method.goalBundle!.unitIds).toEqual([]);
    expect(method.actions[0]!.executor).toBe('goal.train'); expect(method.actions[0]!.intent.kind).toBe('goal-action');
    const allocated = allocateStrategy({ snapshot: input.context.snapshot, situation: input.context.situation,
      objectives: [objective], methods: bridge.methods, providers: [bridge.provider], previous: null });
    expect(allocated.grants).toHaveLength(1);
    const grant = allocated.grants[0]!, execution = allocated.memory.executions[grant.action.actionId]!;
    expect(grant.leases.map(lease => lease.resourceKey)).toEqual(['queue:producer']);
    expect(grant.budgets.reduce((sum, budget) => sum + budget.amountGold, 0)).toBe(UNIT_DEFS.footman.cost);
    const feedback = goalTrainExecutor.execute({ snapshot: input.context.snapshot, owner: 'us', objective, method,
      execution, grant, events: allocated.events, goalReferences: allocated.memory.goalReferences!, goalTraining: goalTrainingReader(allocated.memory, input.context.snapshot) });
    expect(feedback.commands).toHaveLength(1);
    const proposals = feedback.commands.map((entry, index) => ({ id: `bridge-command-${index}`, source: 'executor' as const,
      executor: execution.executor, action: execution.token, allocationRevision: allocated.memory.revision, purpose: entry.purpose, command: entry.command }));
    const admitted = createStrategyCommandGateway({ snapshot: input.context.snapshot, owner: 'us', memory: allocated.memory,
      grants: allocated.grants, queuedTick: null }).admit(proposals);
    expect(admitted.admissions.every(row => row.status === 'accepted')).toBe(true);
    issueCommandFrame(game, admitted.accepted.map(row => ({ playerId: 'us', scriptId: row.executor, command: row.command })));
    expect(game.buildings.find(building => building.id === 'producer')!.queue).toHaveLength(1);
    expect(game.players.us!.gold).toBe(3000 - UNIT_DEFS.footman.cost);
    const completed = settleAllocationState({ ...allocated.memory, executions: { ...allocated.memory.executions,
      [execution.token.actionId]: { ...execution, status: 'complete' } } }, snapshotGame(game));
    expect(completed.objectives[objective.id]!.status).not.toBe('complete'); // one atom is not the goal's world proof
  });
});

it('quotes the full remaining chain once and subtracts one bundle opportunity price', () => {
  withNativeTraining((input, output, objective) => {
    const original = output.plans[0]!, costly = { ...original, costGold: original.costGold! + 500, valueGold: original.valueGold! - 500 };
    const bridge = createGoalPlanMethods({ snapshot: input.context.snapshot, objectives: [objective], output: { ...output, plans: [costly] } });
    const method = bridge.methods[0]!, request: AllocationMethodQuoteInput = { snapshot: input.context.snapshot,
      situation: input.context.situation, objective, method, unitIds: [], budgets: [], executions: [], valuation: { phase: 'gross' } };
    const gross = bridge.provider.quote(request); expect(gross.status).toBe('feasible');
    expect(gross.utility!.cost).toEqual([{ code: 'remaining-plan-actions', value: costly.costGold }]);
    let calls = 0;
    const net = bridge.provider.quote({ ...request, valuation: { phase: 'net', opportunity: proposal => {
      calls++; return { status: 'known', gold: 25, basis: 'no-positive-feasible-alternative', window: proposal.window, alternatives: [] };
    } } });
    expect(calls).toBe(1); expect(net.utility!.score).toBeCloseTo(gross.utility!.score - 25, 12);
    expect(bridge.methods[0]!.spends[0]!.amountGold).toBe(UNIT_DEFS.footman.cost);
    const excluded = bridge.provider.quote({ ...request, valuation: { phase: 'gross', unavailableProduction: [{ buildingId: 'producer', lane: 'training', fromTicks: 0, throughTicks: 1000 }] } });
    const unrelated = bridge.provider.quote({ ...request, valuation: { phase: 'gross', unavailableUnitIds: ['unrelated-unit'],
      unavailableProduction: [{ buildingId: 'other-producer', lane: 'training', fromTicks: 0, throughTicks: 1000 }] } });
    expect(unrelated.status).toBe('feasible');
    expect(excluded.status).toBe('blocked'); expect(excluded.missingPreconditions[0]!.status).toBe('unknown');
    expect(excluded.reason.code).toBe('goal-counterfactual-facts-pending');
    expect(createGoalPlanMethods({ snapshot: input.context.snapshot, objectives: [objective],
      output: { ...output, plans: [{ ...original, valueGold: -1 }] } }).methods).toEqual([]);
  });
});
