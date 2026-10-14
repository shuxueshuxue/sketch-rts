import { describe, expect, it } from 'vitest';
import { createMap, createUnit } from './map';
import { detCos, detSin } from './det-math';
import {
  clipToConvex, convexHull, expandConvex, polygonPlanes, polygonSupportingPlanes,
  polygonTouchesCellForPolygon, type Plane, type Point,
} from './navigation-math';
import { SHIP_KINDS, shipProfile } from './ship-geometry';
import { hullFits, type ShipPose } from './ship-navigation';
import { CELL_GROUND } from './terrain';
import type { GameMap, Unit } from './types';

// Independent old complete-projection/SAT reference. It does not populate any
// production cache or use the new lazy query to determine its answer.
function fullPlanes(polygon: readonly Point[]): Plane[] {
  return polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!, x = a.y - b.y, y = b.x - a.x;
    let min = Infinity, max = -Infinity;
    for (const p of polygon) {
      const value = p.x * x + p.y * y;
      min = Math.min(min, value); max = Math.max(max, value);
    }
    return { x, y, min, max };
  });
}
function cellReference(planes: readonly Plane[], left: number, top: number, cell: number) {
  for (const p of planes) {
    const min = (p.x >= 0 ? left : left + cell) * p.x + (p.y >= 0 ? top : top + cell) * p.y;
    const max = min + cell * (Math.abs(p.x) + Math.abs(p.y));
    if (p.max <= min + 1e-7 || max <= p.min + 1e-7) return false;
  }
  return true;
}
function clipReference(planes: readonly Plane[], from: Point, to: Point) {
  let low = 0, high = 1;
  const dx = to.x - from.x, dy = to.y - from.y;
  for (const p of planes) {
    const d = dx * p.x + dy * p.y, need = p.min - from.x * p.x - from.y * p.y;
    if (Math.abs(d) < 1e-10) { if (need > 1e-7) return; continue; }
    if (d > 0) low = Math.max(low, need / d);
    else high = Math.min(high, need / d);
    if (low > high + 1e-9) return;
  }
  return [low, high];
}
function exactPlanes(polygon: readonly Point[], reference: readonly Plane[]) {
  const actual = polygonPlanes(polygon);
  expect(actual.length).toBe(reference.length);
  for (let i = 0; i < reference.length; i++) for (const key of ['x', 'y', 'min', 'max'] as const) {
    if (!Object.is(actual[i]![key], reference[i]![key])) {
      throw new Error(`projection ${i}.${key}: ${actual[i]![key]} != ${reference[i]![key]}`);
    }
  }
  expect(polygonPlanes(polygon)).toBe(actual);
}
function randomOf(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function mixedQueries(polygon: readonly Point[], queries: readonly (readonly [number, number, number])[]) {
  const reference = fullPlanes(polygon);
  const clips = [
    [{ x: -1e6, y: -1e6 }, { x: -2e6, y: -1e6 }],
    [{ x: -1e6, y: 0 }, { x: 1e6, y: 0 }],
    [{ x: -0, y: 0 }, { x: 0, y: -0 }],
  ] as const;
  // Leave a minima-only prefix before SAT, then interleave more clipping and
  // supporting-only requests while maxima may still be only partly complete.
  for (let phase = 0; phase < 3; phase++) {
    const [from, to] = clips[phase]!;
    const actual = clipToConvex(from, to, polygon), old = clipReference(reference, from, to);
    expect(actual === undefined).toBe(old === undefined);
    if (actual && old) for (let i = 0; i < 2; i++) expect(Object.is(actual[i], old[i])).toBe(true);
    for (const [left, top, cell] of queries) {
      expect(polygonTouchesCellForPolygon(polygon, left, top, cell)).toBe(cellReference(reference, left, top, cell));
    }
    if (phase === 1) {
      const supporting = polygonSupportingPlanes(polygon);
      for (let i = 0; i < reference.length; i++) for (const key of ['x', 'y', 'min'] as const) {
        expect(Object.is(supporting[i]![key], reference[i]![key])).toBe(true);
      }
    }
  }
  exactPlanes(polygon, reference);
  for (const [left, top, cell] of queries) {
    expect(polygonTouchesCellForPolygon(polygon, left, top, cell)).toBe(cellReference(reference, left, top, cell));
  }
}

describe('lazy shoreline projections preserve complete geometry queries', () => {
  it('matches the old SAT for rotated fleet hulls, swept hulls and convex padding', () => {
    const random = randomOf(390284);
    for (const kind of SHIP_KINDS) for (let heading = 0; heading < 8; heading++) for (let shape = 0; shape < 3; shape++) {
      const hull = shipProfile(createUnit(kind, 'player', kind, 0, 0))!.hull;
      const angle = heading * Math.PI / 4, offset = heading % 2 ? 8192 : -512;
      const at = (turn: number) => hull.map(p => ({
        x: offset + p.x * detCos(turn) - p.y * detSin(turn),
        y: offset + p.x * detSin(turn) + p.y * detCos(turn),
      }));
      const polygon = shape === 0 ? at(angle) : shape === 1 ? convexHull([...at(angle), ...at(angle + .17)])
        : expandConvex(convexHull([...at(angle), ...at(angle + .43)]), .025);
      const queries: [number, number, number][] = [[offset + 1000, offset + 1000, 32], [offset - 1000, offset - 1000, 32]];
      for (let i = 0; i < 24; i++) queries.push([offset + (random() - .5) * 512, offset + (random() - .5) * 512, i % 2 ? 64 : 32]);
      for (const p of polygon) queries.push([p.x, p.y, 32], [p.x - 32 + 1e-7, p.y - 32 - 1e-7, 32]);
      mixedQueries(polygon, queries);
    }
  });

  it('retains Object.is extrema for extreme scales, thin rings, signed zero and invalid rings', () => {
    const random = randomOf(520972);
    for (const scale of [1e-110, 1e-90, 1e-8, 1, 1e8, 1e90, 1e110]) for (const thin of [1, 1e-9, 1e-14]) {
      const polygon = convexHull(Array.from({ length: 40 }, () => {
        const angle = random() * Math.PI * 2, radius = .3 + random();
        return { x: Math.cos(angle) * radius * scale + scale * 30, y: Math.sin(angle) * radius * scale * thin - scale * 20 };
      }));
      mixedQueries(polygon, [[scale * 30, -scale * 20, scale], [-scale * 100, scale * 100, scale], [-0, 0, 0]]);
    }
    const ring = () => convexHull(Array.from({ length: 16 }, (_, i) =>
      ({ x: Math.cos(i * Math.PI / 8), y: Math.sin(i * Math.PI / 8) })));
    const winding = ring(), ordered = [...winding];
    winding.forEach((_, i) => { winding[i] = ordered[(i * 3) % ordered.length]!; });
    const concave = ring(); concave[5] = { x: 0, y: 0 };
    const flat = ring(); flat[5] = flat[4]!;
    const invalid = ring(); invalid[5] = { x: NaN, y: Infinity };
    const zero = [{ x: -0, y: -0 }, { x: 0, y: 0 }, { x: 1, y: -0 }, { x: 1, y: 1 }];
    for (const polygon of [winding, concave, flat, invalid, zero, [], [{ x: 0, y: 0 }]]) {
      mixedQueries(polygon, [[-2, -2, 1], [-0, 0, 0], [0, -0, 1], [NaN, 0, 1], [Infinity, -Infinity, 1]]);
    }
  });

  it('keeps lazy-first SAT exact when minima and maxima resume before a full consumer', () => {
    for (const kind of SHIP_KINDS) {
      const hull = shipProfile(createUnit(kind, 'player', kind, 0, 0))!.hull;
      const polygon = expandConvex(convexHull(hull.flatMap(p => [p, { x: p.x + 12.34, y: p.y - 7.89 }])), .025);
      const reference = fullPlanes(polygon);
      expect(polygonTouchesCellForPolygon(polygon, -1e4, -1e4, 32)).toBe(cellReference(reference, -1e4, -1e4, 32));
      const from = { x: 1e4, y: -1e4 }, to = { x: 1e4, y: -2e4 };
      expect(clipToConvex(from, to, polygon)).toEqual(clipReference(reference, from, to));
      for (const [left, top] of [[1000, -1000], [-1000, 1000], [-16, -16], [0, 0]]) {
        expect(polygonTouchesCellForPolygon(polygon, left!, top!, 32)).toBe(cellReference(reference, left!, top!, 32));
      }
      exactPlanes(polygon, reference);
    }
  });
});

function hullFitsReference(map: GameMap, ship: Unit, pose: ShipPose) {
  const hull = shipProfile(ship)!.hull, c = detCos(pose.heading), s = detSin(pose.heading);
  const polygon = hull.map(p => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const p of polygon) { left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); }
  if (left < -1e-7 || top < -1e-7 || right > map.width + 1e-7 || bottom > map.height + 1e-7) return false;
  const t = map.terrain;
  if (!t) return true;
  const planes = fullPlanes(polygon);
  for (let row = Math.floor(top / t.cell); row <= Math.floor((bottom - 1e-7) / t.cell); row++)
    for (let col = Math.floor(left / t.cell); col <= Math.floor((right - 1e-7) / t.cell); col++) {
      const char = col < 0 || row < 0 || col >= t.cols || row >= t.rows ? undefined : t.cells[row * t.cols + col];
      if (!CELL_GROUND[char ?? '.']?.sea && cellReference(planes, col * t.cell, row * t.cell, t.cell)) return false;
    }
  return true;
}

it('keeps complete hull-fit answers at coasts, thin channels, cell edges and map corners', () => {
  const random = randomOf(812807), cols = 24, rows = 24, cell = 32;
  const map: GameMap = { ...createMap('bareDuel'), width: cols * cell, height: rows * cell,
    terrain: { cols, rows, cell, cells: Array.from({ length: cols * rows }, (_, at) => {
      const x = at % cols, y = Math.floor(at / cols);
      return x < 3 || y < 3 || x > 20 || y > 20 || x === 10 && y > 6 && y < 18 || x === 17 && y === 17 ? '.' : '~';
    }).join('') } };
  for (const kind of SHIP_KINDS) for (const scale of [.8, 1.1, 1.5]) {
    const ship = createUnit(kind, 'player', kind, 0, 0); ship.deckScale = scale;
    for (let i = 0; i < 256; i++) {
      const pose = { x: random() * map.width, y: random() * map.height, heading: i * Math.PI / 16 };
      expect(hullFits(map, ship, pose)).toBe(hullFitsReference(map, ship, pose));
    }
    for (const x of [0, 96 - 1e-7, 96, 96 + 1e-7, 320, 672, map.width])
      for (const y of [0, 96, 320, 672, map.height]) for (const heading of [0, Math.PI / 2, Math.PI, .31]) {
        const pose = { x, y, heading };
        expect(hullFits(map, ship, pose)).toBe(hullFitsReference(map, ship, pose));
      }
  }
});
