import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame } from './sim';
import { SHIP_PLANNING_SLICE_WORK, advanceLiveShipRouteSearch, beginLiveShipRouteSearch, planShipRoute, type ShipPose } from './ship-navigation';
import type { GameMap } from './types';

// A long voyage round a large island: far enough, and blocked enough, for the search to build its landmark field.
function island(): GameMap {
  const cell = 32, cols = 160, rows = 96;
  return { ...createGame('bareDuel').map, width: cols * cell, height: rows * cell, wind: { direction: Math.PI / 2, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, i) =>
      i % cols >= 60 && i % cols < 100 && Math.floor(i / cols) >= 12 && Math.floor(i / cols) < 90 ? '.' : '~').join('') } };
}
const open = Object.assign((_from: ShipPose, _to: ShipPose) => true, { hasTraffic: false });

function sliced(map: GameMap) {
  const ship = createUnit('voyage', 'player', 'transport', 30.5 * 32, 50.5 * 32);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  const goal = { x: 130.5 * 32, y: 50.5 * 32 };
  const state = beginLiveShipRouteSearch(), cursors: string[] = [], expansions: number[] = [];
  let result: ReturnType<typeof planShipRoute> | undefined;
  for (let slice = 0; !result && slice < 5000; slice++) {
    const before = state.visited ?? 0;
    result = advanceLiveShipRouteSearch(map, ship, goal, open, Infinity, true, state);
    expansions.push((state.visited ?? 0) - before);
    cursors.push(`${state.phase}:${state.prepare ?? ''}:${state.arcCursor ?? ''}:${state.potentialWork ?? ''}:${state.entranceCursor ?? ''}:${state.visited ?? ''}`);
  }
  return { ship, goal, result, cursors, expansions };
}

describe('logical slice work (@@@ship-search-work)', () => {
  it('cuts a continued search at the same points with cold or warm geometry caches, and finishes on the synchronous route', () => {
    const cold = sliced(island());
    const sharedMap = island();
    const first = sliced(sharedMap), warm = sliced(sharedMap);
    expect(cold.result).toBeDefined();
    expect(cold.cursors.some(cursor => cursor.startsWith('prepare:potential'))).toBe(true);
    expect(first.cursors).toEqual(cold.cursors);
    expect(warm.cursors).toEqual(cold.cursors);
    expect(warm.result).toEqual(cold.result);
    expect(cold.result).toEqual(planShipRoute(island(), cold.ship, cold.goal, open, Infinity, true));
  });

  it('expands no more than one slice of plain work per call', () => {
    const { expansions, cursors } = sliced(island());
    expect(cursors.length).toBeGreaterThan(5);
    for (const count of expansions) expect(count).toBeLessThanOrEqual(SHIP_PLANNING_SLICE_WORK);
  });
});
