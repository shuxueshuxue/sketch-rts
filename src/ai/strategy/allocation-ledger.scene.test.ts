import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { GameSnapshot } from '../../shared/types';
import type { AllocationPayment, CommandAdmission, ExecutableMethod, ExecutionAction } from './allocation-types';
import { applyAllocationPayments, recordAllocationCommands, reserveAllocationSpends, reservedAllocationGold } from './allocation-ledger';
import { assertStrategyAllocationBounds, createStrategyAllocationMemory } from './control';

type Frame = { snapshot: GameSnapshot; owner: string; nextId: number; activePlayers: string[] };
const frame: Frame = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
  .frames['Ne-sapphireArchipelago-player-4-17991'];
const objectiveId = 'ConquerIsland:Ne', methodId = `${objectiveId}/staged`, target = { point: { x: 0, y: 0 } };
const training: ExecutionAction = { token: { actionId: `${methodId}/train`, generation: 1 }, objectiveId, methodId,
  executor: 'strategy.train-transport', intent: { kind: 'train-transport' }, target, dependsOn: [], completionEffects: [],
  status: 'ready', phase: 'ready', state: {}, sinceTick: frame.snapshot.tick, lastProgressTick: frame.snapshot.tick };
const wait: ExecutionAction = { ...training, token: { actionId: `${methodId}/wait-hall`, generation: 2 },
  executor: 'strategy.wait-income', intent: { kind: 'wait-income' }, dependsOn: [training.token.actionId], status: 'waiting' };
const construction: ExecutionAction = { ...training, token: { actionId: `${methodId}/build-hall`, generation: 3 },
  executor: 'strategy.build-hall', intent: { kind: 'build-hall' }, dependsOn: [wait.token.actionId], status: 'waiting' };
const method: ExecutableMethod = { id: methodId, objectiveId, kind: 'staged-beachhead', providerId: 'test', preference: 0,
  status: 'candidate', demands: [], preconditions: [], subgoals: [], estimatedTicks: null, reasons: [],
  spends: [{ spendId: 'one-transport', amountGold: 240, includedUtilityTermCodes: ['transport-capital'], externalReservationIds: [] },
    { spendId: 'one-hall', amountGold: 400, includedUtilityTermCodes: ['hall-after-clear'], externalReservationIds: [] }],
  actions: [training, wait, construction].map(action => ({ id: action.token.actionId, executor: action.executor, intent: action.intent,
    target, dependsOn: action.dependsOn, demands: [], spendIds: [action === training ? 'one-transport' : 'one-hall'], completionEffects: [] })) };
function authority() { return { ...createStrategyAllocationMemory(frame.owner, frame.snapshot.tick), revision: 1,
  executions: Object.fromEntries([training, wait, construction].map(action => [action.token.actionId, action])) }; }
const admission: CommandAdmission = { commandId: 'accepted-Ne-transport', source: 'executor', executor: training.executor,
  action: training.token, allocationRevision: 1, purpose: 'task', command: { type: 'train', buildingId: 'building-player-4-shipyard-1410', unitKind: 'transport' },
  status: 'accepted', admittedTick: frame.snapshot.tick, queuedTick: frame.snapshot.tick };
function reserved() { return reserveAllocationSpends({ memory: authority(), method, actions: [training, wait, construction],
  cashGold: frame.snapshot.players[frame.owner]!.gold, tick: frame.snapshot.tick }).memory; }

describe('staged capital in the real N(e) conquest frame', () => {
  it('buys the affordable first boat without demanding the later hall capital up front', () => {
    expect(Math.floor(frame.snapshot.players[frame.owner]!.gold)).toBe(424);
    const memory = reserved();
    expect(reservedAllocationGold(memory)).toBe(240);
    expect(Object.keys(memory.budgets)).toEqual(['budget:one-transport']);
    // A later wait-income stage owns only the cash that actually exists. Its
    // duplicate hall/build demand cannot reserve a second 400 gold.
    const next = reserveAllocationSpends({ memory: { ...memory, budgets: { 'budget:one-transport':
      { ...memory.budgets['budget:one-transport']!, paidGold: 240, state: 'spent' } } }, method,
      actions: [{ ...training, status: 'complete' }, { ...wait, status: 'ready' }, construction], cashGold: 184, tick: frame.snapshot.tick + 15 });
    expect(next.memory.budgets['budget:one-hall']?.amountGold).toBe(184);
    expect(next.unmet[0]?.demand).toEqual({ kind: 'gold', amount: 216 });
    expect(reservedAllocationGold(next.memory)).toBe(184);
    expect(assertStrategyAllocationBounds(next.memory)).toBeLessThan(256 * 1024);
  });

  it('does not mark accepted production paid until the native world contains its new queue entry', () => {
    const memory = recordAllocationCommands(reserved(), frame.snapshot, [admission]);
    const proof: AllocationPayment = { budgetId: 'budget:one-transport', amountGold: 240,
      proof: { kind: 'production', buildingId: 'building-player-4-shipyard-1410', jobId: null,
        acceptedCommandId: admission.commandId, unitKind: 'transport', queueIndex: 0 } };
    expect(memory.budgets[proof.budgetId]?.paidGold).toBe(0);
    expect(() => applyAllocationPayments(memory, frame.snapshot, training.token, [proof])).toThrow(/not proven/);
    const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
    restoreSnapshotIntoGame(game, structuredClone(frame.snapshot), frame.nextId);
    game.activePlayers = [...frame.activePlayers];
    issueCommandFrame(game, [{ command: admission.command, playerId: frame.owner, scriptId: training.executor }]);
    const snapshot = snapshotGame(game), yard = snapshot.buildings.find(building => building.id === 'building-player-4-shipyard-1410')!;
    const paid = { ...proof, proof: { ...proof.proof, jobId: yard.queue[0]!.id ?? null } } as AllocationPayment;
    const result = applyAllocationPayments(memory, snapshot, training.token, [paid]);
    expect(result.budgets[proof.budgetId]).toMatchObject({ paidGold: 240, state: 'spent' });
    expect(applyAllocationPayments(result, snapshot, training.token, [paid])).toEqual(result);
    expect(applyAllocationPayments(JSON.parse(JSON.stringify(memory)), JSON.parse(JSON.stringify(snapshot)), training.token, [paid])).toEqual(result);
    // The same already-existing queue cannot justify payment for a later order.
    const next = recordAllocationCommands(reserved(), snapshot, [{ ...admission, commandId: 'second-order' }]);
    expect(() => applyAllocationPayments(next, snapshot, training.token,
      [{ ...paid, proof: { ...paid.proof, acceptedCommandId: 'second-order' } }])).toThrow(/not proven/);
  });
});
