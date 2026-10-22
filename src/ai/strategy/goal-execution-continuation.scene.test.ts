import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { withGoalPlannerInput, planOwnerGoals } from './goal-planner-input';
import { planGoals } from './goal-planner';
import { goalFact } from './goal-facts';
import { createGoalPlanMethods } from './goal-plan-methods';
import { allocateStrategy } from './allocator';
import { allocationGrants, applyExecutorFeedback, settleAllocationState, advanceAllocationLeases, pruneAllocationProvenance } from './allocation-lifecycle';
import { createStrategyCommandGateway, type StrategyCommandProposal } from './command-gateway';
import { recordAllocationCommands } from './allocation-ledger';
import { goalBuildExecutor } from './executors/goal-economy';
import { regionIndex, landIdAt } from './regions';
import type { DecisionFacts } from './decision';
import type { Objective } from './types';

// Original continuation counterexamples: native source and real SDK commands.
// Explicit economy goals here are bridge contracts, not public puzzle results.
it.each([{ x: 150, y: 100 }, { x: 700, y: 500 }])('retains one build task and payment while worker $x,$y travels and the foundation appears', point => {
  const game = sketchScene('native-paid-build-continuation').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'us' }).player('foe', { race: 'ember', team: 'foe' }).playerState('us', { gold: 3000 })
    .townHall('us', 500, 500, { id: 'home' }).building('us', 'barracks', 500, 800, { id: 'producer' })
    .worker('us', point.x, point.y, { id: 'builder' }).build().createGame();
  game.scriptedVictory = true; regionIndex(game.map);
  const original = snapshotGame(game), at = { landId: landIdAt(game.map, { x: 500, y: 800 })!, point: { x: 500, y: 800 } };
  const goal = { id: 'native-paid-build', owner: 'us', effects: [goalFact({ kind: 'supply-cap', minimum: original.players.us!.supplyCap + 4 })],
    rewardGold: 2000, deadlineTick: 10000, reasons: [] };
  const objective: DecisionFacts<Objective> = { id: goal.id, owner: 'us', kind: 'ExpandLand', target: at, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: null },
    status: 'candidate', rank: null, sinceTick: 0, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  let memory = createAiPolicyMemory(), warm = false;
  for (let sequence = 0; sequence < 20 && !warm; sequence++) {
    const output = planOwnerGoals({ snapshot: original, owner: 'us', version: 'v9_knight', memory, goals: [goal] });
    warm = output.readyActions.some(row => row.action.declaration.kind === 'build'); memory = JSON.parse(JSON.stringify(memory));
  }
  expect(warm).toBe(true);
  let token = '', paidTick: number | undefined, checkedNext = false, commands = 0;
  for (let think = 0; think < 32 && !checkedNext; think++) {
    const snapshot = snapshotGame(game);
    const accepted = withNavigationAudit(event => {
      if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
    }, () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory, goals: [goal] }, (input, frame) => {
      const output = planGoals(input); memory.goalPlanning!.cache = output.cache;
      const bridge = createGoalPlanMethods({ snapshot, objectives: [objective], output, resolve: frame.resolveReference, requote: frame.requote });
      let authority = allocateStrategy({ snapshot, situation: input.context.situation, objectives: [objective], methods: bridge.methods,
        providers: [bridge.provider], previous: memory.strategyAllocation ?? null }).memory;
      const grants = allocationGrants(authority), proposals: StrategyCommandProposal[] = [];
      for (const grant of grants) {
        const execution = authority.executions[grant.action.actionId]!, method = authority.methods[grant.methodId]!;
        const feedback = goalBuildExecutor.execute({ snapshot, owner: 'us', objective, method, execution, grant, events: authority.events,
          goalFacts: frame.executionFacts(authority), goalReferences: authority.goalReferences! });
        for (const entry of feedback.commands) proposals.push({ id: `native-paid:build:${game.tick}:${proposals.length}`, source: 'executor',
          executor: execution.executor, action: execution.token, allocationRevision: authority.revision, ...entry });
        authority = applyExecutorFeedback(authority, snapshot, feedback);
      }
      const result = createStrategyCommandGateway({ snapshot, owner: 'us', memory: authority, grants: allocationGrants(authority), queuedTick: null }).admit(proposals);
      authority = recordAllocationCommands(authority, snapshot, result.admissions);
      memory.strategyAllocation = pruneAllocationProvenance(advanceAllocationLeases(settleAllocationState(authority, snapshot), snapshot));
      return result.accepted.map(row => ({ playerId: 'us', scriptId: row.executor, command: row.command }));
    })));
    const authority = memory.strategyAllocation!, executions = Object.values(authority.executions), budgets = Object.values(authority.budgets);
    expect(executions).toHaveLength(1); expect(budgets).toHaveLength(1);
    token ||= JSON.stringify(executions[0]!.token); expect(JSON.stringify(executions[0]!.token)).toBe(token);
    expect(budgets[0]!.amountGold).toBe(120);
    if (budgets[0]!.paidGold) {
      paidTick ??= snapshot.tick;
      expect(budgets[0]!.paidGold).toBe(120); expect(budgets[0]!.state).toBe('spent');
      expect(budgets[0]!.nativePayments).toHaveLength(1);
      const foundation = snapshot.buildings.find(building => building.kind === 'farm')!;
      expect(foundation).toBeDefined(); expect(snapshot.players.us!.gold).toBe(2880);
      expect(executions[0]!.state.goalOutputBindings).toEqual({ building: foundation.id });
      checkedNext = snapshot.tick > paidTick;
    }
    commands += accepted.length;
    issueCommandFrame(game, accepted); for (let tick = 0; tick < 15; tick++) stepGame(game);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(checkedNext).toBe(true); expect(commands).toBe(1);
});

it('retains the original ordinary attack task after its declared route and clock change', () => {
  const game = sketchScene('native-owner-attack-continuation').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'us' }).player('foe', { race: 'ember', team: 'foe' }).playerState('us', { gold: 1500 })
    .townHall('us', 700, 1000, { id: 'home' }).townHall('foe', 1050, 1000, { id: 'enemy-site' })
    .unit('us', 'footman', 1000, 1000, { id: 'fighter' }).build().createGame();
  game.scriptedVictory = true; let memory = createAiPolicyMemory(), token = '';
  for (let think = 0; think < 5; think++) {
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_knight', memory }, { strategyControl: true });
    const executions = Object.values(memory.strategyAllocation!.executions);
    expect(executions).toHaveLength(1); expect(executions[0]!.executor).toBe('goal.destroy-target');
    token ||= JSON.stringify(executions[0]!.token); expect(JSON.stringify(executions[0]!.token)).toBe(token);
    issueCommandFrame(game, entries); for (let tick = 0; tick < 15; tick++) stepGame(game);
    memory = JSON.parse(JSON.stringify(memory));
  }
});
