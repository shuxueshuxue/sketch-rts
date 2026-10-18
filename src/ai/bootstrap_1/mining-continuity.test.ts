import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { miningHandoff } from './mining-handoff';
import { keepMiningWork } from './construction-evacuation';

function input(name: string) {
  const f = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, f.snapshot, f.nextId);
  return { game, memory: f.memories.p0 };
}
it.each(BOOTSTRAP_VERSIONS)('%s hands the completed mining foundation to its adjacent mine before the claim is pruned', version => {
  const { game, memory } = input('mining-handoff-48180');
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries.find(e => e.scriptId === 'economy')?.command).toEqual({ type: 'mine', unitIds: ['unit-p0-worker-12838'], resourceId: 'gold-mainland-0' });
  expect(JSON.stringify(snapshot)).toBe(before);
});
it.each(BOOTSTRAP_VERSIONS)('%s moves the actual threatened miner and retains its mining job', version => {
  const { game, memory } = input('mining-unit-fire-66000');
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const worker = snapshot.units.find(u => u.id === 'unit-p0-worker-12909')!;
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  const commands = entries.filter(e => e.scriptId === 'miningJobSafety').map(e => e.command);
  const move = commands.find(c => c.type === 'move' && c.unitIds.includes(worker.id));
  expect(move).toMatchObject({ type: 'move', avoidCombat: true });
  if (move?.type === 'move') expect(Math.hypot(move.x - worker.x, move.y - worker.y)).toBeGreaterThan(1);
  expect(commands).toContainEqual({ type: 'mine', unitIds: [worker.id], resourceId: 'gold-mainland-2', queued: true });
  expect(JSON.stringify(snapshot)).toBe(before);
});
it('does not interrupt the same mining job after enemies and neutral guards are absent', () => {
  const { game, memory } = input('mining-unit-fire-66000');
  game.units = game.units.filter(u => u.owner === 'p0');
  game.buildings = game.buildings.filter(b => b.owner === 'p0');
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  expect(entries.some(e => e.scriptId === 'miningJobSafety' && 'unitIds' in e.command && e.command.unitIds.includes('unit-p0-worker-12909'))).toBe(false);
});
it('does not claim a worker already assigned to a ferry as an active miner', () => {
  const { game, memory } = input('mining-unit-fire-66000');
  const worker = game.units.find(u => u.id === 'unit-p0-worker-12909')!;
  worker.order = { type: 'board', transportId: 'unit-p0-carrier-3009' };
  memory.naval.ferries['unit-p0-carrier-3009'].crewIds.push(worker.id);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  expect(entries.some(e => e.scriptId === 'miningJobSafety' && 'unitIds' in e.command && e.command.unitIds.includes(worker.id))).toBe(false);
});

it.each(['expired', 'missing', 'incomplete'] as const)('does not invent a completed construction handoff for %s', reason => {
  const { game, memory } = input('mining-handoff-48180');
  if (reason === 'expired') memory.unitClaims['unit-p0-worker-12838'].expiresTick = game.tick - 1;
  if (reason === 'missing') delete memory.unitClaims['unit-p0-worker-12838'];
  if (reason === 'incomplete') game.buildings.find(b => b.id === 'building-p0-townHall-15371')!.complete = false;
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory, teams: game.teams });
  expect(miningHandoff(snapshot, 'p0', options)).toBeUndefined();
});
it('keeps a safe real mining job from a remote evacuation but releases it when danger arrives', () => {
  const { game, memory } = input('safe-mining-work-54000');
  const worker = game.units.find(u => u.id === 'unit-p0-worker-12838')!;
  const boat = game.units.find(u => u.id === 'unit-p0-carrier-3009')!;
  const options = bootstrapPolicyContext(snapshotGame(game), 'p0', 'v9_archer', { memory, teams: game.teams });
  expect(keepMiningWork(snapshotGame(game), 'p0', options, worker, boat)).toBe(false);
  memory.naval.ferries[boat.id].purpose = 'evacuate';
  expect(keepMiningWork(snapshotGame(game), 'p0', options, worker, boat)).toBe(true);
  const foe = game.units.find(u => u.id === 'unit-p1-sparkArcher-1176')!;
  Object.assign(foe, { x: worker.x + 200, y: worker.y });
  expect(keepMiningWork(snapshotGame(game), 'p0', options, worker, boat)).toBe(false);
});
