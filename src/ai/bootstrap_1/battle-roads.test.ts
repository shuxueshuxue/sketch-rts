import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { routeArrivals } from '../../shared/route-selection';
import { strikeGap } from '../../shared/combat-geometry';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function field(race: 'grove' | 'ember', mirror: boolean, detour: 'us' | 'foe', ranged = false) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('battle-arrivals-around-wall').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .player('other', { race: 'grove', team: 'b' })
    .townHall('us', x(detour === 'us' ? 500 : 3500), 3500)
    .goldMine('main', x(detour === 'us' ? 716 : 3284), 3500, 10000)
    .townHall('foe', x(detour === 'us' ? 3700 : 500), 3500)
    .tower('foe', x(detour === 'us' ? 3700 : 500), 3300)
    .townHall('other', x(detour === 'us' ? 3750 : 750), detour === 'us' ? 3000 : 3500)
    .tower('other', x(detour === 'us' ? 3750 : 750), detour === 'us' ? 2800 : 3300)
    .townHall('foe', x(ranged ? 2960 : 3000), 1000, { id: 'target-hall' });
  for (let i = 0; i < 4; i++) scene = scene.unit('us', race === 'grove' ? 'knight' : 'ashChieftain',
    x(detour === 'us' ? 2300 : 3900), 1000 + i * 35, { id: `soldier-${i}` });
  for (let i = 0; i < 10; i++) scene = scene.unit(i % 2 ? 'other' : 'foe', ranged ? 'archer' : 'knight',
    x(ranged ? 2610 : detour === 'us' ? 3200 : 2400),
    (detour === 'us' ? 2300 : 1000) + i * (ranged ? 10 : 20), { id: `defender-${i}` });
  if (ranged) scene = scene.worker('us', x(2912), 1000, { id: 'range-probe' });
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) =>
    i % 128 === (mirror ? 44 : 83) && Math.floor(i / 128) < 110 ? 'T' : '.').join('') };
  return game;
}

it.each(cases)('$version keeps its $race soldiers when the farther enemy arrives first by road (mirror=$mirror)',
  ({ version, race, mirror }) => {
  const game = field(race, mirror, 'us'), memory = createAiPolicyMemory();
  const target = game.buildings.find(b => b.id === 'target-hall')!;
  const own = game.units.filter(u => u.owner === 'us'), foe = game.units.filter(u => u.owner !== 'us');
  const ourArrival = routeArrivals(game.map, own, target, 'land').at(-1)!.ticks;
  expect(routeArrivals(game.map, foe, target, 'land').at(-1)!.ticks).toBeLessThan(ourArrival);
  expect(Math.hypot(foe[0]!.x - target.x, foe[0]!.y - target.y)).toBeGreaterThan(Math.hypot(own[0]!.x - target.x, own[0]!.y - target.y));
  for (const owner of ['foe', 'other']) issuePlayerCommand(game, owner,
    { type: 'move', unitIds: foe.filter(u => u.owner === owner).map(u => u.id), x: target.x, y: target.y });
  const first = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' });
  expect(memory.v6!.general!.mode).toBe('hold');
  issueCommandFrame(game, first);
  for (let tick = 0; tick < 1200; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' }));
    stepGame(game);
  }
  expect(game.units.filter(u => u.owner === 'us')).toHaveLength(4);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});

it.each(cases)('$version takes the exposed hall before the near $race enemy can detour to it (mirror=$mirror)',
  ({ version, race, mirror }) => {
  const game = field(race, mirror, 'foe'), memory = createAiPolicyMemory();
  const target = game.buildings.find(b => b.id === 'target-hall')!;
  const own = game.units.filter(u => u.owner === 'us'), foe = game.units.filter(u => u.owner !== 'us');
  expect(routeArrivals(game.map, foe, target, 'land')[0]!.ticks).toBeGreaterThan(routeArrivals(game.map, own, target, 'land').at(-1)!.ticks);
  expect(Math.hypot(foe[0]!.x - target.x, foe[0]!.y - target.y)).toBeLessThan(Math.hypot(own[0]!.x - target.x, own[0]!.y - target.y));
  const first = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' });
  expect(memory.v6!.general!.mode).toBe('attack');
  expect(memory.v6!.general!.targetHallId).toBe('target-hall');
  issueCommandFrame(game, first);
  for (let tick = 0; tick < 900 && game.buildings.includes(target); tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' }));
    stepGame(game);
  }
  expect(game.buildings.some(b => b.id === target.id)).toBe(false);
  expect(game.units.filter(u => u.owner === 'us')).toHaveLength(4);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});

it.each(cases)('$version still counts direct $race ranged fire across an unwalked wall (mirror=$mirror)',
  ({ version, race, mirror }) => {
  const game = field(race, mirror, 'foe', true), memory = createAiPolicyMemory();
  const target = game.buildings.find(b => b.id === 'target-hall')!;
  const shooters = game.units.filter(u => u.owner !== 'us');
  expect(shooters.every(u => strikeGap(u, target) <= u.attackRange)).toBe(true);
  planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' });
  expect(memory.v6!.general!.mode).toBe('hold');
  const probe = game.units.find(u => u.id === 'range-probe')!;
  for (const owner of ['foe', 'other']) issuePlayerCommand(game, owner,
    { type: 'attack', unitIds: shooters.filter(u => u.owner === owner).map(u => u.id), targetId: probe.id });
  for (let tick = 0; tick < 200 && probe.hp === probe.maxHp; tick++) stepGame(game);
  expect(probe.hp).toBeLessThan(probe.maxHp);
});
