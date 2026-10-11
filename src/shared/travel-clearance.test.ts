import { expect, it } from 'vitest';
import { groundSegmentTravelTicks, segmentAvoidsExpandingDisk } from './travel-clearance';
import { sketchScene } from '../sdk/scene';
import { issuePlayerCommand, stepGame } from './sim';
import { MOVE_ORDER_ARRIVAL_RANGE } from './movement-rules';
import { SIM_TICKS_PER_SECOND } from './time';

it('rejects an intermediate crossing even when both endpoints are clear', () => {
  expect(segmentAvoidsExpandingDisk({ x: -30, y: 9 }, { x: 30, y: 9 }, { x: 0, y: 0, radius: 5, speed: 10 }, 1)).toBe(false);
});

it('accepts an escaping segment that stays ahead of a growing reach', () => {
  expect(segmentAvoidsExpandingDisk({ x: 10, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 0, radius: 1, speed: 30 }, 1)).toBe(true);
});

it('checks standing and slower walkers through the full time window', () => {
  expect(segmentAvoidsExpandingDisk({ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0, radius: 1, speed: 10 }, 1)).toBe(false);
  expect(segmentAvoidsExpandingDisk({ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0, radius: 1, speed: 30 }, 1)).toBe(false);
});

it('treats exact tangency as contact for a static disk', () => {
  expect(segmentAvoidsExpandingDisk({ x: -10, y: 5 }, { x: 10, y: 5 }, { x: 0, y: 0, radius: 5, speed: 0 }, 1)).toBe(false);
  expect(segmentAvoidsExpandingDisk({ x: -10, y: 6 }, { x: 10, y: 6 }, { x: 0, y: 0, radius: 5, speed: 0 }, 1)).toBe(true);
});

it.each(['.', ',', 'm', 'grass-to-mud'])('matches actual local SDK travel on %s terrain', ground => {
  const game = sketchScene('local-travel-pace').map('bareDuel').replaceDefaults()
    .player('us').player('foe').townHall('us', 500, 500).townHall('foe', 3500, 3500)
    .unit('us', 'horseArcher', 1200, 1200, { id: 'rider' }).build().createGame();
  game.scriptedVictory = true;
  const cells = ground === 'grass-to-mud'
    ? Array.from({ length: 128 * 128 }, (_, i) => i % 128 < 40 ? '.' : 'm').join('')
    : ground.repeat(128 * 128);
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells };
  const rider = game.units.find(unit => unit.id === 'rider')!, destination = { x: 1400, y: 1200 };
  const estimate = groundSegmentTravelTicks(game.map, rider, destination, rider.speed);
  issuePlayerCommand(game, 'us', { type: 'move', unitIds: [rider.id], ...destination });
  let elapsed = 0;
  while (rider.order.type !== 'idle') { stepGame(game); elapsed++; }
  expect(estimate - elapsed).toBeGreaterThanOrEqual(0);
  expect(estimate - elapsed).toBeLessThanOrEqual(Math.ceil(MOVE_ORDER_ARRIVAL_RANGE / rider.speed * SIM_TICKS_PER_SECOND / .6) + 1);
});
