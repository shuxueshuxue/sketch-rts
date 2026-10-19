import { detCos, detSin } from './det-math';
import { clipToConvex, convexHull, expandConvex, insideSupportingPlanes, minkowskiSum, pointSegmentDistanceSquared, polygonPlanes, polygonRadius } from './navigation-math';
import { bodyMass } from './physical-body';
import { isShipKind, shipProfile, type Point } from './ship-geometry';
import { exactKey, headingDifference, hullPassageClear, shipPoseAt, type ShipPose } from './ship-navigation';
import { CELL_GROUND, footprintHalf, isWalkable } from './terrain';
import { SIM_TICKS_PER_SECOND } from './time';
import type { Building, GameMap, Obstacle, Unit } from './types';

type Body = Unit | Building | Obstacle;
type Solid = Building | Obstacle;
type ContactKind = 'ship' | 'unit' | 'building' | 'obstacle' | 'terrain';
type Contact = { fraction: number; normal: Point; point: Point; other?: Body; kind: ContactKind };
/** Damage is proposed here; the simulation applies its usual armor, cabin and death rules. */
export type ShipCollisionImpact = Contact & { ship: Unit; closingSpeed: number; energy: number; shipDamage: number; otherDamage: number };
type Entry = { body: Body; radius: number; keys: number[]; left: number; right: number; top: number; bottom: number };
type Frame = { map?: GameMap; hasShips: boolean; buckets: Map<number, Set<Entry>>; shipBuckets: Map<number, Set<Entry>>; entries: Map<Body, Entry>; velocities: Map<Body, Point>; yawRates: Map<Unit, number>; impacts: ShipCollisionImpact[]; hitPairs: Set<string>; inTheWay: Set<Unit> };
const frames = new WeakMap<readonly Unit[], Frame>();
// Planning reads the very same static bodies as physical motion. Maps in AI
// snapshots register their own bodies, so later damage cannot change a saved view.
type SolidSource = { bodies: readonly Solid[]; cell?: number | undefined; seen?: { x: number; y: number; radius: number; alive: boolean }[]; outlines?: Point[][] };
const solidSources = new WeakMap<GameMap, SolidSource>();
const noSolids: Point[][] = [];
export function setShipCollisionSolids(map: GameMap, solids: readonly Solid[]) {
  solidSources.set(map, { bodies: solids });
}
export function shipCollisionMap(units: readonly Unit[]) { return frames.get(units)?.map; }
export function freezeShipCollisionSolids(map: GameMap, center?: Point, range=Infinity): Point[][] {
  const source = solidSources.get(map);
  if (!source) return noSolids;
  if (!source.seen || source.cell !== map.terrain?.cell || source.bodies.length !== source.seen.length || source.bodies.some((body, i) => {
    const seen = source.seen![i]!;
    return body.x !== seen.x || body.y !== seen.y || body.radius !== seen.radius || (body.hp > 0) !== seen.alive;
  })) {
    source.cell = map.terrain?.cell;
    source.seen = source.bodies.map(body => ({ x: body.x, y: body.y, radius: body.radius, alive: body.hp > 0 }));
    source.outlines = source.bodies.filter(body => body.hp > 0).map(body => physicalSolidOutline(map, body));
  }
  // Replaced whole on change: existing searches retain their immutable view.
  if (!center || !Number.isFinite(range)) return source.outlines!;
  // These are the physical axis-aligned square footprints. Include a body
  // when any of its footprint enters the caller's planning neighborhood.
  return source.outlines!.filter(polygon => {
    const left = polygon[0]!, right = polygon[2]!;
    const dx = Math.max(left.x-center.x,center.x-right.x,0), dy = Math.max(left.y-center.y,center.y-right.y,0);
    return dx*dx+dy*dy <= range*range;
  });
}
const CELL = 192;
// A bucket's key packs its column and row into one integer (2^20 cells either way of the origin, far past any map):
// every body is filed again each tick, and printing "x,y" for each of its cells was most of a frame's cost.
const cellKey = (x: number, y: number) => (x + 1048576) * 2097152 + (y + 1048576);
/** Gentle mooring, stationary contact and matching velocities do not wear down hulls. */
export const SHIP_IMPACT_SAFE_SPEED = 10;

function unitBody(body: Body): body is Unit { return 'order' in body; }
function kindOf(body: Body): ContactKind { return unitBody(body) ? shipProfile(body) ? 'ship' : 'unit' : 'along' in body ? 'obstacle' : 'building'; }
function activeBody(map: GameMap, body: Body) {
  return body.hp > 0 && (!unitBody(body) || !body.deck && (shipProfile(body) || isWalkable(map, body.x, body.y, 'land')));
}
function velocity(body: Body): Point {
  if (!unitBody(body)) return { x: 0, y: 0 };
  const motion = body.sailing, speed = motion?.speed ?? 0, heading = motion?.heading ?? 0;
  // Last tick's travel to a contact is not momentum after the collision stopped it.
  if (motion && speed <= 1e-7 && body.pushX === undefined) return { x: 0, y: 0 };
  return { x: motion?.velocityX ?? speed * detCos(heading) + (body.pushX ?? 0), y: motion?.velocityY ?? speed * detSin(heading) + (body.pushY ?? 0) };
}
/** Retained hull momentum at a world-space seam, including rotational motion.
 * Recorded world velocity already includes shove displacement. After a stop,
 * last tick's travel to contact must not keep an otherwise still hull moving. */
export function shipPointVelocity(ship: Unit, point: Point, linear = velocity(ship), yawRate = ship.sailing?.yawRate ?? 0): Point {
  return { x: linear.x - yawRate * (point.y - ship.y), y: linear.y + yawRate * (point.x - ship.x) };
}
/** Buildings and destructible obstacles occupy the same square footprint as ground routing. */
export function physicalSolidOutline(map: Pick<GameMap, 'terrain'>, body: Solid): Point[] {
  const half = map.terrain ? footprintHalf(body.radius, map.terrain.cell) : body.radius;
  return [{ x: body.x - half, y: body.y - half }, { x: body.x + half, y: body.y - half }, { x: body.x + half, y: body.y + half }, { x: body.x - half, y: body.y + half }];
}
// Every circle shares the same 32 unit directions and circumscribing scale.
const CIRCLE_SIDES = 32, CIRCLE_SCALE = detCos(Math.PI / CIRCLE_SIDES);
const CIRCLE_DIRECTIONS = Array.from({ length: CIRCLE_SIDES }, (_, i) => ({ x: detCos(i * Math.PI * 2 / CIRCLE_SIDES), y: detSin(i * Math.PI * 2 / CIRCLE_SIDES) }));
function circleOutline(body: Point & { radius: number }): Point[] {
  // Circumscribed edges keep the true circular body inside the approximation.
  const radius = body.radius / CIRCLE_SCALE;
  return CIRCLE_DIRECTIONS.map(direction => ({ x: body.x + radius * direction.x, y: body.y + radius * direction.y }));
}
function hullOutline(ship: Unit, pose: ShipPose): Point[] {
  const c = detCos(pose.heading), s = detSin(pose.heading);
  return shipProfile(ship)!.hull.map(p => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
}
function outline(map: GameMap, body: Body): Point[] {
  return unitBody(body) ? shipProfile(body) ? hullOutline(body, { x: body.x, y: body.y, heading: body.sailing?.heading ?? 0 }) : circleOutline(body) : physicalSolidOutline(map, body);
}
function radiusOf(map: GameMap | undefined, body: Body) {
  const profile = unitBody(body) && shipProfile(body);
  return profile ? polygonRadius(profile.hull) : unitBody(body) ? body.radius * 1.01 : Math.SQRT2 * (map?.terrain ? footprintHalf(body.radius, map.terrain.cell) : body.radius);
}
function updateEntry(frame: Frame, entry: Entry) {
  const { body } = entry, radius = entry.radius + 24;
  const left = Math.floor((body.x - radius) / CELL), right = Math.floor((body.x + radius) / CELL), top = Math.floor((body.y - radius) / CELL), bottom = Math.floor((body.y + radius) / CELL);
  if (entry.left === left && entry.right === right && entry.top === top && entry.bottom === bottom) return;
  const ship = unitBody(body) && shipProfile(body);
  for (const key of entry.keys) {
    const bucket = frame.buckets.get(key); bucket?.delete(entry); if (bucket?.size === 0) frame.buckets.delete(key);
    if (ship) { const ships = frame.shipBuckets.get(key); ships?.delete(entry); if (ships?.size === 0) frame.shipBuckets.delete(key); }
  }
  entry.keys = []; entry.left = left; entry.right = right; entry.top = top; entry.bottom = bottom;
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const key = cellKey(x, y); let bucket = frame.buckets.get(key);
      if (!bucket) frame.buckets.set(key, bucket = new Set());
      bucket.add(entry); entry.keys.push(key);
      if (ship) { let ships = frame.shipBuckets.get(key); if (!ships) frame.shipBuckets.set(key, ships = new Set()); ships.add(entry); }
    }
}
export function beginShipCollisionFrame(units: readonly Unit[], map?: GameMap, solids?: readonly Solid[], vessels: readonly Unit[] = units) {
  if (map && solids) setShipCollisionSolids(map, solids);
  solids ??= map ? solidSources.get(map)?.bodies ?? [] : [];
  let frame = frames.get(units);
  if (frame) {
    frame.buckets.clear(); frame.shipBuckets.clear(); frame.entries.clear();
    frame.velocities.clear(); frame.yawRates.clear(); frame.impacts.length = 0; frame.hitPairs.clear(); frame.inTheWay.clear();
    if (map) frame.map = map; else delete frame.map;
  } else {
    frame = { ...(map ? { map } : {}), hasShips: false, buckets: new Map(), shipBuckets: new Map(), entries: new Map(), velocities: new Map(), yawRates: new Map(), impacts: [], hitPairs: new Set(), inTheWay: new Set() };
    frames.set(units, frame);
  }
  frame.hasShips = vessels.some(unit => unit.hp > 0 && isShipKind(unit.kind));
  if (!frame.hasShips) return;
  for (let i = 0; i < units.length + solids.length; i++) {
    const body = i < units.length ? units[i]! : solids[i - units.length]!;
    if (body.hp <= 0 || unitBody(body) && body.deck) continue;
    const entry: Entry = { body, radius: radiusOf(map, body), keys: [], left: NaN, right: NaN, top: NaN, bottom: NaN };
    frame.entries.set(body, entry); frame.velocities.set(body, velocity(body)); updateEntry(frame, entry);
    if (unitBody(body) && body.sailing) frame.yawRates.set(body, body.sailing.yawRate ?? 0);
  }
}
function frameFor(units: readonly Unit[], map: GameMap) {
  if (!frames.has(units)) beginShipCollisionFrame(units, map);
  const frame = frames.get(units)!; frame.map = map; return frame;
}
function nearby(frame: Frame, from: Point, to: Point, radius: number, shipsOnly = false) {
  const found = new Set<Entry>();
  const buckets = shipsOnly ? frame.shipBuckets : frame.buckets;
  for (let y = Math.floor((Math.min(from.y, to.y) - radius) / CELL); y <= Math.floor((Math.max(from.y, to.y) + radius) / CELL); y++)
    for (let x = Math.floor((Math.min(from.x, to.x) - radius) / CELL); x <= Math.floor((Math.max(from.x, to.x) + radius) / CELL); x++)
      for (const entry of buckets.get(cellKey(x, y)) ?? []) found.add(entry);
  return [...found].sort((a, b) => a.body.id.localeCompare(b.body.id));
}
function segmentContact(from: Point, to: Point, polygon: readonly Point[]) {
  const clip = clipToConvex(from, to, polygon);
  if (!clip || clip[0] >= 1 - 1e-8 || clip[1] - clip[0] < 1e-8) return;
  const dx = to.x - from.x, dy = to.y - from.y, mid = (clip[0] + clip[1]) / 2;
  if (polygonPlanes(polygon).some(p => (from.x + dx * mid) * p.x + (from.y + dy * mid) * p.y <= p.min + 1e-6)) return;
  const planes = polygonPlanes(polygon);
  // A tiny initial overlap may leave through its nearest face, never move farther inward.
  let distance = Infinity;
  const gaps: { plane: typeof planes[number]; gap: number }[] = [];
  for (const plane of planes) {
    const length = Math.hypot(plane.x, plane.y), at = { x: from.x + dx * clip[0], y: from.y + dy * clip[0] };
    const gap = Math.abs(at.x * plane.x + at.y * plane.y - plane.min) / length;
    gaps.push({ plane, gap }); distance = Math.min(distance, gap);
  }
  // At a pointed bow both incident faces are active; their combined normal
  // resolves a centered head-on strike along the keel rather than one arbitrary side.
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
function supportPoint(polygon: readonly Point[], normal: Point) {
  let best = -Infinity, x = 0, y = 0, count = 0;
  for (const p of polygon) {
    const dot = p.x * normal.x + p.y * normal.y;
    if (dot > best + 1e-5) { best = dot; x = p.x; y = p.y; count = 1; }
    else if (Math.abs(dot - best) <= 1e-5) { x += p.x; y += p.y; count++; }
  }
  return { x: x / count, y: y / count };
}
/** The own hull swept between two step poses, negated into configuration
 * space. It depends on the hull, both headings and the chord error alone, so
 * every body and coast cell tested against one motion, and every later motion
 * through the same headings, read one copy of exactly the same vertices. */
type SweptReach = { reach: Point[]; start?: Point[] };
const sweptReaches = new WeakMap<readonly Point[], Map<string, SweptReach>>();
function sweptReach(ship: Unit, a: ShipPose, b: ShipPose, error: number): SweptReach {
  const hull = shipProfile(ship)!.hull;
  let reaches = sweptReaches.get(hull);
  if (!reaches) sweptReaches.set(hull, reaches = new Map());
  const key = `${exactKey(a.heading)}|${exactKey(b.heading)}|${exactKey(error)}`;
  let swept = reaches.get(key);
  if (!swept) {
    const shape = convexHull([...hullOutline(ship, { ...a, x: 0, y: 0 }), ...hullOutline(ship, { ...b, x: 0, y: 0 })]);
    swept = { reach: (error ? expandConvex(shape, error) : shape).map(p => ({ x: -p.x, y: -p.y })) };
    if (reaches.size >= 512) reaches.delete(reaches.keys().next().value!);
    reaches.set(key, swept);
  }
  return swept;
}
type SweepStep = { a: ShipPose; b: ShipPose; swept: SweptReach };
type Sweep = { ship: Unit; from: ShipPose; to: ShipPose; turn: number; steps: number; radius: number; lever: number; done: SweepStep[] };
function beginSweep(ship: Unit, from: ShipPose, to: ShipPose): Sweep {
  const radius = polygonRadius(shipProfile(ship)!.hull), turn = headingDifference(from.heading, to.heading);
  const lever = to.pivot ? Math.hypot(from.x - to.pivot.x, from.y - to.pivot.y) : 0;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) * Math.sqrt((radius + lever) / (8 * .025))));
  return { ship, from, to, turn, steps, radius, lever, done: [] };
}
/** Steps are prepared only as far as some body's test reaches them. */
function sweepStep(sweep: Sweep, i: number): SweepStep {
  let step = sweep.done[i];
  if (!step) {
    const { ship, from, to, turn, steps, radius, lever } = sweep;
    const a = shipPoseAt(from, to, i / steps), b = shipPoseAt(from, to, (i + 1) / steps);
    const error = turn ? (radius + lever) * (turn / steps) ** 2 / 8 + 1e-7 : 0;
    step = sweep.done[i] = { a, b, swept: sweptReach(ship, a, b, error) };
  }
  return step;
}
// @@@sweep-reach-bound - Every configuration vertex is a body vertex plus a reach vertex, so a step whose centre segment
// stays farther from the body's first vertex than the body's own extent plus the reach's radius cannot touch it: that
// step is skipped before its configuration is built. The extra unit dwarfs any rounding in the sums.
function outlineExtent(polygon: readonly Point[]) {
  const anchor = polygon[0]!;
  let extent = 0;
  for (const p of polygon) extent = Math.max(extent, Math.hypot(p.x - anchor.x, p.y - anchor.y));
  return extent;
}
function sweepShape(sweep: Sweep, bodyPolygon: readonly Point[]): Omit<Contact, 'kind'> | undefined {
  const { ship, from, to, turn, steps } = sweep;
  const extent = bodyPolygon.length ? outlineExtent(bodyPolygon) : Infinity;
  for (let i = 0; i < steps; i++) {
    const { a, b, swept } = sweepStep(sweep, i);
    if (pointSegmentDistanceSquared(bodyPolygon[0] ?? a, a, b) > (extent + polygonRadius(swept.reach) + 1) ** 2) continue;
    const configuration = minkowskiSum(bodyPolygon, swept.reach);
    let contact = segmentContact(a, b, configuration);
    // A rotating hull has no center translation. Its swept outline still supplies a contact face.
    if (!contact && Math.abs(turn) > 1e-8 && polygonPlanes(configuration).every(p => a.x * p.x + a.y * p.y > p.min + 1e-6)) {
      const before = minkowskiSum(bodyPolygon, swept.start ??= hullOutline(ship, { ...a, x: 0, y: 0 }).map(p => ({ x: -p.x, y: -p.y })));
      if (!polygonPlanes(before).every(p => a.x * p.x + a.y * p.y > p.min + 1e-6)) {
        const plane = polygonPlanes(configuration).reduce((best, p) => (a.x * p.x + a.y * p.y - p.min) / Math.hypot(p.x, p.y) < (a.x * best.x + a.y * best.y - best.min) / Math.hypot(best.x, best.y) ? p : best);
        const length = Math.hypot(plane.x, plane.y); contact = { fraction: 0, normal: { x: plane.x / length, y: plane.y / length } };
      }
    }
    if (!contact) continue;
    const fraction = (i + contact.fraction) / steps, pose = shipPoseAt(from, to, fraction);
    const own = supportPoint(hullOutline(ship, pose), contact.normal), other = supportPoint(bodyPolygon, { x: -contact.normal.x, y: -contact.normal.y });
    return { fraction, normal: contact.normal, point: { x: (own.x + other.x) / 2, y: (own.y + other.y) / 2 } };
  }
}
/** Static planning uses the physical sweep, including its initial-contact
 * escape rule. The polygons are frozen when a resumable search is created. */
export function shipSolidsPassageClear(ship: Unit, from: ShipPose, to: ShipPose, solids: readonly Point[][]): boolean {
  if (!solids.length) return true;
  const sweep = beginSweep(ship, from, to);
  const stationary = from.x === to.x && from.y === to.y && Math.abs(sweep.turn) < 1e-8;
  for (const polygon of solids) {
    // Reject distant footprints before preparing any rotated hull geometry.
    const extent = outlineExtent(polygon);
    const arcReach = to.curvature ? 2 / Math.abs(to.curvature) : sweep.lever * 2;
    if (pointSegmentDistanceSquared(polygon[0]!, from, to) > (extent + sweep.radius + arcReach + 1) ** 2) continue;
    if (stationary) {
      const reflected = hullOutline(ship, from).map(p => ({ x: from.x - p.x, y: from.y - p.y }));
      if (insideSupportingPlanes(minkowskiSum(polygon, reflected), from.x, from.y)) return false;
    } else if (sweepShape(sweep, polygon)) return false;
  }
  return true;
}
/** Shared placement check for launching and physical motion. */
export function shipBodyClearAtPose(map: GameMap, ship: Unit, pose: ShipPose, bodies: readonly Body[]) {
  let reflected: Point[] | undefined;
  for (const body of bodies) {
    if (body === ship || !activeBody(map, body)) continue;
    if (Math.hypot(body.x - pose.x, body.y - pose.y) > polygonRadius(shipProfile(ship)!.hull) + radiusOf(map, body)) continue;
    reflected ??= hullOutline(ship, pose).map(p => ({ x: pose.x - p.x, y: pose.y - p.y }));
    if (insideSupportingPlanes(minkowskiSum(outline(map, body), reflected), pose.x, pose.y)) return false;
  }
  return true;
}
function terrainContact(map: GameMap, sweep: Sweep): Contact | undefined {
  const { from, to, radius } = sweep, terrain = map.terrain;
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
  for (const polygon of polygons) { const contact = sweepShape(sweep, polygon); if (contact && (!best || contact.fraction < best.fraction)) best = { ...contact, kind: 'terrain' }; }
  return best;
}
/** The continuous contact occurs even when the desired end pose is clear beyond a thin obstacle. */
export function sweepShipCollision(map: GameMap, ship: Unit, units: readonly Unit[], from: ShipPose, to: ShipPose): Contact | undefined {
  const frame = frameFor(units, map), sweep = beginSweep(ship, from, to), radius = sweep.radius;
  let best: Contact | undefined;
  for (const { body } of nearby(frame, from, to, radius)) {
    if (body === ship || !activeBody(map, body) || shoulders(ship, body)) continue;
    const contact = sweepShape(sweep, outline(map, body));
    if (contact && (!best || contact.fraction < best.fraction - 1e-8)) best = { ...contact, other: body, kind: kindOf(body) };
  }
  if (!hullPassageClear(map, ship, from, to)) {
    const contact = terrainContact(map, sweep);
    if (contact && (!best || contact.fraction < best.fraction)) best = contact;
    // Retain the navigation sweep's conservative curvature guarantee.
    if (!best) {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      best = { fraction: 0, normal: { x: length ? (to.x - from.x) / length : 0, y: length ? (to.y - from.y) / length : 0 }, point: { x: from.x, y: from.y }, kind: 'terrain' };
    }
  }
  return best;
}
/** Frozen pre-impact velocities prevent order-of-update and duplicate damage from the two hulls. */
export function recordShipCollision(map: GameMap, ship: Unit, units: readonly Unit[], from: ShipPose, to: ShipPose, contact: Contact) {
  const frame = frameFor(units, map), other = contact.other, normal = contact.normal;
  const own = frame.velocities.get(ship) ?? velocity(ship), target = other ? frame.velocities.get(other) ?? velocity(other) : { x: 0, y: 0 };
  const attempt = { x: (to.x - from.x) * SIM_TICKS_PER_SECOND, y: (to.y - from.y) * SIM_TICKS_PER_SECOND };
  // A stalled helm command is not fresh kinetic energy each tick. Only a
  // retained physical yaw rate can produce rotational impact damage.
  const turnRate = frame.yawRates.get(ship) ?? 0;
  const lever = { x: contact.point.x - from.x, y: contact.point.y - from.y };
  const otherTurn = other && unitBody(other) ? frame.yawRates.get(other) ?? 0 : 0;
  const otherLever = other ? { x: contact.point.x - other.x, y: contact.point.y - other.y } : { x: 0, y: 0 };
  const linearClosing = Math.max((own.x - target.x) * normal.x + (own.y - target.y) * normal.y, (attempt.x - target.x) * normal.x + (attempt.y - target.y) * normal.y);
  const closingSpeed = Math.max(0, linearClosing + turnRate * (-lever.y * normal.x + lever.x * normal.y) - otherTurn * (-otherLever.y * normal.x + otherLever.x * normal.y));
  const key = other ? [ship.id, other.id].sort().join('|') : `${ship.id}|terrain`;
  if (closingSpeed > SHIP_IMPACT_SAFE_SPEED && !frame.hitPairs.has(key)) {
    frame.hitPairs.add(key);
    const ma = bodyMass(ship), mb = other && unitBody(other) ? bodyMass(other) : Infinity;
    const reduced = Number.isFinite(mb) ? ma * mb / (ma + mb) : ma;
    const energy = .5 * reduced * (closingSpeed - SHIP_IMPACT_SAFE_SPEED) ** 2;
    // Energy is shared by mass: a light body yields before a heavy hull. Damage is bounded per impact.
    const damage = (mass: number, hp: number) => Math.min(hp * .25, energy / Math.max(1, mass) * .065);
    frame.impacts.push({ ...contact, ship, closingSpeed, energy, shipDamage: damage(ma, ship.maxHp), otherDamage: other ? damage(Number.isFinite(mb) ? mb : ma, other.maxHp) : 0 });
  }
  const motion = ship.sailing;
  if (motion) { motion.speed = 0; motion.yawRate = 0; motion.velocityX = 0; motion.velocityY = 0; }
  // Keep a shove from retrying its spent inward momentum on the next tick.
  if ((ship.pushX ?? 0) * normal.x + (ship.pushY ?? 0) * normal.y > 0) { ship.pushX = undefined; ship.pushY = undefined; }
  if (other && unitBody(other) && shipProfile(other)) {
    const v = frame.velocities.get(other)!;
    if (v.x * normal.x + v.y * normal.y < 0 && other.sailing) {
      other.sailing.speed = 0; other.sailing.yawRate = 0; other.sailing.velocityX = 0; other.sailing.velocityY = 0;
    }
  }
}
export function updateShipCollisionPosition(units: readonly Unit[], ship: Unit) { const frame = frames.get(units), entry = frame?.entries.get(ship); if (frame && entry) updateEntry(frame, entry); }
export function drainShipCollisionImpacts(units: readonly Unit[]): ShipCollisionImpact[] { const frame = frames.get(units); return frame ? frame.impacts.splice(0) : []; }
/** Read-only diagnostics survive the damage drain until the next motion frame. */
export function shipCollisionImpactCount(units: readonly Unit[]): number { return frames.get(units)?.hitPairs.size ?? 0; }
/** Only an initialized empty frame can bypass hull constraints. */
export function groundShipFrameEmpty(units: readonly Unit[]): boolean { return frames.get(units)?.hasShips === false; }

/** Ground crew retain their own layer; an off-deck body cannot walk or slide through a reachable hull. */
// @@@shoulder-aside - A hull is not stopped by its own side's troops wading beside it: it shoulders them aside, and a
// trooper it comes over is set down just off its side. Pressed on by the very troops whose way it closed (they wade
// into it from both sides of a ford), a hull could neither turn nor sail, and neither could they. An enemy's troops
// still stop it, so a hull is still struck from the shallows; its own still cannot walk through it.
function shoulders(ship: Unit, body: Body) {
  return unitBody(body) && body.owner === ship.owner && !shipProfile(body) && !body.deck;
}
export function shoulderAside(map: GameMap, units: readonly Unit[], starts: ReadonlyMap<string, ShipPose>) {
  const frame = frames.get(units);
  if (!frame?.hasShips) return;
  for (const ship of units) {
    const profile = shipProfile(ship), start = starts.get(ship.id);
    // Only a hull that moved came over anyone; one at rest leaves those standing by it be.
    if (!profile || ship.hp <= 0 || !ship.sailing || !start || start.x === ship.x && start.y === ship.y && start.heading === ship.sailing.heading) continue;
    const hull = profile.hull, c = detCos(ship.sailing.heading), s = detSin(ship.sailing.heading);
    for (const { body } of nearby(frame, ship, ship, polygonRadius(hull) + 64)) {
      if (!shoulders(ship, body) || body.hp <= 0 || !isWalkable(map, body.x, body.y, 'land')) continue;
      const unit = body as Unit, wx = unit.x - ship.x, wy = unit.y - ship.y, px = wx * c + wy * s, py = -wx * s + wy * c;
      // The nearest point of the hull's side, and the way out of it there.
      let inside = true, gap = Infinity, out = { x: 0, y: 0, nx: 0, ny: 0 };
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i]!, b = hull[(i + 1) % hull.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if ((dx * (py - a.y) - dy * (px - a.x)) / length < 0) inside = false;
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (length * length))), qx = a.x + dx * t, qy = a.y + dy * t;
        const d = Math.hypot(px - qx, py - qy);
        if (d < gap) { gap = d; out = { x: qx, y: qy, nx: dy / length, ny: -dx / length }; }
      }
      if (!inside && gap >= unit.radius) continue;
      const lx = out.x + out.nx * (unit.radius + 1), ly = out.y + out.ny * (unit.radius + 1);
      const at = { x: ship.x + lx * c - ly * s, y: ship.y + lx * s + ly * c };
      if (isWalkable(map, at.x, at.y, 'land')) { unit.x = at.x; unit.y = at.y; }
    }
  }
}
/** This tick's hulls that held up a step of their own side's land units, in the order the steps came (see @@@give-way). */
export function hullsInTheWay(units: readonly Unit[]): ReadonlySet<Unit> {
  return frames.get(units)?.inTheWay ?? new Set();
}
export function constrainGroundShipStep(map: GameMap, unit: Unit, from: Point, to: Point, units: readonly Unit[]): Point {
  if (frames.get(units)?.hasShips === false) return to;
  if (unit.deck || isShipKind(unit.kind) || !isWalkable(map, from.x, from.y, 'land')) return to;
  const frame = frameFor(units, map);
  if (!frame.hasShips) return to;
  let fraction = 1;
  const ships = nearby(frame, from, to, unit.radius, true);
  if (!ships.length) return to;
  const own = circleOutline({ x: 0, y: 0, radius: unit.radius });
  let negated: Point[] | undefined, ownReach = 0;
  for (const p of own) ownReach = Math.max(ownReach, Math.hypot(p.x, p.y));
  for (const { body } of ships) {
    if (!unitBody(body) || !shipProfile(body) || body.hp <= 0) continue;
    // The hull's outline lies within its radius of the ship and the circle's within its own (see @@@sweep-reach-bound).
    if (pointSegmentDistanceSquared(body, from, to) > (polygonRadius(shipProfile(body)!.hull) + ownReach + 1) ** 2) continue;
    const configuration = minkowskiSum(outline(map, body), negated ??= own.map(p => ({ x: -p.x, y: -p.y })));
    const contact = segmentContact(from, to, configuration);
    if (!contact) continue;
    fraction = Math.min(fraction, Math.max(0, contact.fraction - 1e-5 / Math.max(1, Math.hypot(to.x - from.x, to.y - from.y))));
    if (body.owner === unit.owner) frame.inTheWay.add(body);
  }
  return fraction === 1 ? to : { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}
