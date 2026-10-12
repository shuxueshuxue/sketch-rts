import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { hullFits, hullPassageClear, planVoyageRoute, type ShipPose } from './ship-navigation';
import { seconds, SIM_TICKS_PER_SECOND } from './time';
import type { GameMap, Unit } from './types';

const cell = 32, cols = 96, rows = 72;
const goal = { x: 72.5 * cell, y: 36.5 * cell };
function water(): GameMap {
  return { ...createGame('bareDuel').map, width: cols * cell, height: rows * cell,
    wind: { direction: Math.PI / 2, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, i) => {
      const x = i % cols, y = Math.floor(i / cols);
      return x >= 40 && x < 56 && y >= 24 && y < 48 ? '.' : '~';
    }).join('') } };
}
function vessel(): Unit {
  const ship = createUnit('vessel', 'player', 'transport', 24.5 * cell, 36.5 * cell);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  return ship;
}
function expectPassage(map: GameMap, ship: Unit, points: ShipPose[], destination = goal) {
  expect(points.at(-1)).toMatchObject(destination);
  let previous: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
  for (const point of points) {
    expect(hullFits(map, ship, point)).toBe(true);
    expect(hullPassageClear(map, ship, previous, point)).toBe(true);
    previous = point;
  }
}

describe('reusable coastal search geometry', () => {
  it('changes the detour side with the actual adverse wind, including in-place changes and warm caches', () => {
    const map = water(), ship = vessel();
    const downwind = planVoyageRoute(map, ship, goal);
    expect(downwind.partial).toBe(false); expectPassage(map, ship, downwind.points);
    expect(Math.max(...downwind.points.map(point => point.y))).toBeGreaterThan(48 * cell);
    expect(Math.min(...downwind.points.map(point => point.y))).toBeGreaterThanOrEqual(ship.y);
    expect(planVoyageRoute(map, ship, goal)).toEqual(downwind);

    map.wind!.direction = -Math.PI / 2;
    const opposite = planVoyageRoute(map, ship, goal);
    expect(opposite.partial).toBe(false); expectPassage(map, ship, opposite.points);
    expect(Math.min(...opposite.points.map(point => point.y))).toBeLessThan(24 * cell);
    expect(Math.max(...opposite.points.map(point => point.y))).toBeLessThanOrEqual(ship.y);
    const cold = JSON.parse(JSON.stringify(map)) as GameMap;
    expect(planVoyageRoute(cold, ship, goal)).toEqual(opposite);

    map.wind!.direction = Math.PI / 2;
    expect(planVoyageRoute(map, ship, goal)).toEqual(downwind);
  });

  it('replans the real full-hull passage after an in-place coast change closes the favored side', () => {
    const map = water(), ship = vessel();
    const first = planVoyageRoute(map, ship, goal);
    expect(Math.max(...first.points.map(point => point.y))).toBeGreaterThan(48 * cell);
    map.terrain!.cells = Array.from(map.terrain!.cells, (value, i) =>
      i % cols >= 40 && i % cols < 56 && Math.floor(i / cols) >= 48 ? '.' : value).join('');
    const changed = planVoyageRoute(map, ship, goal);
    expect(changed.partial).toBe(false); expectPassage(map, ship, changed.points);
    expect(Math.min(...changed.points.map(point => point.y))).toBeLessThan(24 * cell);
    expect(planVoyageRoute(JSON.parse(JSON.stringify(map)) as GameMap, ship, goal)).toEqual(changed);
  });

  it('retains identical routes after many other destinations and a JSON-restored cold map', () => {
    const map = water(), ship = vessel(), original = planVoyageRoute(map, ship, goal);
    for (const x of [64.5, 80.5]) for (const y of [8.5, 16.5, 40.5, 56.5, 64.5]) {
      const destination = { x: x * cell, y: y * cell }, route = planVoyageRoute(map, ship, destination);
      expect(route.partial).toBe(false); expectPassage(map, ship, route.points, destination);
    }
    expect(planVoyageRoute(map, ship, goal)).toEqual(original);
    expect(planVoyageRoute(JSON.parse(JSON.stringify(map)) as GameMap, ship, goal)).toEqual(original);
  });

  it('resumes the same coastal voyage and wind-triggered replans from a JSON save with cold geometry caches', () => {
    const makeGame = () => {
      const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [] });
      game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = [];
      game.map = water(); game.scriptedVictory = true;
      return game;
    };
    const game = makeGame(), ship = game.spawnUnit('player', 'transport', 24.5 * cell, 36.5 * cell);
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], ...goal, avoidCombat: true });
    for (let tick = 0; tick < seconds(3); tick++) stepGame(game);
    expect(ship.sailing!.route!.points.length).toBeGreaterThan(2);
    const resumed = makeGame();
    restoreSnapshotIntoGame(resumed, JSON.parse(JSON.stringify(snapshotGame(game))), game.nextId);
    for (let tick = 0; tick < seconds(140); tick++) {
      if (tick === seconds(10)) {
        game.map.wind!.direction = -Math.PI / 2;
        resumed.map.wind!.direction = -Math.PI / 2;
      }
      const before: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
      stepGame(game); stepGame(resumed);
      expect(hullPassageClear(game.map, ship, before, { x: ship.x, y: ship.y, heading: ship.sailing!.heading })).toBe(true);
      if (tick % SIM_TICKS_PER_SECOND === 0) expect(checksumGame(resumed)).toBe(checksumGame(game));
      if (ship.order.type === 'idle') break;
    }
    expect(ship.order.type).toBe('idle');
    expect(Math.hypot(ship.x - goal.x, ship.y - goal.y)).toBeLessThan(1);
    expect(checksumGame(resumed)).toBe(checksumGame(game));
  });
});
