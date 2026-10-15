import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { routeClearsDisks } from '../../shared/route-selection';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { hullPassageClear, planVoyageRoute, shipPoseAt, type ShipPose } from '../../shared/ship-navigation';
import type { GameSnapshot, Unit } from '../../shared/types';
import { coastalFireSegmentClear, coastalVoyagePrefixSafe, coastalVoyageRouteSafe, planCoastalVoyage } from '../policy/coastal-voyage';

function observedTransit(name = 'summoner-battery-transit') {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString()) as { snapshot: GameSnapshot };
  const snapshot = saved.snapshot, ship = snapshot.units.find(unit => unit.id === 'unit-p0-bombardShip-26580')!;
  return { snapshot, ship, goal: { x: 2724.6, y: 6912 }, options: { teams: snapshot.teams! } };
}

it('finds a real ordinary-move detour around the dragon camp crossed by the observed battery route', () => {
  const { snapshot, ship, goal, options } = observedTransit();
  expect(snapshot.tick).toBe(163200);
  expect(coastalVoyageRouteSafe(snapshot, ship, ship.sailing!.route, options)).toBe(false);
  const plan = planCoastalVoyage(snapshot, ship, goal, options)!;
  expect(plan).toBeDefined();
  if (plan.proof !== 'complete') throw new Error('expected complete reference proof');
  expect(Math.hypot(plan.waypoint.x - 3792, plan.waypoint.y - 7952)).toBeLessThan(5);
  expect(plan.legs).toHaveLength(2);
  // Re-query ordinary movement with physical traffic only. No private safe
  // route is installed, and the world terrain/physical rules stay unchanged.
  let from: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
  for (const leg of plan.legs) {
    const hull: Unit = { ...ship, x: from.x, y: from.y, order: { type: 'move', ...leg.goal, avoidCombat: true }, orderQueue: [],
      sailing: { ...ship.sailing!, heading: from.heading } };
    delete hull.sailing!.route;
    const units = snapshot.units.map(unit => unit.id === ship.id ? hull : unit);
    const ordinary = planVoyageRoute(snapshot.map, hull, leg.goal, shipRouteTraffic(snapshot.map, hull, units), 100_000);
    expect(ordinary.partial).toBe(false);
    expect(ordinary.points.at(-1)).toMatchObject(leg.goal);
    expect(coastalVoyageRouteSafe(snapshot, hull, ordinary, options)).toBe(true);
    let previous = from;
    for (const point of ordinary.points) {
      expect(hullPassageClear(snapshot.map, hull, previous, point)).toBe(true);
      previous = point;
    }
    from = ordinary.points.at(-1)!;
  }
});

it('does not turn an exhausted partial search into a safe completed detour', () => {
  const { snapshot, ship, goal, options } = observedTransit();
  expect(planCoastalVoyage(snapshot, ship, goal, options, 1)?.proof).not.toBe('complete');
  expect(coastalVoyageRouteSafe(snapshot, ship, undefined, options)).toBe(false);
  expect(coastalVoyageRouteSafe(snapshot, ship, { points: [], partial: false }, options)).toBe(false);
  expect(coastalVoyageRouteSafe(snapshot, ship, { points: [{ ...goal, heading: 0 }], partial: true }, options)).toBe(false);
  expect(coastalVoyageRouteSafe(snapshot, ship, { points: ship.sailing!.route!.points }, options)).toBe(false);
});

it('rejects a requested destination inside observed coastal fire instead of accepting a nearby projected endpoint', () => {
  const { snapshot, ship, options } = observedTransit();
  const dragon = snapshot.units.find(unit => unit.id === 'guard-2-0')!;
  expect(planCoastalVoyage(snapshot, ship, dragon, options)).toBeUndefined();
});

it('checks the circular sweep rather than just the straight line between curved waypoints', () => {
  const from = { x: 0, y: 0, heading: 0 }, to = { x: 100, y: 100, heading: Math.PI / 2, curvature: .01 };
  const midpoint = shipPoseAt(from, to, .5), disk = { x: midpoint.x, y: midpoint.y, radius: 4, id: 'fire' };
  expect(routeClearsDisks([from, to], [disk])).toBe(true);
  expect(coastalFireSegmentClear(from, to, [disk])).toBe(false);
});


it('uses the short entrance corner from the real 162300 frame instead of requiring a two-leg shortcut', () => {
  const { snapshot, ship, goal, options } = observedTransit('summoner-battery-muster');
  expect(snapshot.tick).toBe(162300);
  const plan = planCoastalVoyage(snapshot, ship, goal, options)!;
  expect(plan).toBeDefined();
  if (plan.proof !== 'complete') throw new Error('expected complete reference proof');
  expect(plan.reference.at(-1)).toMatchObject(goal);
  expect(coastalVoyageRouteSafe(snapshot, ship, { points: plan.reference, partial: false }, options)).toBe(true);
  expect(Math.hypot(plan.waypoint.x - ship.x, plan.waypoint.y - ship.y)).toBeGreaterThan(250);
  expect(plan.waypoint.y).toBeGreaterThan(6300);
  const hull: Unit = { ...ship, order: { type: 'move', ...plan.waypoint, avoidCombat: true }, orderQueue: [], sailing: { ...ship.sailing! } };
  delete hull.sailing!.route;
  const units = snapshot.units.map(unit => unit.id === ship.id ? hull : unit);
  const route = planVoyageRoute(snapshot.map, hull, plan.waypoint, shipRouteTraffic(snapshot.map, hull, units), 100_000);
  expect(route.partial).toBe(false);
  expect(route.points.at(-1)).toMatchObject(plan.waypoint);
  expect(coastalVoyageRouteSafe(snapshot, hull, route, options)).toBe(true);
});

it('proves only the real native 160800 departure prefix, distinct from a complete ordinary voyage', () => {
  const { snapshot, ship, options } = observedTransit('summoner-distant-battery');
  expect(snapshot.tick).toBe(160800);
  const plan = planCoastalVoyage(snapshot, ship, { x: 2788.6, y: 6752 }, options)!;
  expect(plan.proof).toBe('prefix');
  if (plan.proof !== 'prefix') throw new Error('expected native incremental departure');
  expect(plan.legs).toEqual([]);
  expect(plan).not.toHaveProperty('reference');
  const route = { points: plan.prefix, partial: true };
  expect(coastalVoyagePrefixSafe(snapshot, ship, route, options)).toBe(true);
  expect(coastalVoyageRouteSafe(snapshot, ship, route, options)).toBe(false);
  expect(coastalVoyagePrefixSafe(snapshot, ship, { points: [], partial: true }, options)).toBe(false);
  expect(coastalVoyagePrefixSafe(snapshot, ship, { points: plan.prefix }, options)).toBe(false);
});
