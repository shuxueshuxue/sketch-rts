import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { createStrategyAllocationMemory } from './control';
import { recordIncumbentCommands } from './incumbent-evidence';
import { incumbentCommandActor } from './incumbent-command-source';
import { importExecutedIncumbents, continuesImportedProgress } from './incumbent-import';
import { evaluateSituation } from './situation';

type Frame = { snapshot: GameSnapshot; owner: string; version: BootstrapAiVersion;
  memory: AiPolicyMemory; nextId: number; activePlayers: string[] };

it('imports only the actual ferry producer after its accepted order advances in the native world', () => {
  const frame: Frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/e01-before-ferry.json.gz', import.meta.url))).toString());
  const entries = planAiOwnerCommandEntries(frame.snapshot, { playerId: frame.owner, version: frame.version, memory: frame.memory });
  const boarding = entries.find(entry => entry.command.type === 'board')!;
  expect(incumbentCommandActor(boarding.command)).toEqual({ source: 'naval.ferries', taskId: 'ferry:unit-p0-transport-1665:8190' });
  let sequence = 0, authority = createStrategyAllocationMemory(frame.owner, frame.snapshot.tick);
  for (const entry of entries) authority = recordIncumbentCommands(authority, frame.snapshot, entry.scriptId, [entry.command], () => `accepted:${sequence++}`);
  const before = importExecutedIncumbents(frame.snapshot, frame.memory,
    evaluateSituation(frame.snapshot, frame.owner, frame.memory), authority);
  expect(Object.keys(before.leases)).toEqual([]);
  expect(Object.values(before.incumbentOrders).every(receipt => receipt.observedOrder === null)).toBe(true);

  const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId); game.activePlayers = [...frame.activePlayers];
  issueCommandFrame(game, entries);
  for (let tick = 0; tick < 15; tick++) stepGame(game);
  const snapshot = snapshotGame(game), adopted = importExecutedIncumbents(snapshot, frame.memory,
    evaluateSituation(snapshot, frame.owner, frame.memory), before);
  expect(Object.keys(adopted.leases)).toHaveLength(8);
  expect(Object.values(adopted.leases).every(lease => lease.origin === 'imported-task')).toBe(true);
  expect(Object.values(adopted.incumbentOrders).every(receipt => receipt.observedTick === snapshot.tick)).toBe(true);
  expect(Object.values(adopted.objectives).every(objective => objective.committedUtilityGold === null)).toBe(true);
  const importedId = Object.values(adopted.leases)[0]!.objectiveId;
  const ferry = Object.values(frame.memory.naval!.ferries!)[0]!;
  const sameGoal = { owner: frame.owner, effects: [{ kind: 'mining-established' as const, mineId: ferry.targetId,
    completeHall: true as const, garrisonHandoff: true as const }] };
  const immutable = JSON.stringify([snapshot, frame.memory, adopted]);
  expect(continuesImportedProgress(snapshot, frame.memory, adopted, importedId, sameGoal)).toBe(true);
  expect(continuesImportedProgress(snapshot, frame.memory, adopted, importedId,
    { ...sameGoal, owner: 'other-owner' })).toBe(false);
  expect(continuesImportedProgress(snapshot, frame.memory, adopted, importedId,
    { owner: frame.owner, effects: [{ ...sameGoal.effects[0]!, mineId: 'another-mine' }] })).toBe(false);
  expect(continuesImportedProgress(snapshot, frame.memory, adopted, importedId,
    { owner: frame.owner, effects: [{ kind: 'entity-destroyed', entityId: ferry.targetId }] })).toBe(false);
  const formal = { ...adopted, leases: Object.fromEntries(Object.entries(adopted.leases).map(([key, lease]) =>
    [key, { ...lease, origin: 'allocator' as const }])) };
  expect(continuesImportedProgress(snapshot, frame.memory, formal, importedId, sameGoal)).toBe(false);
  expect(JSON.stringify([snapshot, frame.memory, adopted])).toBe(immutable);
  const restored: typeof adopted = JSON.parse(JSON.stringify(adopted));
  expect(importExecutedIncumbents(snapshot, frame.memory, evaluateSituation(snapshot, frame.owner, frame.memory), restored)).toEqual(adopted);
  // Reconsidering an unpriced incumbent can rebuild its leases within the
  // same owner epoch. The unchanged native order still has one adoption.
  const reconsidered = importExecutedIncumbents(snapshot, frame.memory, evaluateSituation(snapshot, frame.owner, frame.memory),
    { ...restored, leases: {}, assignments: {} });
  expect(reconsidered.leases).toEqual(adopted.leases);
  expect(reconsidered.events).toEqual(adopted.events);
  expect(reconsidered.nextEventSequence).toBe(adopted.nextEventSequence);

  const canceled = structuredClone(snapshot), rider = canceled.units.find(unit => unit.id === 'unit-p0-worker-2')!;
  rider.order = { type: 'idle' }; canceled.tick++;
  const released = importExecutedIncumbents(canceled, frame.memory, evaluateSituation(canceled, frame.owner, frame.memory), adopted);
  expect(released.leases[`unit:${rider.id}`]).toBeUndefined();
  expect(released.incumbentOrders[rider.id]).toBeUndefined();
  expect(Object.keys(released.leases)).toHaveLength(7);
}, 60000);

it('adopts a real general defense receipt without requiring a fabricated membership claim', () => {
  const saved: { snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>; nextId: number; activePlayers: string[] }
    = JSON.parse(readFileSync(new URL('../bootstrap_1/fixtures/defense-rally-14m48.json', import.meta.url), 'utf8'));
  const owner = 'v9_archer', policy = saved.memories[owner]!;
  const entries = planAiOwnerCommandEntries(saved.snapshot, { playerId: owner, version: 'v9_archer', memory: policy });
  const defense = entries.filter(entry => incumbentCommandActor(entry.command)?.source === 'miningDefense');
  expect(defense).toHaveLength(2);
  let sequence = 0, authority = createStrategyAllocationMemory(owner, saved.snapshot.tick);
  for (const entry of defense) authority = recordIncumbentCommands(authority, saved.snapshot, entry.scriptId,
    [entry.command], () => `general-accepted:${sequence++}`);
  for (const id of Object.keys(authority.incumbentOrders)) delete policy.unitClaims[id];
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId); game.activePlayers = [...saved.activePlayers];
  issueCommandFrame(game, entries);
  for (let tick = 0; tick < 15; tick++) stepGame(game);
  const snapshot = snapshotGame(game), adopted = importExecutedIncumbents(snapshot, policy, evaluateSituation(snapshot, owner, policy), authority);
  const leases = Object.values(adopted.leases);
  expect(leases.length).toBeGreaterThan(0);
  expect(leases.every(lease => lease.incumbentTask?.source === 'miningDefense'
    && lease.incumbentTask.taskId === 'building-v9_archer-townHall-1602')).toBe(true);
  for (const lease of leases) {
    const id = lease.resourceKey.slice(5);
    expect(policy.unitClaims[id]).toBeUndefined();
    expect(adopted.incumbentOrders[id]).toMatchObject({ observedTick: snapshot.tick, executor: 'v6General' });
  }
  expect(Object.values(adopted.objectives).every(objective => objective.committedUtilityGold === null)).toBe(true);
}, 60000);
