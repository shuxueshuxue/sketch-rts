import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { retreatLandRoad, safeLandTravelTicks } from './safe-land-route';

it('computes the full native road past a rounded forest corner', () => {
  // Cropped/translated from ladder-20 grove, archer/v9, tick 1275:
  // (1936,1392) -> (1968,1872), footman speed 62. The terrain clearance
  // accepts the segment, but the old pace integration sampled a forest at a
  // rounded grid-corner crossing and returned Infinity.
  const game = sketchScene('nonfinite-native-road').map('bareDuel').replaceDefaults()
    .player('us').player('foe').unit('us', 'footman', 16, 16, { id: 'courier' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 3, rows: 18, cells: '........................T..T..........................' };
  const snapshot = snapshotGame(game), unit = snapshot.units[0]!, goal = { x: 48, y: 496 };
  const ticks = Math.ceil(Math.hypot(32, 480) / unit.speed * 20);
  expect(safeLandTravelTicks(snapshot, unit, goal, [])).toBe(ticks);
  expect(retreatLandRoad(snapshot, unit, goal, [])?.ticks).toBe(ticks);
});

it.each([0, NaN, Infinity, Number.MIN_VALUE])('reports the unit and segment for invalid travel time at speed %s', speed => {
  const game = sketchScene('invalid-road-speed').map('bareDuel').replaceDefaults()
    .player('us').player('foe').unit('us', 'footman', 200, 200, { id: 'courier' }).build().createGame();
  const snapshot = snapshotGame(game), unit = { ...snapshot.units[0]!, speed };
  expect(() => safeLandTravelTicks(snapshot, unit, { x: 300, y: 200 }, []))
    .toThrow(/courier.*\(200,200\) -> \(300,200\)/);
});

it('retains finite trips and zero travel time at the destination', () => {
  const game = sketchScene('finite-native-road').map('bareDuel').replaceDefaults()
    .player('us').player('foe').unit('us', 'footman', 200, 200, { id: 'courier' }).build().createGame();
  const snapshot = snapshotGame(game), unit = snapshot.units[0]!;
  expect(safeLandTravelTicks(snapshot, unit, unit, [])).toBe(0);
  expect(safeLandTravelTicks(snapshot, unit, { x: 300, y: 200 }, [])).toBe(Math.ceil(100 / unit.speed * 20));
});
