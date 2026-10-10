import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BUILDING_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { miningHallSite } from '../../shared/mining-site';
import { routeTravelTicks } from '../../shared/route-selection';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { colonyNavalWant } from '../policy/naval';
import { bootstrapPolicyContext } from './policy';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version chooses the $race island builder with the shorter road (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const producer = race === 'grove' ? 'barracks' : 'emberForge';
  const troop = race === 'grove' ? 'footman' : 'emberRavager';
  let scene = sketchScene('island-construction-road').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(500 + GOLD_MINE_RULES.mainDistance), 500, 6000)
    .townHall('us', x(2900), 3000).goldMine('colony', x(2900 + GOLD_MINE_RULES.mainDistance), 3000, 6000)
    .building('us', producer, x(3200), 3000).tower('us', x(2900), 3300)
    .goldMine('free', x(3000), 1350, 6000).townHall('foe', x(500), 3500)
    .farms('us', 4, x(200), 2700)
    .worker('us', x(3000), 2000, { id: 'near-across-wall' })
    .worker('us', x(3700), 1000, { id: 'road-builder' });
  for (let index = 0; index < 8; index++) scene = scene.unit('us', troop, x(3200 + index % 4 * 45), 3300 + Math.floor(index / 4) * 45, { id: `garrison-${index}` });
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128, row = Math.floor(index / 128);
    return col < 25 ? '.' : col < 76 ? '~' : row === 53 && col < 124 ? 'T' : '.';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.id.startsWith('garrison-')).map(unit => unit.id) });
  const mine = game.resources.find(resource => resource.id === 'free')!, site = miningHallSite(snapshotGame(game), mine)!;
  const near = game.units.find(unit => unit.id === 'near-across-wall')!, road = game.units.find(unit => unit.id === 'road-builder')!;
  Object.assign(near, { x: site.x, y: site.y + 640 });
  Object.assign(road, { x: site.x + (mirror ? -650 : 650), y: site.y - 300 });
  expect(sameGround(game.map, near, site)).toBe(true);
  expect(sameGround(game.map, road, site)).toBe(true);
  expect(Math.hypot(near.x - site.x, near.y - site.y)).toBeLessThan(Math.hypot(road.x - site.x, road.y - site.y));
  expect(routeTravelTicks(game.map, near, site, 'land', near.speed)!).toBeGreaterThan(routeTravelTicks(game.map, road, site, 'land', road.speed)!);
  expect(routeTravelTicks(game.map, road, site, 'land', road.speed)!).toBeLessThan(1200 - BUILDING_DEFS.townHall.buildTime);
  const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory: createAiPolicyMemory(), teams: game.teams });
  const want = colonyNavalWant(snapshot, 'us', context)!;
  expect(want.id).toBe('naval:islandHall');
  const command = want.issue(new Set())!;
  expect(command).toMatchObject({ type: 'build', unitId: 'road-builder', buildingKind: 'townHall' });
  issueCommandFrame(game, [{ playerId: 'us', scriptId: 'island-construction-road', command }]);
  let paid = false;
  for (let tick = 0; tick < 1200; tick++) {
    stepGame(game);
    if (!paid && game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall' && Math.hypot(building.x - mine.x, building.y - mine.y) <= GOLD_MINE_RULES.baseRange)) {
      expect(game.match.stats.goldSpent.us).toBe(BUILDING_DEFS.townHall.cost);
      paid = true;
    }
  }
  expect(paid).toBe(true);
  expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
  expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(500);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
