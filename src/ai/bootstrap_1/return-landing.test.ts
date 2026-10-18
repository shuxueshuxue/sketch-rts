import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, issuePlayerCommand } from '../../shared/sim';
import { distanceToHull } from '../../shared/ship-geometry';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';
import { preventHullLanding } from './return-landing';

const shipId = 'unit-p0-transport-1068';
const unload = { type: 'unload' as const, unitIds: [shipId], x: 4496, y: 1200 };
function saved(name = 'blocked-return-landing-18600.json.gz') {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  return { game, options: { memory: frame.memories.p0, teams: game.teams } };
}
it('stops a return whose native landing would enter a neighboring hull without changing the snapshot', () => {
  const { game, options } = saved(), snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  expect(preventHullLanding(snapshot, 'p0', options, [unload])).toEqual([{ type: 'stop', unitIds: [shipId] }]);
  expect(JSON.stringify(snapshot)).toBe(before);
});
it('uses a native portrait landing outside the neighboring hull after stopping', () => {
  const { game, options } = saved(), gold = game.players.p0!.gold, count = game.units.length;
  for (const command of preventHullLanding(snapshotGame(game), 'p0', options, [unload])) issuePlayerCommand(game, 'p0', command);
  const commands = preventHullLanding(snapshotGame(game), 'p0', options, [unload]);
  const landing = commands.find(c => c.type === 'unloadPassenger');
  expect(landing?.type).toBe('unloadPassenger');
  if (landing?.type !== 'unloadPassenger') throw Error('missing native landing');
  expect(commands.filter(c => c.type === 'unloadPassenger')).toHaveLength(1);
  issuePlayerCommand(game, 'p0', landing);
  const passenger = game.units.find(u => u.id === landing.passengerId)!;
  expect(passenger.deck).toBeUndefined();
  for (const other of game.units.filter(u => u.sailing && u.id !== shipId)) expect(distanceToHull(other, passenger)).toBeGreaterThanOrEqual(passenger.radius + 1);
  expect(game.units).toHaveLength(count);
  expect(game.players.p0!.gold).toBe(gold);
});
it('preserves emergency helm control and non-helm settings', () => {
  const { game, options } = saved(), snapshot = snapshotGame(game);
  const move = { type: 'move' as const, unitIds: [shipId], x: 4800, y: 2000, avoidCombat: true };
  expect(preventHullLanding(snapshot, 'p0', options, [move])).toEqual([move]);
  const stance = { type: 'setStance' as const, unitIds: [shipId], stance: 'brace' as const };
  expect(preventHullLanding(snapshot, 'p0', options, [stance, unload])).toContainEqual(stance);
});
it('leaves a safe native return unchanged', () => {
  const { game, options } = saved('safe-colony-return-13470.json.gz');
  const command = { type: 'unload' as const, unitIds: ['unit-p0-transport-1070'], x: 4368, y: 6032, avoidCombat: true };
  expect(preventHullLanding(snapshotGame(game), 'p0', options, [command])).toEqual([command]);
});
it('does not take over outbound or evacuation missions', () => {
  const { game, options } = saved();
  options.memory.naval.ferries[shipId].phase = 'sailing';
  expect(preventHullLanding(snapshotGame(game), 'p0', options, [unload])).toEqual([unload]);
  options.memory.naval.ferries[shipId].phase = 'return';
  options.memory.naval.ferries[shipId].purpose = 'evacuate';
  expect(preventHullLanding(snapshotGame(game), 'p0', options, [unload])).toEqual([unload]);
});
it.each(BOOTSTRAP_VERSIONS)('%s retains the stop in its final command stream', version => {
  const { game, options } = saved();
  const commands = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory: options.memory }, { teams: game.teams }).map(e => e.command);
  const helm = commands.filter(c => 'unitIds' in c && c.unitIds.includes(shipId) && ['stop', 'unload', 'move'].includes(c.type));
  expect(helm).toEqual([{ type: 'stop', unitIds: [shipId] }]);
});
