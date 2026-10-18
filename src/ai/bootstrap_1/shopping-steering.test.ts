import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { createShop } from '../../shared/shop';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { armedFoes, retreatLandRoad, safeLandTravelTicks } from './safe-land-route';
import { shopping, shoppingGoals } from './shopping';

it.each([false, true].flatMap(mirror => [false, true].map(ongoing => ({ mirror, ongoing }))))(
  'rejects a shop trip whose native building detour crosses a camp (mirror=$mirror, ongoing=$ongoing)', ({ mirror, ongoing }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('shopping-native-road').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500);
  // Like ladder-12 grove: the terrain route looks safe, but buildings make the
  // actual movement road pass the ogres while the shopping move avoids combat.
  for (let i = 0; i < 11; i++) scene = scene.townHall('us', x(1500), 600 + i * 80);
  for (let i = 0; i < 6; i++) scene = scene.unit('us', 'lancer', x(500 + i * 25), 1000, { id: `buyer-${i}` });
  scene = scene.unit('neutral', 'ogreWarrior', x(1500), 1480)
    .unit('neutral', 'ogreWarrior', x(1500), 520);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  setBuildingBodies(game.map, game.buildings);
  game.shops = [createShop('shop', x(3000), 1000)];
  if (ongoing) memory.shopping = { unitId: 'buyer-0', shopId: 'shop', kind: 'guardianScroll',
    homeId: game.buildings.find(building => building.owner === 'us')!.id, returning: false };
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
  const buyer = snapshot.units.find(unit => unit.id === 'buyer-0')!, shop = snapshot.shops![0]!;
  const foes = armedFoes(snapshot, 'us', options);
  expect(safeLandTravelTicks(snapshot, buyer, shop, foes)).toBeDefined();
  expect(retreatLandRoad(snapshot, buyer, shop, foes)).toBeUndefined();
  expect(shoppingGoals(snapshot, 'us', options)).toEqual([]);
  expect(shopping.run(snapshot, 'us', options)).toEqual([]);
  expect(memory.shopping).toBeUndefined();
});
