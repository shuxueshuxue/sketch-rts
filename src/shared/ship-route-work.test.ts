import { expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame } from './sim';
import { advanceShipRouteSearch, type ShipRouteSearchState, type ShipRouteWorkReceipt } from './ship-navigation';

it('observes native preparation and expansion work without changing a continued route or its JSON fork', () => {
  const base = createGame('bareDuel', { aiPlayers: [] }).map, cell = 32, cols = 80, rows = 64;
  const map = { ...base, width: cols * cell, height: rows * cell, wind: { direction: Math.PI / 2, speed: 80 },
    terrain: { cols, rows, cell, cells: Array.from({ length: cols * rows }, (_, i) =>
      i % cols >= 32 && i % cols < 45 && Math.floor(i / cols) >= 20 && Math.floor(i / cols) < 45 ? '.' : '~').join('') } };
  const ship = createUnit('route', 'player', 'transport', 16.5 * cell, 32.5 * cell);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  const goal = { x: 62.5 * cell, y: 32.5 * cell }, traffic = Object.assign(() => true, { hasTraffic: false });
  let plain: ShipRouteSearchState = { phase: 'prepare' }, observed: ShipRouteSearchState = { phase: 'prepare' };
  const total: ShipRouteWorkReceipt = { logicalWork: 0, expandedStates: 0 };
  const original = JSON.stringify({ map, ship });
  for (let index = 0; index < 1000; index++) {
    const expected = advanceShipRouteSearch(map, ship, goal, traffic, Number.MAX_SAFE_INTEGER, true, plain);
    const actual = advanceShipRouteSearch(map, ship, goal, traffic, Number.MAX_SAFE_INTEGER, true, observed, total);
    expect(actual).toEqual(expected);
    expect(JSON.stringify(observed)).toBe(JSON.stringify(plain));
    if (index === 2) { plain = JSON.parse(JSON.stringify(plain)); observed = JSON.parse(JSON.stringify(observed)); }
    if (actual) break;
  }
  expect(observed.phase).toBe('done');
  expect(total.logicalWork).toBeGreaterThan(0);
  expect(total.logicalWork).toBeGreaterThan(total.expandedStates);
  expect(JSON.stringify(observed)).not.toContain('logicalWork');
  expect(JSON.stringify({ map, ship })).toBe(original);
});
