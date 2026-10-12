import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { v9ChokeTowerPoint, v9FrontPoint } from '../policy/v9/front';
import { readV6Intel } from '../policy/v6/intel';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_knight'] as const).flatMap(version => (['grove', 'ember'] as const)
  .flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version keeps its $race holding front behind uncleared camps (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('bounded-front-road').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 1000).goldMine('main', x(716), 1000, 10000)
    .townHall('foe', x(3500), 1000);
  for (let i = 0; i < 2; i++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(700), 960 + i * 40, { id: `guard-${i}` });
  for (let i = 0; i < 12; i++) scene = scene.unit('foe', 'footman', x(3400 + i % 4 * 32), 900 + Math.floor(i / 4) * 40);
  for (let i = 0; i < 3; i++) scene = scene.unit('neutral', 'stonebackBrute', x(950 + i * 32), 1100);
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  const guards = game.units.filter(unit => unit.owner === 'us');
  const options = bootstrapPolicyContext(snapshotGame(game), 'us', version, { memory, teams: game.teams });
  const front = v9FrontPoint(snapshotGame(game), 'us', readV6Intel(snapshotGame(game), 'us', options));
  expect(Math.hypot(front.x - x(500), front.y - 1000)).toBeLessThanOrEqual(320);
  for (let tick = 0; tick < 1200; tick++) {
    if (tick % 15 === 0) sdk.issue(planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' }), {}, { checksum: false });
    stepGame(game);
  }
  expect(guards.every(unit => game.units.includes(unit) && unit.hp === unit.maxHp)).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.match.winner).toBeNull();
});

it.each(['grove', 'ember'] as const)('builds an ordinary paid %s choke tower on a direct road', race => {
  const game = sketchScene('bounded-choke-road').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 1000).townHall('foe', 3500, 1000).worker('us', 650, 1000, { id: 'builder' })
    .build().createGame();
  const snapshot = snapshotGame(game), intel = readV6Intel(snapshot, 'us', { teams: game.teams });
  const hall = snapshot.buildings.find(building => building.owner === 'us')!;
  const point = v9ChokeTowerPoint(snapshot, intel, hall)!;
  expect(point).toBeDefined();
  expect(Math.hypot(point.x - hall.x, point.y - hall.y)).toBeLessThanOrEqual(460 + 60);
  const sdk = new SdkCommandFrameRuntime(game);
  sdk.issue([{ playerId: 'us', scriptId: 'ordinary-choke-build', command: { type: 'build', unitId: 'builder', buildingKind: 'defenseTower', ...point } }], {}, { checksum: false });
  for (let tick = 0; tick < 1200; tick++) stepGame(game);
  expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'defenseTower' && building.complete)).toHaveLength(1);
  expect(game.match.stats.goldSpent.us).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
