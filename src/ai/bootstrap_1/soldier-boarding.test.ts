import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';
import { passengerBoardingSafe } from './worker-boarding';
import { safeSoldierBoarding } from './soldier-boarding';

const soldierId = 'unit-p0-footman-3980', boatId = 'unit-p0-transport-1067';
function saved(tick = 23385) {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/soldier-boarding-${tick}.json.gz`, import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  return { snapshot: snapshotGame(game), options: { memory: frame.memories.p0, teams: game.teams } };
}
it('rejects the actual full-health soldier road through neutral caster coverage', () => {
  const { snapshot, options } = saved(), before = JSON.stringify(snapshot);
  const soldier = snapshot.units.find(u => u.id === soldierId)!, boat = snapshot.units.find(u => u.id === boatId)!;
  expect(soldier.hp).toBe(soldier.maxHp);
  expect(passengerBoardingSafe(snapshot, 'p0', options, soldier, boat)).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(before);
});
it('drops the unsafe request and its crew reservation without altering a safe worker command', () => {
  const { snapshot, options } = saved();
  options.memory.naval.ferries[boatId].crewIds.push(soldierId);
  const worker = snapshot.units.find(u => u.owner === 'p0' && u.kind === 'worker')!;
  const workerCommand = { type: 'board' as const, unitIds: [worker.id], transportId: boatId };
  const commands = safeSoldierBoarding(snapshot, 'p0', options, [workerCommand, { type: 'board', unitIds: [soldierId], transportId: boatId }]);
  expect(commands).toContainEqual(workerCommand);
  expect(commands.some(c => c.type === 'board' && c.unitIds.includes(soldierId))).toBe(false);
  expect(options.memory.naval.ferries[boatId].crewIds).not.toContain(soldierId);
});
it('cancels an already unsafe walk, but preserves a recovery move', () => {
  const { snapshot, options } = saved(23400);
  expect(snapshot.units.find(u => u.id === soldierId)!.order.type).toBe('board');
  expect(safeSoldierBoarding(snapshot, 'p0', options, [])).toContainEqual({ type: 'stop', unitIds: [soldierId] });
  const retreat = { type: 'move' as const, unitIds: [soldierId], x: 4022, y: 3182, avoidCombat: true };
  const commands = safeSoldierBoarding(snapshot, 'p0', options, [retreat]);
  expect(commands).toContainEqual(retreat);
  expect(commands.some(c => c.type === 'stop' && c.unitIds.includes(soldierId))).toBe(false);
});
it.each(BOOTSTRAP_VERSIONS)('%s does not publish the unsafe soldier boarding order', version => {
  const { snapshot, options } = saved(), before = JSON.stringify(snapshot);
  const commands = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: options.memory }, { teams: options.teams }).map(e => e.command);
  expect(commands.some(c => c.type === 'board' && c.unitIds.includes(soldierId))).toBe(false);
  expect(options.memory.naval.ferries[boatId].crewIds).not.toContain(soldierId);
  expect(JSON.stringify(snapshot)).toBe(before);
});
