import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { hullFits } from './ship-navigation';
import { coursePerformance } from './ship-wind';
import { seconds } from './time';
import type { UnitKind } from './types';

function scene(kind: UnitKind = 'transport') {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 8000, height: 6000, wind: { direction: Math.PI / 4, speed: 80 },
    terrain: { cell: 100, cols: 80, rows: 60, cells: '~'.repeat(4800) } };
  const ship = game.spawnUnit('player', kind, 1500, 1500);
  ship.sailing!.heading = 0;
  for (const [index, point] of [{ x: 3000, y: 1500 }, { x: 3000, y: 3000 }, { x: 4500, y: 3000 }].entries())
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], ...point, avoidCombat: true, queued: index > 0 });
  return { game, ship };
}

/** Change actual weather halfway through the rounded first corner, then save
 * and resume both copies through all remaining real command boundaries. */
function shiftedJourney(kind: UnitKind, direction: number) {
  const { game, ship } = scene(kind);
  for (let tick = 0; tick < seconds(60) && ship.sailing!.heading <= Math.PI / 4; tick++) stepGame(game);
  expect(ship.sailing!.route?.points[0]?.curvature).toBeGreaterThan(0);
  expect(ship.order).toMatchObject({ type: 'move', x: 3000, y: 1500 });
  const shiftPosition = { x: ship.x, y: ship.y }, originalOrder = ship.order;
  game.map.wind = { direction, speed: 80 };
  const outgoingNoGo = coursePerformance(ship, game.map, Math.PI / 2, { assumeTrimmed: true }).noGo;
  const resumed = scene(kind).game;
  restoreSnapshotIntoGame(resumed, JSON.parse(JSON.stringify(snapshotGame(game))), game.nextId);
  let priorOrder = ship.order, minimumCornerY = ship.y, earlyIdle = false, tackTravel = 0, maneuverTicks = 0;
  const activated: { x: number; y: number }[] = [];
  for (let tick = 0; tick < seconds(240); tick++) {
    const before = { x: ship.x, y: ship.y };
    stepGame(game); stepGame(resumed);
    expect(checksumGame(resumed)).toBe(checksumGame(game));
    expect(hullFits(game.map, ship)).toBe(true);
    if (ship.order === originalOrder) minimumCornerY = Math.min(minimumCornerY, ship.y);
    if (ship.order !== priorOrder) {
      if (ship.order.type === 'move') activated.push({ x: ship.order.x, y: ship.order.y });
      else if (!activated.length) earlyIdle = true;
      priorOrder = ship.order;
    }
    if (ship.sailing!.sail?.mode === 'maneuver') maneuverTicks++;
    if (ship.sailing!.sail?.mode === 'tacking') {
      const performance = coursePerformance(ship, game.map);
      if (!performance.noGo && ship.sailing!.speed > performance.auxiliarySpeed * 1.1)
        tackTravel += Math.hypot(ship.x - before.x, ship.y - before.y);
    }
    if (ship.order.type === 'idle' && !ship.orderQueue?.length) break;
  }
  expect(earlyIdle).toBe(false);
  expect(activated).toEqual([{ x: 3000, y: 3000 }, { x: 4500, y: 3000 }]);
  expect(ship.order.type).toBe('idle'); expect(ship.orderQueue).toHaveLength(0);
  expect(Math.hypot(ship.x - 4500, ship.y - 3000)).toBeLessThan(1);
  // The vertex was intentionally skipped by the active rounded course. A
  // weather event must not demand returning to it before advancing the queue.
  expect(minimumCornerY).toBeGreaterThanOrEqual(shiftPosition.y - 2);
  return { outgoingNoGo, tackTravel, maneuverTicks };
}

describe('weather changes during queued ship corners', () => {
  it.each(['transport', 'shipOfTheLine'] as const)('%s keeps a usable rounded course through a favorable shift and JSON save', kind => {
    const result = shiftedJourney(kind, Math.PI / 2);
    expect(result.outgoingNoGo).toBe(false);
    expect(result.tackTravel).toBe(0);
  });

  it.each(['transport', 'shipOfTheLine'] as const)('%s finishes its finite corner, then beats along the newly upwind leg', kind => {
    const result = shiftedJourney(kind, -Math.PI / 2);
    expect(result.outgoingNoGo).toBe(true);
    expect(result.maneuverTicks).toBeGreaterThan(0);
    expect(result.tackTravel).toBeGreaterThan(100);
  });

  it('admits an adverse shift before the corner into ordinary beating without consuming a queue head', () => {
    const { game, ship } = scene();
    for (let tick = 0; tick < seconds(4); tick++) stepGame(game);
    expect(ship.sailing!.route?.queuedX).toBe(3000);
    expect(ship.sailing!.route?.points[0]?.curvature).toBe(0);
    game.map.wind = { direction: Math.PI, speed: 80 };
    stepGame(game);
    expect(ship.order).toMatchObject({ type: 'move', x: 3000, y: 1500 });
    expect(ship.orderQueue).toHaveLength(2);
    expect(ship.sailing!.route?.queuedX).toBeUndefined();
    expect(ship.sailing!.route?.points.some(point => point.tack)).toBe(true);
  });

  it('lets an immediate new helm order replace the weather-adjusted corner and its queue', () => {
    const { game, ship } = scene();
    for (let tick = 0; tick < seconds(60) && ship.sailing!.heading <= Math.PI / 4; tick++) stepGame(game);
    game.map.wind = { direction: Math.PI / 2, speed: 80 };
    stepGame(game);
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 5000, y: 1800, avoidCombat: true });
    expect(ship.orderQueue).toHaveLength(0);
    for (let tick = 0; tick < seconds(100) && ship.order.type !== 'idle'; tick++) stepGame(game);
    expect(ship.order.type).toBe('idle');
    expect(ship.orderQueue).toHaveLength(0);
    expect(Math.hypot(ship.x - 5000, ship.y - 1800)).toBeLessThan(1);
  });
});
