import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { issueCommandFrame } from '../sdk/commands/frame';
import { routeArrivals, routeTravelTicks } from './route-selection';
import { groundSegmentAdvance, groundSegmentTravelCost, groundTravelCost, walkingDistance } from './terrain';
import { stepGame } from './sim';

it('keeps the cost and advance finite when rounding clips a zero-length forest corner', () => {
  // ladder-20 grove tick 1275: translate (1936,1392) -> (1968,1872).
  // Repeated nextY additions put row 8's forest in [0.49999999999999994, 0.5].
  const map = { terrain: { cell: 32, cols: 3, rows: 18, cells: '........................T..T..........................' } };
  const from = { x: 16, y: 16 }, goal = { x: 48, y: 496 }, length = Math.hypot(32, 480);
  expect(groundTravelCost(map, from, goal)).toBeCloseTo(length);
  expect(groundSegmentAdvance(map, from, goal, length + 1)).toEqual(goal);
});

it.each([false, true])('ranks a longer grass route ahead of a shorter mud corridor by actual arrival (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const from = [{ id: 'near-mud', x: x(320), y: 800, speed: 60 }, { id: 'far-grass', x: x(720), y: 1248, speed: 60 }];
  const goal = { x: x(720), y: 800 };
  const cells = Array.from({ length: 128 * 128 }, (_, index) => {
    const row = Math.floor(index / 128), col = mirror ? 127 - index % 128 : index % 128;
    return col < 20 && (row === 23 || row === 27) ? '#' : col < 20 && row > 23 && row < 27 ? 'm' : '.';
  }).join('');
  const arrivals = from.map(unit => {
    const game = sketchScene('terrain-arrival').map('bareDuel').replaceDefaults()
      .player('us').player('foe').townHall('us', x(500), 500).townHall('foe', x(500), 3500)
      .worker('us', unit.x, unit.y, { id: unit.id }).build().createGame();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells };
    const road = walkingDistance(game.map, unit, goal, 'land')!;
    const predicted = routeTravelTicks(game.map, unit, goal, 'land', unit.speed)!;
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'arrival-proof',
      command: { type: 'move', unitIds: [unit.id], ...goal, avoidCombat: true } }]);
    const mover = game.units.find(candidate => candidate.id === unit.id)!;
    for (let tick = 0; tick < 400 && mover.order.type !== 'idle'; tick++) stepGame(game);
    expect(mover.order.type).toBe('idle');
    expect(Math.hypot(mover.x - goal.x, mover.y - goal.y)).toBeLessThanOrEqual(5);
    expect(Math.abs(predicted - game.tick) / game.tick).toBeLessThan(.025);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    return { id: unit.id, road, predicted, actual: game.tick, map: game.map };
  });
  expect(arrivals[0]!.road).toBeLessThan(arrivals[1]!.road);
  expect(arrivals[0]!.actual).toBeGreaterThan(arrivals[1]!.actual);
  expect(routeArrivals(arrivals[0]!.map, from, goal, 'land').map(({ unit }) => unit.id)).toEqual(['far-grass', 'near-mud']);
  console.log(JSON.stringify({ mirror, arrivals: arrivals.map(({ map: _map, ...result }) => result) }));
});

it('keeps physical road length separate from pace cost and excludes disconnected land', () => {
  const map = { terrain: { cell: 32, cols: 6, rows: 3, cells: '.m..~.'.repeat(3) } };
  const from = { x: 16, y: 48 }, goal = { x: 112, y: 48 };
  expect(walkingDistance(map, from, goal)).toBe(96);
  expect(groundTravelCost(map, from, goal)).toBeCloseTo(352 / 3);
  expect(groundTravelCost(map, from, { x: 176, y: 48 })).toBeUndefined();
  expect(groundTravelCost(map, from, from)).toBe(0);
});

it('keeps distance and pace fields distinct through cache eviction and array reuse', () => {
  const map = { terrain: { cell: 32, cols: 24, rows: 24, cells: Array.from({ length: 576 }, (_, i) =>
    i % 24 === 12 && Math.floor(i / 24) < 20 ? '#' : i % 4 === 1 ? 'm' : '.').join('') } };
  const from = { x: 16, y: 16 }, goal = { x: 624, y: 336 };
  const expected = [walkingDistance(map, from, goal), groundTravelCost(map, from, goal)];
  for (let i = 0; i < 140; i++) {
    const target = { x: (i % 24) * 32 + 16, y: Math.floor(i / 24) * 32 + 16 };
    groundTravelCost(map, from, target);
    walkingDistance(map, from, target);
  }
  expect([walkingDistance(map, from, goal), groundTravelCost(map, from, goal)]).toEqual(expected);
});

it.each([{ x: 16, y: 48 }, { x: 32, y: 48 }, { x: 48, y: 48 }])('integrates pace symmetrically from a cell edge or center: %o', from => {
  const map = { terrain: { cell: 32, cols: 6, rows: 3, cells: '.m....'.repeat(3) } }, goal = { x: 112, y: 48 };
  expect(groundSegmentTravelCost(map, from, goal)).toBeCloseTo(groundSegmentTravelCost(map, goal, from));
  expect(groundSegmentTravelCost(map, from, from)).toBe(0);
});
