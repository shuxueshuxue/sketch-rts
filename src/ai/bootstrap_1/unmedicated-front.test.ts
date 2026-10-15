import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { runAiGameLoop } from '../game-runner';
import { createBootstrapCommandPlanner } from '../../../scripts/bootstrap_1-planner';
import { bootstrapGame, bootstrapMatches } from './benchmark';
import { mobileCare } from './mobile-care';
import { bootstrapPolicyContext } from './policy';

const versions = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
const patients = ['unit-p0-emberRavager-1069', 'unit-p0-emberRavager-1079'];
function field() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-tower-critical.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, saved, memory: saved.memories.p0 };
}

it.each(versions)('%s owns the real critical tower front without a medic and prevents renewed attack orders', version => {
  const { game, memory } = field(), snapshot = snapshotGame(game);
  const context = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams });
  const claimed = mobileCare.claimsUnits!(snapshot, 'p0', context);
  for (const id of patients) expect(claimed.has(id), id).toBe(true);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  for (const id of patients) {
    expect(entries.some(entry => entry.scriptId === 'mobileCare' && entry.command.type === 'move'
      && entry.command.avoidCombat && entry.command.unitIds.includes(id)), id).toBe(true);
    expect(entries.some(entry => ['attack', 'attackMove'].includes(entry.command.type)
      && 'unitIds' in entry.command && entry.command.unitIds.includes(id)), id).toBe(false);
  }
});

it.each(versions)('%s preserves the real camp survivor through the complete three-player opening attack', async version => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-first-expansion-attack.json.gz', import.meta.url))).toString());
  const match = bootstrapMatches(saved.setup.seed, ['greystonePass'], 7005, true).find(match => match.subject === version
    && match.side === 1 && match.agents.p0!.race === 'ember' && Object.values(match.agents).slice(1).map(agent => agent.version).join('+') === 'v8+v8')!;
  const game = bootstrapGame(match); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const memory = createAiMemoryProvider(structuredClone(saved.memories)), planner = await createBootstrapCommandPlanner(memory);
  runAiGameLoop({ ...match, game, commandPlanner: planner, maxTicks: 6885 });
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId,
    memories: Object.fromEntries(Object.keys(match.agents).map(owner => [owner, memory.get(owner)])) }));
  const restored = bootstrapGame(match); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId);
  const restoredMemory = createAiMemoryProvider(checkpoint.memories), restoredPlanner = await createBootstrapCommandPlanner(restoredMemory);
  runAiGameLoop({ ...match, game, commandPlanner: planner });
  runAiGameLoop({ ...match, game: restored, commandPlanner: restoredPlanner });
  const patient = game.units.find(unit => unit.id === 'unit-p0-emberRavager-1079')!;
  expect(patient).toBeDefined(); expect(patient.hp).toBe(22);
  expect(['attack', 'attackMove']).not.toContain(patient.order.type);
  expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
  for (const owner of Object.keys(match.agents)) expect(restoredMemory.get(owner)).toEqual(memory.get(owner));
}, 60000);

it.each(['mounted', 'raid', 'shop', 'claimed', 'boarding', 'queued', 'caster'] as const)('preserves the critical survivor assigned to %s', role => {
  const { game, memory } = field(), patient = game.units.find(unit => unit.id === patients[0])!;
  if (role === 'mounted') memory.mounted = [{ unitIds: [patient.id], objective: { kind: 'camp', ids: [] } }];
  else if (role === 'raid') memory.v6.raid = { unitIds: [patient.id], targetHallId: 'other-target', targetOwner: 'p2', reason: 'assigned', sinceTick: game.tick, phase: 'travel' };
  else if (role === 'shop') memory.shopping = { unitId: patient.id, shopId: 'shop-2', kind: 'guardianScroll', homeId: 'building-p0-townhall', returning: false };
  else if (role === 'claimed') memory.unitClaims[patient.id] = { kind: 'creep', targetId: 'other-camp', x: patient.x, y: patient.y, sinceTick: game.tick, expiresTick: game.tick + 1 };
  else if (role === 'boarding') patient.order = { type: 'board', transportId: 'assigned-ship' };
  else if (role === 'queued') patient.orderQueue = [{ type: 'move', x: 2000, y: 3000 }];
  else patient.kind = 'priest';
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory, teams: game.teams });
  expect(mobileCare.claimsUnits!(snapshot, 'p0', options).has(patient.id)).toBe(false);
});
