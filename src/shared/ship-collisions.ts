import { detCos, detSin } from './det-math';
import { clipToConvex, convexHull, expandConvex, minkowskiSum, polygonPlanes, polygonRadius } from './navigation-math';
import { bodyMass } from './physical-body';
import { shipProfile, type Point } from './ship-geometry';
import { headingDifference, hullPassageClear, shipPoseAt, type ShipPose } from './ship-navigation';
import { CELL_GROUND, footprintHalf, isWalkable } from './terrain';
import { SIM_TICKS_PER_SECOND } from './time';
import type { Building, GameMap, Obstacle, Unit } from './types';

type Body = Unit | Building | Obstacle;
type Solid = Building | Obstacle;
type ContactKind = 'ship' | 'unit' | 'building' | 'obstacle' | 'terrain';
type Contact = { fraction: number; normal: Point; point: Point; other?: Body; kind: ContactKind };
/** Damage is proposed here; the simulation applies its usual armor, cabin and death rules. */
export type ShipCollisionImpact = Contact & { ship: Unit; closingSpeed: number; energy: number; shipDamage: number; otherDamage: number };
type Entry = { body: Body; radius: number; keys: string[]; bounds?: string };
type Frame = { map?: GameMap; hasShips: boolean; buckets: Map<string, Set<Entry>>; shipBuckets: Map<string, Set<Entry>>; entries: Map<Body, Entry>; velocities: Map<Body, Point>; yawRates: Map<Unit, number>; impacts: ShipCollisionImpact[]; hitPairs: Set<string> };
const frames = new WeakMap<readonly Unit[], Frame>();
const CELL = 192;
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
function circleOutline(body: Point & { radius: number }): Point[] {
  // Circumscribed edges keep the true circular body inside the approximation.
  const count = 32, radius = body.radius / detCos(Math.PI / count);
  return Array.from({ length: count }, (_, i) => ({ x: body.x + radius * detCos(i * Math.PI * 2 / count), y: body.y + radius * detSin(i * Math.PI * 2 / count) }));
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
  const bounds = `${left},${right},${top},${bottom}`;
  if (entry.bounds === bounds) return;
  const ship = unitBody(body) && shipProfile(body);
  for (const key of entry.keys) for (const buckets of ship ? [frame.buckets, frame.shipBuckets] : [frame.buckets]) {
    const bucket = buckets.get(key); bucket?.delete(entry); if (bucket?.size === 0) buckets.delete(key);
  }
  entry.keys = []; entry.bounds = bounds;
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const key = `${x},${y}`; let bucket = frame.buckets.get(key);
      if (!bucket) frame.buckets.set(key, bucket = new Set());
      bucket.add(entry); entry.keys.push(key);
      if (ship) { let ships = frame.shipBuckets.get(key); if (!ships) frame.shipBuckets.set(key, ships = new Set()); ships.add(entry); }
    }
}
export function beginShipCollisionFrame(units: readonly Unit[], map?: GameMap, solids: readonly Solid[] = []) {
  const hasShips = units.some(unit => unit.hp > 0 && !!shipProfile(unit));
  const frame: Frame = { ...(map ? { map } : {}), hasShips, buckets: new Map(), shipBuckets: new Map(), entries: new Map(), velocities: new Map(), yawRates: new Map(), impacts: [], hitPairs: new Set() };
  frames.set(units, frame);
  if (!hasShips) return;
  for (const body of [...units, ...solids]) {
    if (body.hp <= 0 || unitBody(body) && body.deck) continue;
    const entry = { body, radius: radiusOf(map, body), keys: [] };
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
      for (const entry of buckets.get(`${x},${y}`) ?? []) found.add(entry);
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
function sweepShape(ship: Unit, from: ShipPose, to: ShipPose, bodyPolygon: readonly Point[]): Omit<Contact, 'kind'> | undefined {
  const radius = polygonRadius(shipProfile(ship)!.hull), turn = headingDifference(from.heading, to.heading);
  const lever = to.pivot ? Math.hypot(from.x - to.pivot.x, from.y - to.pivot.y) : 0;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) * Math.sqrt((radius + lever) / (8 * .025))));
  for (let i = 0; i < steps; i++) {
    const a = shipPoseAt(from, to, i / steps), b = shipPoseAt(from, to, (i + 1) / steps);
    const shape = convexHull([...hullOutline(ship, { ...a, x: 0, y: 0 }), ...hullOutline(ship, { ...b, x: 0, y: 0 })]);
    const error = turn ? (radius + lever) * (turn / steps) ** 2 / 8 + 1e-7 : 0;
    const configuration = minkowskiSum(bodyPolygon, (error ? expandConvex(shape, error) : shape).map(p => ({ x: -p.x, y: -p.y })));
    let contact = segmentContact(a, b, configuration);
    // A rotating hull has no center translation. Its swept outline still supplies a contact face.
    if (!contact && Math.abs(turn) > 1e-8) {
      const inside = polygonPlanes(configuration).every(p => a.x * p.x + a.y * p.y > p.min + 1e-6);
      const before = minkowskiSum(bodyPolygon, hullOutline(ship, { ...a, x: 0, y: 0 }).map(p => ({ x: -p.x, y: -p.y })));
      if (inside && !polygonPlanes(before).every(p => a.x * p.x + a.y * p.y > p.min + 1e-6)) {
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
/** Shared placement check for launching and physical motion. */
export function shipBodyClearAtPose(map: GameMap, ship: Unit, pose: ShipPose, bodies: readonly Body[]) {
  const hull = hullOutline(ship, pose);
  for (const body of bodies) {
    if (body === ship || !activeBody(map, body)) continue;
    if (Math.hypot(body.x - pose.x, body.y - pose.y) > polygonRadius(shipProfile(ship)!.hull) + radiusOf(map, body)) continue;
    const config = minkowskiSum(outline(map, body), hull.map(p => ({ x: pose.x - p.x, y: pose.y - p.y })));
    if (polygonPlanes(config).every(p => pose.x * p.x + pose.y * p.y > p.min + 1e-6)) return false;
  }
  return true;
}
function terrainContact(map: GameMap, ship: Unit, from: ShipPose, to: ShipPose): Contact | undefined {
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
  for (const polygon of polygons) { const contact = sweepShape(ship, from, to, polygon); if (contact && (!best || contact.fraction < best.fraction)) best = { ...contact, kind: 'terrain' }; }
  return best;
}
/** The continuous contact occurs even when the desired end pose is clear beyond a thin obstacle. */
export function sweepShipCollision(map: GameMap, ship: Unit, units: readonly Unit[], from: ShipPose, to: ShipPose): Contact | undefined {
  const frame = frameFor(units, map), radius = polygonRadius(shipProfile(ship)!.hull);
  let best: Contact | undefined;
  for (const { body } of nearby(frame, from, to, radius)) {
    if (body === ship || !activeBody(map, body)) continue;
    const contact = sweepShape(ship, from, to, outline(map, body));
    if (contact && (!best || contact.fraction < best.fraction - 1e-8)) best = { ...contact, other: body, kind: kindOf(body) };
  }
  if (!hullPassageClear(map, ship, from, to)) {
    const contact = terrainContact(map, ship, from, to);
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

/** Ground crew retain their own layer; an off-deck body cannot walk or slide through a reachable hull. */
export function constrainGroundShipStep(map: GameMap, unit: Unit, from: Point, to: Point, units: readonly Unit[]): Point {
  if (unit.deck || shipProfile(unit) || !isWalkable(map, from.x, from.y, 'land')) return to;
  const frame = frameFor(units, map);
  if (!frame.hasShips) return to;
  let fraction = 1;
  const ships = nearby(frame, from, to, unit.radius, true);
  if (!ships.length) return to;
  const own = circleOutline({ x: 0, y: 0, radius: unit.radius });
  for (const { body } of ships) {
    if (!unitBody(body) || !shipProfile(body) || body.hp <= 0) continue;
    const configuration = minkowskiSum(outline(map, body), own.map(p => ({ x: -p.x, y: -p.y })));
    const contact = segmentContact(from, to, configuration);
    if (contact) fraction = Math.min(fraction, Math.max(0, contact.fraction - 1e-5 / Math.max(1, Math.hypot(to.x - from.x, to.y - from.y))));
  }
  return fraction === 1 ? to : { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}
