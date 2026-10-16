import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { createAiPolicyMemory } from '../memory';
import { bootstrapGame, bootstrapMatches } from './benchmark';
import { bootstrapPolicyContext } from './policy';
import { needsRemoteLaborInvestment, planMiningWorkforce, planMiningWorkforcePurchase } from './workforce';
import { longHaulInvestment } from './long-haul-investment';

function actual(tick: 27885 | 59400) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/remote-worker-capital-${tick}.json.gz`, import.meta.url))).toString());
  const match = bootstrapMatches(saved.setup.seed, [saved.setup.map], Number.MAX_SAFE_INTEGER, saved.setup.unseen)
    .find(m => m.subject === 'v9_archer' && m.side === 1 && m.agents.p0!.race === 'grove'
      && Object.values(m.agents).slice(1).map(a => a.version).join('+') === 'v8+v8')!;
  expect(match.agents).toEqual(saved.setup.agents);
  const game = bootstrapGame(match);
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  expect(snapshotGame(game)).toEqual(saved.snapshot);
  const snapshot = snapshotGame(game);
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  return { saved, game, snapshot };
}
const workerCommands = (entries: ReturnType<typeof planAiOwnerCommandEntries>) => entries
  .filter(entry => entry.command.type === 'train' && entry.command.unitKind === 'worker');

it('does not bypass the existing remote payback gate at actual27885 through either full P0 worker entry', () => {
  const { saved, game, snapshot } = actual(27885), before = JSON.stringify(snapshot);
  const context = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { teams: game.teams, memory: structuredClone(saved.memories.p0) });
  // The geometric vacancy remains real. It is not alone an investment decision.
  expect(planMiningWorkforce(snapshot, 'p0', 1, context)).toHaveLength(1);
  expect(longHaulInvestment(snapshot, 'p0', context, 1)).toEqual([]);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', source: 'external-agent' },
    { teams: game.teams, memoryProvider: createAiMemoryProvider(structuredClone(saved.memories)) });
  expect(workerCommands(entries)).toEqual([]);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(game.players.p0!.gold).toBe(84.95);
});

it('buys the one profitable actual59400 recruit once, with one real native payment', () => {
  const { saved, game, snapshot } = actual(59400);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', source: 'external-agent' },
    { teams: game.teams, memoryProvider: createAiMemoryProvider(structuredClone(saved.memories)) });
  const workers = workerCommands(entries);
  expect(workers).toHaveLength(1);
  expect(workers[0]!.scriptId).toBe('miningWorkforce');
  const spent = game.match.stats.goldSpent.p0!;
  issuePlayerCommand(game, 'p0', workers[0]!.command);
  expect(game.players.p0!.gold).toBeCloseTo(1.95, 8);
  expect(game.match.stats.goldSpent.p0! - spent).toBe(75);
  expect(game.buildings.find(b => b.id === 'building-p0-townhall')!.queue).toMatchObject([{ unitKind: 'worker', paidGold: 75 }]);
});

function remote(version: 'v9_archer' | 'v9_summoner' | 'v9_knight', race: 'grove' | 'ember', condition: 'tower' | 'ally' | 'capital' | 'depleted') {
  let scene = sketchScene('full-remote-workforce-capital').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).playerState('us', { gold: condition === 'capital' ? 400 : 105 })
    .player('foe', { team: 'b' }).player('ally', { team: 'a' })
    .townHall('us', 500, 500).goldMine('spent', 788, 500, 0)
    .townHall('foe', 3500, 3500).worker('foe', 3500, 3400)
    .townHall('ally', 3500, 500).worker('ally', 3500, 400)
    .goldMine('remote', 2300, 1200, condition === 'depleted' ? 100 : 6000).farms('us', 2, 400, 2000);
  for (let i = 0; i < 2; i++) scene = scene.worker('us', 2300, 1180 + i * 20,
    { id: `hauler-${i}`, order: { type: 'mine', resourceId: 'remote', phase: 'toMine', timer: 0 } });
  if (condition === 'tower') scene = scene.tower('foe', 2300, 1300);
  if (condition === 'ally') scene = scene.worker('ally', 2300, 1200,
    { order: { type: 'mine', resourceId: 'remote', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const b of game.buildings) Object.assign(b, snapToFootprint(game.map, b.radius, b));
  setBuildingBodies(game.map, game.buildings);
  const snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  return { game, snapshot, context: bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }) };
}

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => (['tower', 'ally', 'capital', 'depleted'] as const).map(condition => ({ version, race, condition }))))) (
  '$version $race keeps $condition remote worker rejection through the complete P0 stack', ({ version, race, condition }) => {
    const { game, snapshot } = remote(version, race, condition);
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'us', version }, { teams: game.teams, memory: createAiPolicyMemory() });
    expect(workerCommands(entries)).toEqual([]);
  });

it.each([true, false])('keeps existing remaining-mine hall staffing while complete=%s', complete => {
  const { game, context } = remote('v9_archer', 'grove', 'capital');
  const hall = game.buildings.find(b => b.owner === 'us' && b.kind === 'townHall')!;
  hall.x = 2032; hall.y = 1200; hall.complete = complete;
  const snapshot = snapshotGame(game);
  setBuildingBodies(snapshot.map, snapshot.buildings);
  expect(needsRemoteLaborInvestment(snapshot, 'us', 1)).toBe(false);
  expect(planMiningWorkforcePurchase(snapshot, 'us', 1, context)).toEqual(planMiningWorkforce(snapshot, 'us', 1, context));
});

it('keeps the first construction worker funded rather than requiring an existing remote lane', () => {
  const { game, context } = remote('v9_archer', 'grove', 'capital');
  game.units = game.units.filter(u => u.owner !== 'us');
  const snapshot = snapshotGame(game);
  expect(planMiningWorkforcePurchase(snapshot, 'us', 1, context)).toEqual([
    { type: 'train', buildingId: snapshot.buildings.find(b => b.owner === 'us' && b.kind === 'townHall')!.id, unitKind: 'worker' },
  ]);
});

it('retains the full runner unpaid hall commitment before considering another workforce purchase', () => {
  const { game } = remote('v9_archer', 'grove', 'capital');
  issuePlayerCommand(game, 'us', { type: 'build', unitId: 'hauler-0', buildingKind: 'townHall', x: 2128, y: 1040 });
  // Public build admission needs 400 at issue, but the walking intent is unpaid.
  // Another already accepted purchase can leave less than that commitment.
  expect(game.players.us!.gold).toBe(400);
  game.players.us!.gold = 105;
  const snapshot = snapshotGame(game);
  expect(snapshot.units.some(u => u.id === 'hauler-0' && u.order.type === 'build')).toBe(true);
  expect(BUILDING_DEFS.townHall.cost).toBeGreaterThan(snapshot.players.us!.gold);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'us', version: 'v9_archer' }, { teams: game.teams, memory: createAiPolicyMemory() });
  expect(workerCommands(entries)).toEqual([]);
  expect(game.players.us!.gold).toBe(105);
  expect(UNIT_DEFS.worker.cost).toBe(75);
});
