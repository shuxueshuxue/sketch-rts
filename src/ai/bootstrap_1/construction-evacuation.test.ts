import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { keepMiningWork } from './construction-evacuation';

const builderId = 'unit-p0-worker-12838';
function input() {
  const f = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/construction-evacuation-47745.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, f.snapshot, f.nextId);
  return { game, memory: f.memories.p0 };
}
it.each(BOOTSTRAP_VERSIONS)('%s keeps the safe paid mining foundation builder while rescuing the threatened coast', version => {
  const { game, memory } = input(), snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  const boarders = entries.flatMap(e => e.command.type === 'board' ? e.command.unitIds : []);
  expect(boarders).not.toContain(builderId);
  expect(boarders).toContain('unit-p0-worker-2822');
  expect(memory.naval.ferries['unit-p0-carrier-3009'].crewIds).not.toContain(builderId);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it.each(['danger', 'finished', 'emptyMine', 'ordinaryRepair', 'otherMission'] as const)('does not reserve the construction worker for %s', reason => {
  const { game, memory } = input(), worker = game.units.find(u => u.id === builderId)!;
  const hall = game.buildings.find(b => b.id === 'building-p0-townHall-15371')!;
  const boat = game.units.find(u => u.id === 'unit-p0-carrier-3009')!;
  if (reason === 'danger') {
    const foe = game.units.find(u => u.id === 'unit-p1-sparkArcher-1176')!;
    Object.assign(foe, { x: worker.x + 200, y: worker.y });
  }
  if (reason === 'finished') hall.complete = true;
  if (reason === 'emptyMine') game.resources.forEach(m => { m.amount = 0; });
  if (reason === 'ordinaryRepair') worker.order = { type: 'idle' };
  if (reason === 'otherMission') memory.naval.ferries[boat.id].purpose = 'rebase';
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory, teams: game.teams });
  expect(keepMiningWork(snapshot, 'p0', options, worker, boat)).toBe(false);
});
