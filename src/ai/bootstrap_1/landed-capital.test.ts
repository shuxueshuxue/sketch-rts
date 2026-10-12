import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BUILDING_DEFS } from '../../shared/catalog';
import { sameGround, setBuildingBodies, snapToFootprint, walkingDistance } from '../../shared/terrain';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { colonyNavalWant } from '../policy/naval';
import { miningHallSite } from '../../shared/mining-site';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].map(producer => ({ version, race, mirror, producer })))));

function field(race: 'grove' | 'ember', mirror: boolean, producer: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('landed-capital').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(608), 1280, { id: 'home' }).goldMine('home-mine', x(384), 1280, 6000)
    .townHall('us', x(3008), 1024, { id: 'old-colony' }).goldMine('old-mine', x(2784), 1024, 6000)
    .worker('us', x(2720), 1060, { id: 'garrison-builder' })
    .goldMine('new-mine', x(3008), 3200, 6000)
    .worker('us', x(2752), 3200, { id: 'settler' });
  if (producer) scene = scene.building('us', race === 'grove' ? 'barracks' : 'emberForge', x(3008), 1504);
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128, row = Math.floor(index / 128);
    const right = col >= 72 && col <= 118 && (row >= 8 && row <= 55 || row >= 78 && row <= 119);
    const rim = col >= 71 && col <= 119 && (row >= 7 && row <= 56 || row >= 77 && row <= 120);
    return col < 30 || right ? '.' : col === 30 || rim ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  return game;
}

it.each(cases)('$version funds its landed $race capital before older-colony recruitment (mirror=$mirror, producer=$producer)',
  ({ version, race, mirror, producer }) => {
    const game = field(race, mirror, producer), snapshot = snapshotGame(game);
    const options = bootstrapPolicyContext(snapshot, 'us', version, { memory: createAiPolicyMemory(), teams: game.teams });
    const want = colonyNavalWant(snapshot, 'us', options);
    expect(want?.id).toBe('naval:islandHall');
    const command = want!.issue(new Set())!;
    expect(command).toMatchObject({ type: 'build', buildingKind: 'townHall', unitId: 'settler' });
    const initialGold = game.players.us!.gold;
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'naval', command }]);
    for (let tick = 0; tick < 1800; tick++) stepGame(game);
    const mine = game.resources.find(mine => mine.id === 'new-mine')!;
    expect(game.buildings.some(building => building.kind === 'townHall' && building.complete && sameGround(game.map, building, mine))).toBe(true);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(BUILDING_DEFS.townHall.cost);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(initialGold);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.units.find(unit => unit.id === 'garrison-builder')!.order.type).toBe('idle');
  });

it.each(cases.filter(test => !test.producer))('$version assigns the shorter road to its $race foundation (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const game = field(race, mirror, false), x = (value: number) => mirror ? 4096 - value : value;
    const terrain = game.map.terrain!;
    game.map = { ...game.map, terrain: { ...terrain, cells: [...terrain.cells].map((cell, index) => {
      const col = mirror ? 127 - index % 128 : index % 128;
      return Math.floor(index / 128) === 98 && col >= 73 && col <= 117 ? 'T' : cell;
    }).join('') } };
    setBuildingBodies(game.map, game.buildings);
    const nearer = game.units.find(unit => unit.id === 'settler')!;
    nearer.x = x(2980); nearer.y = 3200;
    const roadBuilder = game.spawnUnit('us', 'worker', x(2608), 2992);
    const snapshot = snapshotGame(game), mine = snapshot.resources.find(mine => mine.id === 'new-mine')!;
    const site = miningHallSite(snapshot, mine)!;
    expect(Math.hypot(nearer.x - site.x, nearer.y - site.y)).toBeLessThan(Math.hypot(roadBuilder.x - site.x, roadBuilder.y - site.y));
    expect(walkingDistance(snapshot.map, nearer, site, 'land')!).toBeGreaterThan(walkingDistance(snapshot.map, roadBuilder, site, 'land')!);
    const options = bootstrapPolicyContext(snapshot, 'us', version, { memory: createAiPolicyMemory(), teams: game.teams });
    const command = colonyNavalWant(snapshot, 'us', options)!.issue(new Set())!;
    expect(command).toMatchObject({ type: 'build', buildingKind: 'townHall', unitId: roadBuilder.id });
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'naval', command }]);
    for (let tick = 0; tick < 1800; tick++) stepGame(game);
    expect(game.buildings.some(building => building.kind === 'townHall' && building.complete && sameGround(game.map, building, mine))).toBe(true);
    expect(game.match.stats.unitsLost.us).toBe(0);
  });
