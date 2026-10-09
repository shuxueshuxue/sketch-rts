import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame } from './sim';
import { advanceVoyageRefinement, beginVoyageRefinement, headingDifference, hullFits, hullPassageClear, planVoyageRoute, type ShipPose } from './ship-navigation';
import type { GameMap } from './types';

/** Measure the travelled circle arcs, rather than adding their sampled chords. */
function travelledDistance(from: ShipPose, points: readonly ShipPose[]): number {
  let distance = 0, previous = from;
  for (const point of points) {
    distance += point.curvature
      ? Math.abs(headingDifference(previous.heading, point.heading) / point.curvature)
      : Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return distance;
}

describe('bounded voyage smoothing', () => {
  it('chooses a shorter continuous bend when the fastest bend exceeds the reference detour allowance', () => {
    const map: GameMap = { ...createGame('bareDuel').map, width: 10000, height: 10000,
      wind: { direction: 0, speed: 80 },
      terrain: { cell: 100, cols: 100, rows: 100, cells: '~'.repeat(10000) } };
    const ship = createUnit('boat', 'player', 'transport', 4000, 5000);
    ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
    const from = { x: ship.x, y: ship.y, heading: 0 };
    const goal = { x: ship.x + 168, y: ship.y + 168 };
    // This legal reference rotates in place, then travels diagonally. A
    // smoother should replace that stop with an eligible forward curve.
    const reference = [{ x: ship.x, y: ship.y, heading: Math.PI / 4 }, { ...goal, heading: Math.PI / 4 }];
    const allowance = Math.hypot(goal.x - ship.x, goal.y - ship.y) * 1.1;
    const unrestricted = planVoyageRoute(map, ship, goal);
    expect(unrestricted.partial).toBe(false);
    expect(travelledDistance(from, unrestricted.points)).toBeGreaterThan(allowance);

    const refined = beginVoyageRefinement(from, reference);
    expect(advanceVoyageRefinement(map, ship, refined, () => true)).toBe(true);
    expect(refined.result.at(-1)).toMatchObject(goal);
    expect(travelledDistance(from, refined.result)).toBeLessThan(allowance);
    expect(refined.result.some(point => point.curvature)).toBe(true);
    let previous = from;
    for (const point of refined.result) {
      expect(point.exact).toBeUndefined();
      expect(point.pivot).toBeUndefined();
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeGreaterThan(1e-6);
      expect(hullFits(map, ship, point)).toBe(true);
      expect(hullPassageClear(map, ship, previous, point)).toBe(true);
      previous = point;
    }
  });
});
