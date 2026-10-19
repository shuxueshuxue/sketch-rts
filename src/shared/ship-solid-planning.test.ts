import { expect, it } from 'vitest';
import snapshots from '../ai/benchmark/fixtures/naval-shipyard-snapshots.json';
import { beginShipCollisionFrame, setShipCollisionSolids, sweepShipCollision } from './ship-collisions';
import { reservationTraffic, shipTraffic } from './ship-avoidance';
import { hullPassageClear, planShipRoute } from './ship-navigation';
import { advanceShipPlanningJob, beginShipPlanningJob, validShipPlanningJob } from './ship-planning-job';
import { createGame, snapshotGame } from './sim';
import { beginShipMotionFrame } from './ship-motion';
import { beginShipPlanningFrame } from './ship-planning-budget';
import { sailToward } from './sailing';
import type { Building, GameMap, Unit } from './types';

function scene(index: number) {
  const saved = snapshots.cases[index]!;
  const map = structuredClone(snapshots.maps[saved.map as keyof typeof snapshots.maps]) as unknown as GameMap;
  const ship = structuredClone(saved.ship) as unknown as Unit;
  const units = [ship], solids = structuredClone(saved.buildings) as unknown as Building[];
  beginShipCollisionFrame(units, map, solids);
  return { saved, map, ship, units, solids, from: { x: ship.x, y: ship.y, heading: ship.sailing!.heading } };
}

// Minimal projections of four real room matches at 710986b1: unchanged terrain,
// hull pose/profile, nearby buildings and the committed first route leg.
it.each([0, 1, 2, 3])('does not approve the saved maneuver through a shipyard (snapshot %s)', index => {
  const { saved, map, ship, units, from } = scene(index), to = saved.firstLeg;
  expect(hullPassageClear(map, ship, from, to)).toBe(true);
  expect(sweepShipCollision(map, ship, units, from, to)).toMatchObject({ kind: 'building', fraction: 0 });
  expect(shipTraffic(ship, units)(from, to)).toBe(false);
  // Reservation and strategic filters make fresh arrays; they must still see
  // the map's physical solids rather than depending on the live array identity.
  expect(reservationTraffic(ship, [], 600, map)(from, to)).toBe(false);
});

it.each([0, 1, 2, 3])('finds a physically clear departure from the saved shipyard contact (snapshot %s)', index => {
  const { map, ship, units, from } = scene(index);
  const goal = ship.order as { x: number; y: number };
  const route = planShipRoute(map, ship, goal, shipTraffic(ship, units), 1024);
  expect(route.points.length).toBeGreaterThan(0);
  let previous = from;
  for (const next of route.points) {
    expect(sweepShipCollision(map, ship, units, previous, next)).toBeUndefined();
    previous = next;
  }
  // The two pinched hulls first back out by a lattice cell before turning.
  expect(Math.hypot(previous.x - from.x, previous.y - from.y)).toBeGreaterThan(31);
});

it.each([0, 1, 2, 3])('executes a departure from the saved shipyard within 30 seconds (snapshot %s)', index => {
  const { map, ship, units, solids, from } = scene(index), hp = ship.hp;
  const goal = ship.order as { x: number; y: number };
  for (let tick = 1; tick <= 600; tick++) {
    beginShipMotionFrame(units, map, solids);
    beginShipPlanningFrame(units, tick);
    sailToward(ship, goal, map, units);
  }
  expect(Math.hypot(ship.x - from.x, ship.y - from.y)).toBeGreaterThan(31);
  expect(ship.hp).toBe(hp);
});

it('keeps the same frozen solid geometry when a pending search is cold-restored', () => {
  const { map, ship, units } = scene(2), goal = ship.order as { x: number; y: number };
  beginShipPlanningJob(ship, goal, map, units, undefined, false, 'exact');
  expect(advanceShipPlanningJob(ship, map)).toBeUndefined();
  const restored = JSON.parse(JSON.stringify(ship)) as Unit;
  // The reconstructed job must use its saved obstacles, even if the live
  // source changes after its first search slice.
  setShipCollisionSolids(map, []);
  const finish = (unit: Unit) => {
    for (let slice = 0; slice < 2000; slice++) {
      const result = advanceShipPlanningJob(unit, map);
      if (result) return result;
    }
    throw new Error('Saved departure search did not finish');
  };
  const expected = finish(ship), actual = finish(restored);
  expect(actual).toEqual(expected);
  expect(actual.points.length).toBeGreaterThan(0);
  let previous = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
  for (const next of actual.points) {
    expect(sweepShipCollision(map, ship, units, previous, next)).toBeUndefined();
    previous = next;
  }
  const oldJob = JSON.parse(restored.sailing!.planningJob!);
  oldJob.version = 1; delete oldJob.solids;
  restored.sailing!.planningJob = JSON.stringify(oldJob);
  expect(validShipPlanningJob(restored, goal, map)).toBe(false);
});

it('gives AI snapshots their own physical solid source, including death state', () => {
  const { map, ship, solids, from, saved } = scene(0);
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.map = map; game.units = [ship]; game.buildings = solids; game.obstacles = [];
  const before = snapshotGame(game);
  for (const building of game.buildings) building.hp = 0;
  const after = snapshotGame(game);
  expect(shipTraffic(before.units[0]!, [], 600, before.map)(from, saved.firstLeg)).toBe(false);
  expect(shipTraffic(after.units[0]!, [], 600, after.map)(from, saved.firstLeg)).toBe(true);
});
