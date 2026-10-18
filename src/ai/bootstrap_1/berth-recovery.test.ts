import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { bootstrapPolicyContext } from './policy';
import { recoverBerth } from './berth-recovery';
import type { GameCommand } from '../../shared/types';

function field(rename = false) {
  let text = gunzipSync(readFileSync(new URL('./fixtures/knight-blocked-return.json.gz', import.meta.url))).toString();
  if (rename) text = text.replaceAll('unit-p0-', 'renamed-vessel-or-person-').replaceAll('building-p0-', 'renamed-base-');
  const saved = JSON.parse(text), game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, snapshot: snapshotGame(game), memory: saved.memories.p0 };
}

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s discovers a blocked return from real geometry even after all owned IDs change', version => {
  const { snapshot, memory } = field(true);
  const before = JSON.stringify(snapshot);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: snapshot.teams ?? {} });
  const commands = recoverBerth(snapshot, 'p0', options, []);
  expect(memory.berthRecovery.crewIds).toHaveLength(10);
  expect(memory.berthRecovery.carrierId.startsWith('renamed-')).toBe(true);
  expect(commands.some(command => command.type === 'move' && command.unitIds.includes(memory.berthRecovery.carrierId) && command.avoidCombat)).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('preserves unrelated members of a command and prevents new recruitment during egress', () => {
  const { snapshot, memory } = field();
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory, teams: snapshot.teams ?? {} });
  recoverBerth(snapshot, 'p0', options, []);
  const task = memory.berthRecovery;
  const outsider = snapshot.units.find(unit => unit.owner === 'p0' && unit.kind === 'worker' && !task.crewIds.includes(unit.id))!;
  const commands: GameCommand[] = [{ type: 'move', unitIds: [task.crewIds[0], outsider.id], x: 100, y: 100 },
    { type: 'board', unitIds: [outsider.id], transportId: task.carrierId }];
  const result = recoverBerth(snapshot, 'p0', options, commands);
  expect(result).toContainEqual({ type: 'move', unitIds: [outsider.id], x: 100, y: 100 });
  expect(result.some(command => command.type === 'board')).toBe(false);
});

it.each(['ship lost', 'base lost', 'timeout', 'emergency retreat'] as const)('releases ownership on %s instead of waiting forever', reason => {
  const { snapshot, memory } = field();
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory, teams: snapshot.teams ?? {} });
  recoverBerth(snapshot, 'p0', options, []);
  const task = memory.berthRecovery;
  if (reason === 'ship lost') snapshot.units = snapshot.units.filter(unit => unit.id !== task.carrierId);
  if (reason === 'base lost') snapshot.buildings = snapshot.buildings.filter(building => building.id !== task.hallId);
  if (reason === 'timeout') snapshot.tick += 3601;
  if (reason === 'emergency retreat') memory.naval.coastalRetreat = { [task.carrierId]: { x: 100, y: 100 } };
  const planned: GameCommand[] = [{ type: 'move', unitIds: [task.blockerId], x: 100, y: 100, avoidCombat: true }];
  expect(recoverBerth(snapshot, 'p0', options, planned)).toEqual(expect.arrayContaining(planned));
  expect(memory.berthRecovery).toBeUndefined();
  expect(memory.berthRetryUntil).toBeGreaterThan(snapshot.tick);
});

it('cancels an old ship queue when timeout has no replacement order', () => {
  const { snapshot, memory } = field();
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory, teams: snapshot.teams ?? {} });
  recoverBerth(snapshot, 'p0', options, []);
  const ship = snapshot.units.find(unit => unit.id === memory.berthRecovery.carrierId)!;
  ship.order = { type: 'move', x: 100, y: 100, avoidCombat: true };
  ship.orderQueue = [{ type: 'move', x: 200, y: 200 }];
  snapshot.tick += 3601;
  expect(recoverBerth(snapshot, 'p0', options, []).some(command => command.type === 'stop' && command.unitIds.includes(ship.id))).toBe(true);
  expect(memory.berthRecovery).toBeUndefined();
});
