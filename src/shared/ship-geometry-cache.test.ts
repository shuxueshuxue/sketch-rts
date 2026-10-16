import { describe, expect, it } from 'vitest';
import { detCos, detSin } from './det-math';
import { createUnit } from './map';
import { clipToConvex, convexHull, expandConvex, minkowskiSum, pointSegmentDistanceSquared, polygonPlanes, polygonRadius, polygonSupportingPlanes, polygonTouchesCellForPolygon } from './navigation-math';
import { shipTraffic } from './ship-avoidance';
import { SHIP_KINDS, shipProfile, type Point } from './ship-geometry';
import { headingDifference, hullFits, hullPassageClear, shipPoseAt, type ShipPose } from './ship-navigation';
import { beginShipCollisionFrame, physicalSolidOutline, sweepShipCollision } from './ship-collisions';
import { CELL_GROUND, footprintHalf, isWalkable } from './terrain';
import type { Building, GameMap, Unit } from './types';

// ---- Reference: the hull sweep and contact code as it was before its answers were remembered and its swept shapes
// shared (4804631c), verbatim but for names. The cached code must return the same bits for every query.
type SeaMap = Pick<GameMap, 'terrain' | 'width' | 'height' | 'wind'>;
const referenceFields = new WeakMap<object, { cells: string; cols: number; rows: number; sums: Uint32Array }>();
function referenceOpenWaterBox(map: SeaMap, left: number, top: number, right: number, bottom: number) {
  if (left < 0 || top < 0 || right > map.width || bottom > map.height) return false;
  const t = map.terrain;
  if (!t) return true;
  let field = referenceFields.get(t);
  if (!field || field.cells !== t.cells || field.cols !== t.cols || field.rows !== t.rows) {
    const w = t.cols + 1, sums = new Uint32Array(w * (t.rows + 1));
    for (let y = 0; y < t.rows; y++) {
      let row = 0;
      for (let x = 0; x < t.cols; x++) {
        row += CELL_GROUND[t.cells[y * t.cols + x] ?? '.']?.sea ? 0 : 1;
        sums[(y + 1) * w + x + 1] = sums[y * w + x + 1]! + row;
      }
    }
    field = { cells: t.cells, cols: t.cols, rows: t.rows, sums };
    referenceFields.set(t, field);
  }
  const x0 = Math.max(0, Math.floor(left / t.cell)), y0 = Math.max(0, Math.floor(top / t.cell));
  const x1 = Math.min(t.cols, Math.ceil(right / t.cell)), y1 = Math.min(t.rows, Math.ceil(bottom / t.cell)), w = t.cols + 1, s = field.sums;
  return s[y1 * w + x1]! - s[y0 * w + x1]! - s[y1 * w + x0]! + s[y0 * w + x0]! === 0;
}
function referenceCurvedSegment(from: ShipPose, to: ShipPose): number {
  const curvature = to.curvature ?? 0;
  if (Math.abs(curvature) < 1e-9) return 0;
  const x = from.x + (detSin(to.heading) - detSin(from.heading)) / curvature;
  const y = from.y - (detCos(to.heading) - detCos(from.heading)) / curvature;
  return Math.hypot(x - to.x, y - to.y) < 1e-5 ? curvature : 0;
}
function referenceOutline(hull: readonly Point[], pose: ShipPose) {
  const c = detCos(pose.heading), s = detSin(pose.heading);
  return hull.map(p => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
}
function referenceClearOutline(map: SeaMap, polygon: readonly Point[]) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const point of polygon) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
  }
  if (left < -1e-7 || top < -1e-7 || right > map.width + 1e-7 || bottom > map.height + 1e-7) return false;
  const terrain = map.terrain;
  if (!terrain) return true;
  if (referenceOpenWaterBox(map, left, top, right, bottom)) return true;
  const cell = terrain.cell;
  for (let row = Math.floor(top / cell); row <= Math.floor((bottom - 1e-7) / cell); row++)
    for (let col = Math.floor(left / cell); col <= Math.floor((right - 1e-7) / cell); col++) {
      const char = col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows ? undefined : terrain.cells[row * terrain.cols + col];
      if (!CELL_GROUND[char ?? '.']?.sea && polygonTouchesCellForPolygon(polygon, col * cell, row * cell, cell)) return false;
    }
  return true;
}
function referenceHullFits(map: SeaMap, ship: Unit, pose: ShipPose) {
  const profile = shipProfile(ship);
  return Boolean(profile && referenceClearOutline(map, referenceOutline(profile.hull, pose)));
}
function referenceHullPassageClear(map: SeaMap, ship: Unit, from: ShipPose, to: ShipPose) {
  const hull = shipProfile(ship)!.hull;
  const turn = headingDifference(from.heading, to.heading);
  const curvature = referenceCurvedSegment(from, to);
  const hullRadius = polygonRadius(hull);
  const lever = to.pivot ? Math.hypot(from.x - to.pivot.x, from.y - to.pivot.y) : curvature ? 1 / Math.abs(curvature) : 0;
  const radius = hullRadius + lever;
  const pivotArc = !to.pivot || [0, 1].every(fraction => {
    const at = shipPoseAt(from, to, fraction), endpoint = fraction ? to : from;
    return Math.hypot(at.x - endpoint.x, at.y - endpoint.y) < 1e-5;
  });
  const corridorRadius = pivotArc ? hullRadius + lever * turn * turn / 8 + (lever ? 1e-5 : 0) : radius;
  if (referenceOpenWaterBox(map, Math.min(from.x, to.x) - corridorRadius, Math.min(from.y, to.y) - corridorRadius, Math.max(from.x, to.x) + corridorRadius, Math.max(from.y, to.y) + corridorRadius)) return true;
  if (turn && (!referenceHullFits(map, ship, from) || !referenceHullFits(map, ship, to))) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) * Math.sqrt(radius / (8 * .025))));
  const error = turn ? radius * (turn / steps) ** 2 / 8 + 1e-7 : 0;
  for (let i = 0; i < steps; i++) {
    const a = shipPoseAt(from, to, i / steps);
    const b = shipPoseAt(from, to, (i + 1) / steps);
    const envelope = convexHull([...referenceOutline(hull, a), ...referenceOutline(hull, b)]);
    if (!referenceClearOutline(map, error ? expandConvex(envelope, error) : envelope)) return false;
  }
  return true;
}

type Body = Unit | Building;
const unitBody = (body: Body): body is Unit => 'order' in body;
function referenceHullOutline(ship: Unit, pose: ShipPose): Point[] {
  const c = detCos(pose.heading), s = detSin(pose.heading);
  return shipProfile(ship)!.hull.map(p => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
}
function referenceCircleOutline(body: Point & { radius: number }): Point[] {
  const count = 32, radius = body.radius / detCos(Math.PI / count);
  return Array.from({ length: count }, (_, i) => ({ x: body.x + radius * detCos(i * Math.PI * 2 / count), y: body.y + radius * detSin(i * Math.PI * 2 / count) }));
}
function referenceBodyOutline(map: GameMap, body: Body): Point[] {
  return unitBody(body) ? shipProfile(body) ? referenceHullOutline(body, { x: body.x, y: body.y, heading: body.sailing?.heading ?? 0 }) : referenceCircleOutline(body) : physicalSolidOutline(map, body);
}
function referenceActiveBody(map: GameMap, body: Body) {
  return body.hp > 0 && (!unitBody(body) || !body.deck && (shipProfile(body) || isWalkable(map, body.x, body.y, 'land')));
}
function referenceSegmentContact(from: Point, to: Point, polygon: readonly Point[]) {
  const clip = clipToConvex(from, to, polygon);
  if (!clip || clip[0] >= 1 - 1e-8 || clip[1] - clip[0] < 1e-8) return;
  const dx = to.x - from.x, dy = to.y - from.y, mid = (clip[0] + clip[1]) / 2;
  if (polygonPlanes(polygon).some(p => (from.x + dx * mid) * p.x + (from.y + dy * mid) * p.y <= p.min + 1e-6)) return;
  const planes = polygonPlanes(polygon);
  let distance = Infinity;
  const gaps: { plane: typeof planes[number]; gap: number }[] = [];
  for (const plane of planes) {
    const length = Math.hypot(plane.x, plane.y), at = { x: from.x + dx * clip[0], y: from.y + dy * clip[0] };
    const gap = Math.abs(at.x * plane.x + at.y * plane.y - plane.min) / length;
    gaps.push({ plane, gap }); distance = Math.min(distance, gap);
  }
  const combined = { x: 0, y: 0 };
  for (const { plane, gap } of gaps) if (gap <= distance + 1e-6) {
    const length = Math.hypot(plane.x, plane.y); combined.x += plane.x / length; combined.y += plane.y / length;
  }
  const length = Math.hypot(combined.x, combined.y);
  if (length < 1e-8) return;
  const normal = { x: combined.x / length, y: combined.y / length };
  if (clip[0] <= 1e-8 && dx * normal.x + dy * normal.y <= 1e-8) return;
  return { fraction: Math.max(0, clip[0]), normal };
}
function referenceSupportPoint(polygon: readonly Point[], normal: Point) {
  let best = -Infinity, x = 0, y = 0, count = 0;
  for (const p of polygon) {
    const dot = p.x * normal.x + p.y * normal.y;
    if (dot > best + 1e-5) { best = dot; x = p.x; y = p.y; count = 1; }
    else if (Math.abs(dot - best) <= 1e-5) { x += p.x; y += p.y; count++; }
  }
  return { x: x / count, y: y / count };
}
type Contact = { fraction: number; normal: Point; point: Point; other?: Body; kind: string };
function referenceSweepShape(ship: Unit, from: ShipPose, to: ShipPose, bodyPolygon: readonly Point[]): Omit<Contact, 'kind'> | undefined {
  const radius = polygonRadius(shipProfile(ship)!.hull), turn = headingDifference(from.heading, to.heading);
  const lever = to.pivot ? Math.hypot(from.x - to.pivot.x, from.y - to.pivot.y) : 0;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) * Math.sqrt((radius + lever) / (8 * .025))));
  for (let i = 0; i < steps; i++) {
    const a = shipPoseAt(from, to, i / steps), b = shipPoseAt(from, to, (i + 1) / steps);
    const shape = convexHull([...referenceHullOutline(ship, { ...a, x: 0, y: 0 }), ...referenceHullOutline(ship, { ...b, x: 0, y: 0 })]);
    const error = turn ? (radius + lever) * (turn / steps) ** 2 / 8 + 1e-7 : 0;
    const configuration = minkowskiSum(bodyPolygon, (error ? expandConvex(shape, error) : shape).map(p => ({ x: -p.x, y: -p.y })));
    let contact = referenceSegmentContact(a, b, configuration);
    if (!contact && Math.abs(turn) > 1e-8) {
      const inside = polygonPlanes(configuration).every(p => a.x * p.x + a.y * p.y > p.min + 1e-6);
      const before = minkowskiSum(bodyPolygon, referenceHullOutline(ship, { ...a, x: 0, y: 0 }).map(p => ({ x: -p.x, y: -p.y })));
      if (inside && !polygonPlanes(before).every(p => a.x * p.x + a.y * p.y > p.min + 1e-6)) {
        const plane = polygonPlanes(configuration).reduce((best, p) => (a.x * p.x + a.y * p.y - p.min) / Math.hypot(p.x, p.y) < (a.x * best.x + a.y * best.y - best.min) / Math.hypot(best.x, best.y) ? p : best);
        const length = Math.hypot(plane.x, plane.y); contact = { fraction: 0, normal: { x: plane.x / length, y: plane.y / length } };
      }
    }
    if (!contact) continue;
    const fraction = (i + contact.fraction) / steps, pose = shipPoseAt(from, to, fraction);
    const own = referenceSupportPoint(referenceHullOutline(ship, pose), contact.normal), other = referenceSupportPoint(bodyPolygon, { x: -contact.normal.x, y: -contact.normal.y });
    return { fraction, normal: contact.normal, point: { x: (own.x + other.x) / 2, y: (own.y + other.y) / 2 } };
  }
}
function referenceTerrainContact(map: GameMap, ship: Unit, from: ShipPose, to: ShipPose): Contact | undefined {
  const radius = polygonRadius(shipProfile(ship)!.hull), terrain = map.terrain;
  const left = Math.min(from.x, to.x) - radius, right = Math.max(from.x, to.x) + radius;
  const top = Math.min(from.y, to.y) - radius, bottom = Math.max(from.y, to.y) + radius;
  const polygons: Point[][] = [];
  if (terrain) {
    for (let row = Math.max(0, Math.floor(top / terrain.cell)); row <= Math.min(terrain.rows - 1, Math.floor(bottom / terrain.cell)); row++)
      for (let col = Math.max(0, Math.floor(left / terrain.cell)); col <= Math.min(terrain.cols - 1, Math.floor(right / terrain.cell)); col++) {
        if (CELL_GROUND[terrain.cells[row * terrain.cols + col] ?? '.']?.sea) continue;
        const x = col * terrain.cell, y = row * terrain.cell, c = terrain.cell;
        polygons.push([{ x, y }, { x: x + c, y }, { x: x + c, y: y + c }, { x, y: y + c }]);
      }
  }
  const margin = radius * 2 + Math.hypot(to.x - from.x, to.y - from.y) + 1;
  if (left < 0) polygons.push([{ x: -margin, y: -margin }, { x: 0, y: -margin }, { x: 0, y: map.height + margin }, { x: -margin, y: map.height + margin }]);
  if (right > map.width) polygons.push([{ x: map.width, y: -margin }, { x: map.width + margin, y: -margin }, { x: map.width + margin, y: map.height + margin }, { x: map.width, y: map.height + margin }]);
  if (top < 0) polygons.push([{ x: -margin, y: -margin }, { x: map.width + margin, y: -margin }, { x: map.width + margin, y: 0 }, { x: -margin, y: 0 }]);
  if (bottom > map.height) polygons.push([{ x: -margin, y: map.height }, { x: map.width + margin, y: map.height }, { x: map.width + margin, y: map.height + margin }, { x: -margin, y: map.height + margin }]);
  let best: Contact | undefined;
  for (const polygon of polygons) { const contact = referenceSweepShape(ship, from, to, polygon); if (contact && (!best || contact.fraction < best.fraction)) best = { ...contact, kind: 'terrain' }; }
  return best;
}
// The collision frame's 192-unit buckets: a body enters the query when its padded bounds share a bucket with the path's.
function referenceNearby(map: GameMap, body: Body, from: ShipPose, to: ShipPose, radius: number) {
  const profile = unitBody(body) && shipProfile(body);
  const own = (profile ? polygonRadius(profile.hull) : unitBody(body) ? body.radius * 1.01 : Math.SQRT2 * footprintHalf(body.radius, map.terrain!.cell)) + 24;
  const span = (low: number, high: number) => [Math.floor(low / 192), Math.floor(high / 192)] as const;
  const [bodyLeft, bodyRight] = span(body.x - own, body.x + own), [bodyTop, bodyBottom] = span(body.y - own, body.y + own);
  const [left, right] = span(Math.min(from.x, to.x) - radius, Math.max(from.x, to.x) + radius);
  const [top, bottom] = span(Math.min(from.y, to.y) - radius, Math.max(from.y, to.y) + radius);
  return bodyLeft <= right && left <= bodyRight && bodyTop <= bottom && top <= bodyBottom;
}
function referenceSweepShipCollision(map: GameMap, ship: Unit, bodies: readonly Body[], from: ShipPose, to: ShipPose): Contact | undefined {
  let best: Contact | undefined;
  const radius = polygonRadius(shipProfile(ship)!.hull);
  for (const body of [...bodies].sort((a, b) => a.id.localeCompare(b.id))) {
    if (body === ship || !referenceActiveBody(map, body) || unitBody(body) && body.deck || !referenceNearby(map, body, from, to, radius)) continue;
    const contact = referenceSweepShape(ship, from, to, referenceBodyOutline(map, body));
    const kind = unitBody(body) ? shipProfile(body) ? 'ship' : 'unit' : 'building';
    if (contact && (!best || contact.fraction < best.fraction - 1e-8)) best = { ...contact, other: body, kind };
  }
  if (!referenceHullPassageClear(map, ship, from, to)) {
    const contact = referenceTerrainContact(map, ship, from, to);
    if (contact && (!best || contact.fraction < best.fraction)) best = contact;
    if (!best) {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      best = { fraction: 0, normal: { x: length ? (to.x - from.x) / length : 0, y: length ? (to.y - from.y) / length : 0 }, point: { x: from.x, y: from.y }, kind: 'terrain' };
    }
  }
  return best;
}

// The traffic view as it was before its own-hull sweeps were shared across views (4804631c), verbatim but for names.
const referenceTrafficShapes = new Map<string, Point[]>(), referenceTrafficBases = new Map<string, Point[]>();
let referenceTrafficBasePoints = 0;
function referenceCacheTrafficBase(key: string, polygon: Point[]) {
  if (polygon.length > 16_384) return;
  while (referenceTrafficBases.size >= 512 || referenceTrafficBasePoints + polygon.length > 16_384) {
    const oldest = referenceTrafficBases.keys().next().value!;
    referenceTrafficBasePoints -= referenceTrafficBases.get(oldest)!.length; referenceTrafficBases.delete(oldest);
  }
  referenceTrafficBases.set(key, polygon); referenceTrafficBasePoints += polygon.length;
}
function referenceShipTraffic(ship: Unit, units: readonly Unit[], range = 600) {
  const ownProfile = shipProfile(ship)!, hull = ownProfile.hull, radius = polygonRadius(hull);
  const bodies = [] as { other: Unit; center: Point; radius: number; profile: NonNullable<ReturnType<typeof shipProfile>>; heading: number; outline?: Point[] }[];
  for (const other of units) {
    if (!shipProfile(other) || other === ship || other.hp <= 0 || Math.hypot(other.x - ship.x, other.y - ship.y) >= range) continue;
    const profile = shipProfile(other)!;
    bodies.push({ other, center: { x: other.x, y: other.y }, radius: polygonRadius(profile.hull), profile, heading: other.sailing?.heading ?? 0 });
  }
  const configurations = new Map<string, Point[]>(), sweeps = new Map<string, Point[]>();
  const configuration = (from: number, to: number, body: typeof bodies[number], padding: number) => {
    const key = `${from}:${to}:${body.other.id}:${padding}`, known = configurations.get(key); if (known) return known;
    const profile = body.profile, angle = body.heading;
    const baseKey = `${ship.kind}:${ownProfile.length}:${from}:${to}:${body.other.kind}:${profile.length}:${angle}`;
    const shapeKey = `${baseKey}:${padding}`;
    let polygon = referenceTrafficShapes.get(shapeKey);
    if (!polygon) {
      let base = referenceTrafficBases.get(baseKey);
      if (!base) {
        const sweepKey = `${from}:${to}`; let negative = sweeps.get(sweepKey);
        if (!negative) {
          const turn = headingDifference(from, to), steps = Math.max(1, Math.ceil(Math.abs(turn) * radius / 4)), points: Point[] = [];
          for (let i = 0; i <= steps; i++) {
            const heading = from + turn * i / steps, c = detCos(heading), s = detSin(heading);
            for (const p of hull) points.push({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
          }
          let shape = convexHull(points); if (turn) shape = expandConvex(shape, radius * (turn / steps) ** 2 / 8 + 1e-7);
          negative = shape.map(p => ({ x: -p.x, y: -p.y })); sweeps.set(sweepKey, negative);
        }
        if (!body.outline) { const c = detCos(angle), s = detSin(angle); body.outline = profile.hull.map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c })); }
        base = minkowskiSum(body.outline, negative); referenceCacheTrafficBase(baseKey, base);
      }
      polygon = padding ? expandConvex(base, padding) : base;
      if (referenceTrafficShapes.size >= 512) referenceTrafficShapes.delete(referenceTrafficShapes.keys().next().value!); referenceTrafficShapes.set(shapeKey, polygon);
    }
    configurations.set(key, polygon); return polygon;
  };
  const interior = (x: number, y: number, polygon: readonly Point[]) => {
    for (const p of polygonSupportingPlanes(polygon)) if (!(x * p.x + y * p.y > p.min + 1e-6)) return false;
    return true;
  };
  const start = { x: 0, y: 0 }, end = { x: 0, y: 0 };
  let curves: Map<string, boolean> | undefined;
  const clear = (from: ShipPose, to: ShipPose, padding = 0): boolean => {
    if (!bodies.length) return true;
    if (to.pivot || Math.abs(to.curvature ?? 0) > 1e-9) {
      const key = `${from.x}:${from.y}:${from.heading}:${to.x}:${to.y}:${to.heading}:${to.curvature}:${to.pivot?.x}:${to.pivot?.y}:${padding}`;
      const known = curves?.get(key); if (known !== undefined) return known;
      const turn = headingDifference(from.heading, to.heading), lever = to.pivot ? Math.hypot(from.x - to.pivot.x, from.y - to.pivot.y) : 1 / Math.abs(to.curvature!);
      const steps = Math.max(1, Math.ceil(Math.abs(turn) * Math.sqrt((radius + lever) / (8 * .025))));
      const error = lever * (turn / steps) ** 2 / 8 + 1e-7;
      let result = true;
      for (let i = 0; i < steps; i++) if (!clear(shipPoseAt(from, to, i / steps), shipPoseAt(from, to, (i + 1) / steps), error)) { result = false; break; }
      curves ??= new Map(); if (curves.size >= 256) curves.delete(curves.keys().next().value!); curves.set(key, result);
      return result;
    }
    const dx = to.x - from.x, dy = to.y - from.y, turn = headingDifference(from.heading, to.heading);
    for (const body of bodies) {
      if (pointSegmentDistanceSquared(body.center, from, to) > (radius + body.radius + padding) ** 2) continue;
      const polygon = configuration(from.heading, to.heading, body, padding);
      start.x = from.x - body.center.x; start.y = from.y - body.center.y; end.x = to.x - body.center.x; end.y = to.y - body.center.y;
      const clip = clipToConvex(start, end, polygon); if (!clip || clip[1] - clip[0] < 1e-7) continue;
      const middle = (clip[0] + clip[1]) / 2;
      if (!interior(start.x + dx * middle, start.y + dy * middle, polygon)) continue;
      if (!(Math.abs(turn) < 1e-7 && clip[0] <= 1e-7 && dx * (from.x - body.center.x) + dy * (from.y - body.center.y) > 0)) return false;
    }
    return true;
  };
  return clear;
}

// ---- Scenarios: a coast of islands, shallows and map edges, with hulls, crews and buildings close by.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function coast(next: () => number): GameMap {
  const cols = 48, rows = 48, islands = Array.from({ length: 9 }, () => ({ x: next() * cols, y: next() * rows, r: 2 + next() * 5 }));
  let cells = '';
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const inside = islands.reduce((most, island) => Math.max(most, island.r - Math.hypot(col + .5 - island.x, row + .5 - island.y)), -Infinity);
    cells += inside > 1 ? '.' : inside > 0 ? ',' : '~';
  }
  return { width: cols * 32, height: rows * 32, terrain: { cell: 32, cols, rows, cells } } as GameMap;
}
// Repeated headings (and -0) exercise every remembered shape; the rest are arbitrary.
const HEADINGS = [0, -0, Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI, 2.5];
function heading(next: () => number) {
  return next() < .5 ? HEADINGS[Math.floor(next() * HEADINGS.length)]! : (next() * 2 - 1) * Math.PI;
}
function motion(next: () => number, from: ShipPose, length: number): ShipPose {
  const kind = Math.floor(next() * 5), turn = (next() * 2 - 1) * (next() < .3 ? Math.PI / 2 : .2);
  if (kind === 0) {
    const step = (next() * 2 - 1) * 24;
    return { x: from.x + step * detCos(from.heading), y: from.y + step * detSin(from.heading), heading: from.heading };
  }
  if (kind === 1) return { ...from, heading: from.heading + turn };
  if (kind === 2) {
    const lever = (next() < .5 ? 1 : -1) * length / 2;
    const pivot = { x: from.x - lever * detCos(from.heading), y: from.y - lever * detSin(from.heading) }, end = from.heading + turn;
    return { x: pivot.x + lever * detCos(end), y: pivot.y + lever * detSin(end), heading: end, pivot };
  }
  if (kind === 3) {
    const curvature = (next() < .5 ? 1 : -1) / (length * (.65 + next())), end = from.heading + turn;
    return { x: from.x + (detSin(end) - detSin(from.heading)) / curvature, y: from.y - (detCos(end) - detCos(from.heading)) / curvature, heading: end, curvature };
  }
  return { x: from.x + (next() * 2 - 1) * 96, y: from.y + (next() * 2 - 1) * 96, heading: from.heading + turn, ...(next() < .5 ? { curvature: 0 } : {}) };
}

describe('remembered hull sweeps and shared swept shapes', () => {
  it('answer every coastal passage and fit exactly as the original sweep, including repeated queries', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const next = random(seed), map = coast(next);
      const queries: { ship: Unit; from: ShipPose; to: ShipPose }[] = [];
      for (let i = 0; i < 220; i++) {
        const ship = createUnit(`s${i}`, 'player', SHIP_KINDS[Math.floor(next() * SHIP_KINDS.length)]!, 0, 0);
        const from = { x: 80 + next() * (map.width - 160), y: 80 + next() * (map.height - 160), heading: heading(next) };
        queries.push({ ship, from, to: motion(next, from, shipProfile(ship)!.length) });
      }
      // Forward, then shuffled repeats: later answers come from the memo.
      const order = [...queries, ...queries.map((query, i) => queries[(i * 97) % queries.length]!)];
      for (const { ship, from, to } of order) {
        expect(hullPassageClear(map, ship, from, to)).toBe(referenceHullPassageClear(map, ship, from, to));
        expect(hullFits(map, ship, to)).toBe(referenceHullFits(map, ship, to));
        // A copy of the same pose with a different hull object reads the same answer.
        const twin = createUnit(`${ship.id}-twin`, 'player', ship.kind, 0, 0);
        expect(hullPassageClear(map, twin, { ...from }, { ...to })).toBe(referenceHullPassageClear(map, ship, from, to));
      }
    }
  });

  it('clear the same traffic passages as views that each swept their own hull', () => {
    let blocked = 0, total = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const next = random(200 + seed);
      for (let round = 0; round < 24; round++) {
        const kind = () => SHIP_KINDS[Math.floor(next() * SHIP_KINDS.length)]!;
        const ship = createUnit(`own-${round}`, 'player', kind(), 2000, 2000);
        ship.sailing = { heading: heading(next), speed: 0, load: 0, balance: 0 };
        const units = [ship];
        for (let i = 0; i < 5; i++) {
          const other = createUnit(`traffic-${round}-${i}`, 'enemy', kind(), 2000 + (next() * 2 - 1) * 320, 2000 + (next() * 2 - 1) * 320);
          other.sailing = { heading: heading(next), speed: 0, load: 0, balance: 0 };
          units.push(other);
        }
        const length = shipProfile(ship)!.length;
        // Later views read the sweeps an earlier view computed.
        for (let view = 0; view < 3; view++) {
          const actual = shipTraffic(ship, units), expected = referenceShipTraffic(ship, units);
          for (let query = 0; query < 24; query++) {
            const lattice = next() < .5, at = { x: 2000 + (next() * 2 - 1) * 160, y: 2000 + (next() * 2 - 1) * 160 };
            const from = { ...at, heading: lattice ? Math.floor(next() * 8) * Math.PI / 4 : heading(next) };
            const to = lattice ? (next() < .5 ? { ...from, heading: from.heading + (next() < .5 ? 1 : -1) * Math.PI / 4 }
              : { x: from.x + 32 * detCos(from.heading), y: from.y + 32 * detSin(from.heading), heading: from.heading }) : motion(next, from, length);
            const padding = next() < .3 ? next() * 4 : 0;
            const clear = expected(from, to, padding);
            expect(actual(from, to, padding)).toBe(clear);
            total++; if (!clear) blocked++;
          }
        }
      }
    }
    expect(blocked).toBeGreaterThan(100);
    expect(total - blocked).toBeGreaterThan(100);
  });

  it('find the same first contact, normal and point as the original per-body sweep', () => {
    let contacts = 0, terrain = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const next = random(100 + seed), map = coast(next);
      for (let round = 0; round < 20; round++) {
        const center = { x: 160 + next() * (map.width - 320), y: 160 + next() * (map.height - 320) };
        const units: Unit[] = [], solids: Building[] = [];
        const ship = createUnit(`ship-${round}`, 'player', SHIP_KINDS[Math.floor(next() * SHIP_KINDS.length)]!, center.x, center.y);
        ship.sailing = { heading: heading(next), speed: 0, load: 0, balance: 0 };
        units.push(ship);
        for (let i = 0; i < 4; i++) {
          const other = createUnit(`other-${round}-${i}`, 'enemy', SHIP_KINDS[Math.floor(next() * SHIP_KINDS.length)]!, center.x + (next() * 2 - 1) * 200, center.y + (next() * 2 - 1) * 200);
          other.sailing = { heading: heading(next), speed: 0, load: 0, balance: 0 };
          units.push(other);
        }
        for (let i = 0; i < 6; i++) units.push(createUnit(`crew-${round}-${i}`, 'player', 'footman', center.x + (next() * 2 - 1) * 160, center.y + (next() * 2 - 1) * 160));
        for (let i = 0; i < 2; i++) solids.push({ id: `yard-${round}-${i}`, owner: 'player', kind: 'shipyard', x: center.x + (next() * 2 - 1) * 180, y: center.y + (next() * 2 - 1) * 180, radius: 24 + next() * 40, hp: 100, maxHp: 100 } as Building);
        const length = shipProfile(ship)!.length;
        for (let move = 0; move < 12; move++) {
          beginShipCollisionFrame(units, map, solids);
          const from = { x: ship.x, y: ship.y, heading: ship.sailing.heading }, to = motion(next, from, length);
          const actual = sweepShipCollision(map, ship, units, from, to);
          const expected = referenceSweepShipCollision(map, ship, [...units, ...solids], from, to);
          expect(actual).toEqual(expected);
          // The same motion again reads every shared shape from the remembered copies.
          expect(sweepShipCollision(map, ship, units, from, to)).toEqual(expected);
          if (expected) { contacts++; if (expected.kind === 'terrain') terrain++; }
          else { ship.x = to.x; ship.y = to.y; ship.sailing.heading = to.heading; }
        }
      }
    }
    // Both kinds of contact are part of the comparison, not only clear water.
    expect(contacts).toBeGreaterThan(100);
    expect(terrain).toBeGreaterThan(20);
  });
});
