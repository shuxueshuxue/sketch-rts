import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot, Unit } from '../../shared/types';
import { createSeaTravelQuery } from './sea-travel';

function frame() {
  const fixture = JSON.parse(readFileSync(new URL('../bootstrap_1/fixtures/naval-reinforcements-sapphire-25m.json', import.meta.url), 'utf8'));
  const snapshot = fixture.snapshot as GameSnapshot;
  snapshot.map = { id: 'bareDuel', name: 'Sea quote', width: 1000, height: 1000, landmarks: [],
    terrain: { cols: 40, rows: 40, cell: 25, cells: '~'.repeat(1600) }, wind: { direction: Math.PI / 2, speed: 80 } };
  const ship = structuredClone(snapshot.units.find(unit => unit.kind === 'transport')!);
  ship.x = 125; ship.y = 125; ship.sailing = { ...ship.sailing!, heading: 0, load: 0, balance: 0 };
  return { snapshot, ship, from: { x: 125, y: 125 }, to: { x: 875, y: 125 } };
}
const ticks = (quote: ReturnType<ReturnType<typeof createSeaTravelQuery>['travel']>) => {
  expect(quote.status).toBe('known'); if (quote.status !== 'known') throw new Error('Quote not ready'); return quote.ticks;
};
describe('sea leg pricing keyed by its complete computational inputs', () => {
  it('gives exactly the same quote on local/shared hits and forced recalculation, independent of hull identity', () => {
    const { snapshot, ship, from, to } = frame(), query = createSeaTravelQuery(snapshot);
    const first = query.travel(ship, from, to, true), twin = { ...ship, id: 'another-hull-with-the-same-motion' };
    expect(query.travel(twin, from, to, true)).toEqual(first);
    expect(query.stats).toMatchObject({ pricings: 1, localHits: 1, geometryBuilds: 1 });
    const next = createSeaTravelQuery(snapshot);
    expect(next.travel(twin, from, to, true)).toEqual(first);
    expect(next.stats).toMatchObject({ priceHits: 1, pricings: 0, geometryBuilds: 0 });
    expect(createSeaTravelQuery(snapshot, Infinity, 'refresh').travel(twin, from, to, true)).toEqual(first);
  });
  it('invalidates prices for wind, load/helm damage, hull kind and endpoint changes while reusing unchanged basin geometry', () => {
    const { snapshot, ship, from, to } = frame();
    createSeaTravelQuery(snapshot).travel(ship, from, to, true);
    const cases: { world: GameSnapshot; hull: Unit; end: typeof to }[] = [
      { world: { ...snapshot, map: { ...snapshot.map, wind: { direction: Math.PI, speed: 40 } } }, hull: ship, end: to },
      { world: snapshot, hull: { ...ship, sailing: { ...ship.sailing!, load: 900, balance: .2 } }, end: to },
      { world: snapshot, hull: { ...ship, shipParts: { ...ship.shipParts!, rigging: 20, rudder: 20 } }, end: to },
      { world: snapshot, hull: { ...ship, kind: 'warship' }, end: to },
      { world: snapshot, hull: ship, end: { x: 875, y: 375 } },
    ];
    for (const { world, hull, end } of cases) {
      const query = createSeaTravelQuery(world), quote = query.travel(hull, from, end, true);
      expect(quote).toEqual(createSeaTravelQuery(world, Infinity, 'refresh').travel(hull, from, end, true));
      expect(query.stats.pricings).toBe(1); expect(query.stats.priceHits).toBe(0);
    }
  });
  it('keeps live heading in the approach key and aligns future dock legs independently of it', () => {
    const { snapshot, ship, from, to } = frame(), turned = { ...ship, sailing: { ...ship.sailing!, heading: Math.PI } };
    const query = createSeaTravelQuery(snapshot), forward = query.travel(ship, from, to), backward = query.travel(turned, from, to);
    expect(ticks(backward)).toBeGreaterThan(ticks(forward));
    expect(backward).toEqual(createSeaTravelQuery(snapshot, Infinity, 'refresh').travel(turned, from, to));
    expect(query.travel(ship, from, to, true)).toEqual(query.travel(turned, from, to, true));
  });
  it('uses a new namespace for replacement terrain and retains quote age on later identical facts', () => {
    const { snapshot, ship, from, to } = frame(), quote = createSeaTravelQuery(snapshot).travel(ship, from, to, true);
    expect(createSeaTravelQuery({ ...snapshot, tick: snapshot.tick + 15 }).travel(ship, from, to, true)).toEqual(quote);
    const terrain = { ...snapshot.map.terrain!, cells: Array.from({ length: 40 }, (_, row) => '~'.repeat(20) + (row === 30 ? '~' : '.') + '~'.repeat(19)).join('') };
    const changed = { ...snapshot, map: { ...snapshot.map, terrain } }, query = createSeaTravelQuery(changed);
    const detour = query.travel(ship, from, to, true);
    expect(ticks(detour)).toBeGreaterThan(ticks(quote));
    expect(detour).toEqual(createSeaTravelQuery(changed, Infinity, 'refresh').travel(ship, from, to, true));
    expect(query.stats).toMatchObject({ geometryBuilds: 1, pricings: 1, priceHits: 0 });
  });
});
