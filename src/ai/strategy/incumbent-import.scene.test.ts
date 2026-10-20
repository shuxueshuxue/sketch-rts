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
import { importExecutedIncumbents } from './incumbent-import';
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
  const restored: typeof adopted = JSON.parse(JSON.stringify(adopted));
  expect(importExecutedIncumbents(snapshot, frame.memory, evaluateSituation(snapshot, frame.owner, frame.memory), restored)).toEqual(adopted);

  const canceled = structuredClone(snapshot), rider = canceled.units.find(unit => unit.id === 'unit-p0-worker-2')!;
  rider.order = { type: 'idle' }; canceled.tick++;
  const released = importExecutedIncumbents(canceled, frame.memory, evaluateSituation(canceled, frame.owner, frame.memory), adopted);
  expect(released.leases[`unit:${rider.id}`]).toBeUndefined();
  expect(released.incumbentOrders[rider.id]).toBeUndefined();
  expect(Object.keys(released.leases)).toHaveLength(7);
}, 60000);
