import { expect, it } from 'vitest';
import { routePrefix } from './route-selection';

it('clips a one-segment road at the requested distance', () => {
  expect(routePrefix({ x: 0, y: 0 }, [{ x: 3000, y: 0 }], 320)).toEqual([{ x: 0, y: 0 }, { x: 320, y: 0 }]);
});

it('counts road bends rather than straight displacement', () => {
  expect(routePrefix({ x: 0, y: 0 }, [{ x: 100, y: 0 }, { x: 100, y: 200 }], 150))
    .toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
});

it('ends at the actual endpoint when the road is shorter and leaves its source untouched', () => {
  const road = [{ x: 30, y: 40 }];
  expect(routePrefix({ x: 0, y: 0 }, road, 320)).toEqual([{ x: 0, y: 0 }, { x: 30, y: 40 }]);
  expect(road).toEqual([{ x: 30, y: 40 }]);
});
