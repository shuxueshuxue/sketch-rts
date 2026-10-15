import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { setBuildingBodies } from './terrain';
import { reservationTraffic, shipTraffic } from './ship-avoidance';
import { shipSolidTraffic, sweepShipCollision } from './ship-collisions';
import { hullPassageClear, planShipRoute } from './ship-navigation';
import { canBoard } from './decks';
import { decksCanTransfer } from './connected-decks';
import type { ShipPose } from './ship-navigation';
import type { GameSnapshot } from './types';

const capturedDepartureEdges: { name: string; from: ShipPose; to: ShipPose }[] = [
  { name: 'translation', from: { x: 9136, y: 5296, heading: 0 }, to: { x: 9104, y: 5296, heading: 0 } },
  { name: 'in-place rotation', from: { x: 9136, y: 5296, heading: Math.PI / 4 }, to: { x: 9136, y: 5296, heading: Math.PI / 2 } },
];

for (const { name, from, to } of capturedDepartureEdges) {
  it(`checks the live hull at the real rounded-origin ${name} search edge`, () => {
    const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-repair-origin-68400.json.gz', import.meta.url))).toString());
    const snapshot: GameSnapshot = saved.snapshot;
    const ship = snapshot.units.find(unit => unit.id === 'unit-p0-cutter-1139')!;
    const before = JSON.stringify(snapshot);
    expect(ship.y).toBe(5296.000000000001);
    expect(from.y).not.toBe(ship.y);
    expect(from.heading).not.toBe(ship.sailing!.heading);
    const reserved = reservationTraffic(ship, snapshot.units);
    expect(reserved.hasTraffic).toBe(true);
    // These are captured planShipRoute callbacks, including omitted padding.
    expect(shipTraffic(ship, snapshot.units)(from, to)).toBe(false);
    expect(reserved(from, to)).toBe(false);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
}

for (const tick of [68400, 85866]) for (const id of ['unit-p0-cutter-1139', 'unit-p0-warship-1935']) {
  it(`starts the real ${tick} ${id} repair rendezvous clear of its partner's current hull`, () => {
    const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/knight-repair-origin-${tick}.json.gz`, import.meta.url))).toString());
    const snapshot: GameSnapshot = saved.snapshot;
    setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
    const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-1851')!;
    const source = snapshot.units.find(unit => unit.id === worker.deck!.shipId)!;
    const receiver = snapshot.units.find(unit => unit.id === 'unit-p0-warship-1935')!;
    expect(canBoard(receiver, worker, snapshot.units)).toBe(true);
    expect(decksCanTransfer(source, receiver, worker)).toBe(false);
    const ship = snapshot.units.find(unit => unit.id === id)!;
    if (ship.order.type !== 'move') throw new Error('fixture must retain the native rendezvous helm');
    const before = JSON.stringify(snapshot);
    const reserved = reservationTraffic(ship, snapshot.units);
    const solids = shipSolidTraffic(snapshot.map, ship, snapshot.units);
    const traffic = Object.assign((from: Parameters<typeof reserved>[0], to: Parameters<typeof reserved>[1], padding?: number) =>
      reserved(from, to, padding) && solids(from, to), { hasTraffic: reserved.hasTraffic || solids.hasTraffic });
    const route = planShipRoute(snapshot.map, ship, ship.order, traffic, 1024);
    expect(route.points.length).toBeGreaterThan(0);
    const start = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    const first = route.points[0]!;
    expect(hullPassageClear(snapshot.map, ship, start, first)).toBe(true);
    expect(shipTraffic(ship, snapshot.units)(start, first)).toBe(true);
    expect(sweepShipCollision(snapshot.map, ship, snapshot.units, start, first)).toBeUndefined();
    expect(JSON.stringify(snapshot)).toBe(before);
  });
}
