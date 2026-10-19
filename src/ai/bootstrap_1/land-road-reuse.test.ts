import { afterEach, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import * as routes from '../../shared/route-selection';
import { nativeLandRoad, retreatLandRoad, retreatThreatReach, safeLandTravelTicks, withLandRoadReuse } from './safe-land-route';

afterEach(() => vi.restoreAllMocks());

function world() {
  const game = sketchScene('land-road-reuse').map('bareDuel').replaceDefaults()
    .player('us').player('foe')
    .unit('us', 'footman', 200, 200, { id: 'courier' })
    .unit('foe', 'footman', 500, 200, { id: 'raider' }).build().createGame();
  const snapshot = snapshotGame(game);
  return { snapshot, unit: snapshot.units.find(unit => unit.id === 'courier')!, foe: snapshot.units.find(unit => unit.id === 'raider')! };
}

it('reuses geometry across admission and return queries while each caller owns its road', () => {
  const { snapshot, unit } = world(), goal = { x: 400, y: 200 };
  const expected = nativeLandRoad(snapshot, unit, goal);
  const steering = vi.spyOn(routes, 'groundSteeringRoute');
  withLandRoadReuse(() => {
    const first = nativeLandRoad(snapshot, unit, goal)!;
    first.points[0]!.x = -999;
    first.points.splice(1);
    expect(nativeLandRoad(snapshot, unit, { ...goal })).toEqual(expected);
    expect(safeLandTravelTicks(snapshot, unit, goal, [])).toBe(expected!.ticks);
    expect(retreatLandRoad(snapshot, unit, goal, [])).toEqual(expected);
    expect(steering).toHaveBeenCalledTimes(1);
  });
});

it('still checks each caller’s foes and destination arrival requirement', () => {
  const { snapshot, unit, foe } = world(), goal = { x: 400, y: 200 };
  const unobstructed = safeLandTravelTicks(snapshot, unit, goal, []);
  expect(unobstructed).toBeGreaterThan(0);
  const guarded = safeLandTravelTicks(snapshot, unit, goal, [foe]);
  expect(guarded).toBeUndefined();
  withLandRoadReuse(() => {
    expect(safeLandTravelTicks(snapshot, unit, goal, [], () => false)).toBeUndefined();
    expect(safeLandTravelTicks(snapshot, unit, goal, [], end => end.x === goal.x)).toBe(unobstructed);
    expect(safeLandTravelTicks(snapshot, unit, goal, [foe])).toBe(guarded);
    const changingFoes = [foe];
    expect(safeLandTravelTicks(snapshot, unit, goal, changingFoes)).toBeUndefined();
    changingFoes.splice(0);
    expect(safeLandTravelTicks(snapshot, unit, goal, changingFoes)).toBe(unobstructed);
    expect(safeLandTravelTicks(snapshot, unit, { x: 250, y: 200 }, [])).toBeLessThan(unobstructed!);
    expect(nativeLandRoad(snapshot, { ...unit, speed: unit.speed / 2 }, goal)!.ticks).toBeGreaterThan(unobstructed!);
  });
});

it('uses fresh world data on the next think even if the snapshot object is retained', () => {
  const { snapshot, unit, foe } = world(), goal = { x: 400, y: 200 };
  const before = withLandRoadReuse(() => ({ road: nativeLandRoad(snapshot, unit, goal), reach: retreatThreatReach(snapshot, foe, unit, 15) }));
  unit.speed /= 2;
  foe.attackRange += 100;
  const after = withLandRoadReuse(() => ({ road: nativeLandRoad(snapshot, unit, goal), reach: retreatThreatReach(snapshot, foe, unit, 15) }));
  expect(after.road!.ticks).toBeGreaterThan(before.road!.ticks);
  expect(after.reach).toBeGreaterThan(before.reach);
  expect(after).toEqual({ road: nativeLandRoad(snapshot, unit, goal), reach: retreatThreatReach(snapshot, foe, unit, 15) });
});

it('restores an outer scope after a nested failure and releases the failed scope', () => {
  const { snapshot, unit } = world(), goal = { x: 400, y: 200 };
  const steering = vi.spyOn(routes, 'groundSteeringRoute');
  withLandRoadReuse(() => {
    nativeLandRoad(snapshot, unit, goal);
    expect(() => withLandRoadReuse(() => {
      nativeLandRoad(snapshot, unit, goal);
      throw new Error('planner failed');
    })).toThrow('planner failed');
    nativeLandRoad(snapshot, unit, goal);
    expect(steering).toHaveBeenCalledTimes(2);
  });
  nativeLandRoad(snapshot, unit, goal);
  nativeLandRoad(snapshot, unit, goal);
  expect(steering).toHaveBeenCalledTimes(4);
});

it('keeps retreat admission separate and recomputes a distinct snapshot view', () => {
  const { snapshot, unit, foe } = world(), goal = { x: 400, y: 200 };
  const behind = { ...foe, x: 150 };
  const retreat = retreatLandRoad(snapshot, unit, goal, [behind]);
  expect(retreat).toBeDefined();
  expect(safeLandTravelTicks(snapshot, unit, goal, [behind])).toBeUndefined();
  const steering = vi.spyOn(routes, 'groundSteeringRoute');
  withLandRoadReuse(() => {
    expect(safeLandTravelTicks(snapshot, unit, goal, [behind])).toBeUndefined();
    expect(retreatLandRoad(snapshot, unit, goal, [behind])).toEqual(retreat);
    expect(retreatLandRoad({ ...snapshot, items: [] }, unit, goal, [behind])).toEqual(retreat);
    expect(steering).toHaveBeenCalledTimes(2);
  });
});
