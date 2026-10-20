import { describe, expect, it } from 'vitest';
import { createBuilding } from '../../shared/map';
import { createGame, issuePlayerCommand, stepGame } from '../../shared/sim';
import { createStrategyAllocationMemory } from './control';
import { admitStrategyCommands, type StrategyCommandProposal } from './command-gateway';
import type { ActionGrant, ExecutionAction, ResourceLease } from './allocation-types';

it('admits native research beside a leased worker training queue, while rejecting a competing train', () => {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.players.player.gold = 10000; game.players.player.supplyCap = 100;
  const hall = createBuilding('producer', 'player', 'townHall', 1000, 1000, true); game.buildings.push(hall);
  const token = { actionId: 'train', generation: 1 };
  const execution: ExecutionAction = { token, objectiveId: 'expand', methodId: 'expand/method', executor: 'strategy.train-worker',
    intent: { kind: 'recover' }, target: { entityId: hall.id, point: { x: hall.x, y: hall.y } }, dependsOn: [], completionEffects: [],
    status: 'active', phase: 'train', sinceTick: game.tick, lastProgressTick: game.tick, state: {} };
  const lease: ResourceLease = { id: 'training-lane', resourceKey: `queue:${hall.id}`, objectiveId: execution.objectiveId,
    methodId: execution.methodId, action: token, sinceTick: game.tick, minimumStayUntilTick: game.tick, origin: 'allocator', incumbentTask: null };
  const memory = { ...createStrategyAllocationMemory('player', game.tick), revision: 1, leases: { [lease.resourceKey]: lease },
    executions: { train: execution } };
  const grant: ActionGrant = { revision: 1, action: token, objectiveId: execution.objectiveId, methodId: execution.methodId,
    leases: [lease], assignments: [], budgets: [], voyages: [], orders: [], commands: [], orderOverrides: [] };
  const submit = (proposal: Pick<StrategyCommandProposal, 'id' | 'source' | 'command'>): StrategyCommandProposal => ({
    ...proposal, executor: proposal.source === 'executor' ? execution.executor : 'economy',
    action: proposal.source === 'executor' ? token : null, allocationRevision: proposal.source === 'executor' ? 1 : null, purpose: 'task' });
  const research = submit({ id: 'research', source: 'script', command: { type: 'research', buildingId: hall.id, upgradeKind: 'buildingDurability' } });
  const train = submit({ id: 'formal-train', source: 'executor', command: { type: 'train', buildingId: hall.id, unitKind: 'worker' } });
  const competing = submit({ id: 'competing-train', source: 'script', command: train.command });
  const result = admitStrategyCommands({ snapshot: game, owner: 'player', memory, grants: [grant], proposals: [research, train, competing], queuedTick: null });
  expect(result.accepted.map(proposal => proposal.id)).toEqual(['research', 'formal-train']);
  expect(result.admissions.find(item => item.commandId === 'competing-train')).toMatchObject({ status: 'rejected', reason: { reason: 'command-dependent-resource-not-granted' } });
  for (const proposal of result.accepted) issuePlayerCommand(game, 'player', proposal.command);
  expect(hall.queue).toHaveLength(1); expect(hall.researchQueue).toHaveLength(1);
  const training = hall.queue[0]!.remaining, researching = hall.researchQueue[0]!.remaining;
  stepGame(game);
  expect(hall.queue[0]!.remaining).toBe(training - 1); expect(hall.researchQueue[0]!.remaining).toBe(researching - 1);
});
