import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { planOwnerGoals } from './goal-planner-input';
import { settleCommittedGoals, retainCommittedGoalObjectives } from './goal-commitment-objectives';
import { settleAllocationState } from './allocation-lifecycle';
import { readGoalObjective } from './goal-authority-references';
import type { BootstrapStrategyOutput } from './bootstrap-control';

function nativeExpansion(replacement: boolean) {
  let scene = sketchScene('native-owner-expansion-continuation').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'us' }).player('foe', { race: 'ember', team: 'foe' }).playerState('us', { gold: 1500 })
    .townHall('us', 400, 400, { id: 'home' }).goldMine('new-mine', 1500, 1000, 10000)
    .worker('us', 1370, 1000, { id: 'builder' }).unit('us', 'footman', 1400, 1040, { id: 'guard-a' })
    .unit('us', 'footman', 1430, 1040, { id: 'guard-b' });
  if (replacement) scene = scene.building('us', 'barracks', 500, 800, { id: 'producer' })
    .building('us', 'farm', 700, 500, { id: 'supply-a' }).building('us', 'farm', 850, 500, { id: 'supply-b' })
    .worker('us', 500, 500, { id: 'replacement' });
  const game = scene.build().createGame(); game.scriptedVictory = true;
  return game;
}

it.each([false, true])('continues a granted hall goal after discovery ends, with worker replacement %s', replacement => {
  const game = nativeExpansion(replacement), original = snapshotGame(game);
  let memory = createAiPolicyMemory(), output: BootstrapStrategyOutput | undefined;
  for (let warm = 0; warm < 20; warm++) {
    const result = planOwnerGoals({ snapshot: original, owner: 'us', version: 'v9_knight', memory });
    memory = JSON.parse(JSON.stringify(memory));
    if (result.readyActions.some(action => action.action.declaration.kind === 'build')) break;
  }
  if (!replacement) expect(createHash('sha256').update(JSON.stringify(original)).digest('hex'))
    .toBe('1284d7a5d9012546be8e17f3dcb98581beda0dd067032e148ef43882fc023b70');
  let originalToken = '', buildCommands = 0, repairCommands = 0, acknowledged = false, replanned = false;
  const limit = replacement ? 20 : 5;
  for (let think = 0; think < limit; think++) {
    const snapshot = snapshotGame(game);
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'us', version: 'v9_knight', memory }, {
      strategyControl: true, observeBootstrapPlan(_context, _entries, observed) { output = observed; },
    });
    const authority = memory.strategyAllocation!, objective = authority.objectives['ExpandLand:us:new-mine']!;
    const budget = Object.values(authority.budgets)[0]!;
    const builds = entries.filter(entry => entry.scriptId === 'goal.build' && entry.command.type === 'build');
    buildCommands += builds.length;
    if (game.tick === 0) {
      expect(builds).toHaveLength(1);
      originalToken = JSON.stringify(budget.action);
    }
    expect(Object.values(authority.budgets)).toHaveLength(1);
    expect(readGoalObjective(authority, objective.objectiveId)).toMatchObject({ id: objective.objectiveId, kind: 'ExpandLand' });
    const foundation = snapshot.buildings.find(building => building.kind === 'townHall' && building.id !== 'home');
    if (foundation) {
      expect([budget.amountGold, budget.paidGold, budget.state]).toEqual([400, 400, 'spent']);
      expect(budget.nativePayments).toHaveLength(1);
      const originalExecution = authority.executions[budget.action.actionId]!;
      expect(JSON.stringify(budget.action)).toBe(originalToken);
      expect(originalExecution.state.goalOutputBindings).toEqual({ building: foundation.id });
      expect(output!.goalPlanner!.plans.some(plan => plan.goal.id === objective.objectiveId)).toBe(true);
      expect(output!.decision.objectives.find(goal => goal.id === objective.objectiveId)!.reasons)
        .toContainEqual(expect.objectContaining({ code: 'admitted-goal-retained-after-discovery' }));
      acknowledged = true;
      if (replacement && game.tick === 30) game.units.find(unit => unit.id === 'builder')!.hp = 0;
    }
    if (replacement) {
      const repairs = entries.filter(entry => entry.scriptId === 'goal.build' && entry.command.type === 'repair'
        && entry.command.unitIds.includes('replacement'));
      repairCommands += repairs.length;
      if (repairs.length) {
        expect(repairs[0]!.command).toMatchObject({ type: 'repair', buildingId: foundation!.id });
        expect(authority.leases['unit:replacement']!.origin).toBe('allocator');
        replanned = true;
      }
    }
    issueCommandFrame(game, entries);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    memory = JSON.parse(JSON.stringify(memory));
    if (replacement && replanned) break;
  }
  expect(acknowledged).toBe(true); expect(buildCommands).toBe(1);
  if (replacement) { expect(replanned).toBe(true); expect(repairCommands).toBe(1); }
  else expect(game.buildings.find(building => building.kind === 'townHall' && building.id !== 'home')!.buildProgress).toBeGreaterThan(32);
  const authority = memory.strategyAllocation!, definition = readGoalObjective(authority, 'ExpandLand:us:new-mine')!;
  const ended = settleAllocationState(settleCommittedGoals(authority, [], [{ ...definition, status: 'abandoned',
    reasons: [{ code: 'controller-abandon-request', factIds: [definition.id] }] }], game.tick), snapshotGame(game));
  expect(ended.objectives[definition.id]!.status).toBe('abandoned');
  expect(ended.events.at(-1)).toMatchObject({ kind: 'parent-invalidated', reason: { code: 'committed-goal-explicitly-ended',
    values: { status: 'abandoned', sourceReasonCodes: 'controller-abandon-request' } } });
  expect(retainCommittedGoalObjectives(ended, [])).toEqual([]);
});
