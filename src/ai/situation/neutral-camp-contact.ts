import { strikeReach } from '../../shared/combat-geometry';
import { canReach } from '../../shared/naval';
import type { GameSnapshot, Unit } from '../../shared/types';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { neutralCampExposure, unitAutoAcquireRadius, type NeutralCampExposure, type NeutralCampExposureFacts } from './neutral-camp-exposure';

type Point = Readonly<{ x: number; y: number }>;
export type CampContact = Readonly<{
  camp: NeutralCampExposure; memberId: string; reason: 'camp-alert' | 'self-acquire' | 'active-pursuit';
  point: Point; segment: number; distance: number; radius: number; arrivalTicks: number;
}>;
export type CampContactOptions = Readonly<{
  exemptMemberIds?: ReadonlySet<string>;
  /** Normal attackMove can acquire while walking; plain move cannot. */
  movingMode?: 'move' | 'attackMove';
  arrivalMode?: 'idle' | 'hold' | 'attackMove' | 'move';
  horizonTicks?: number;
  facts?: NeutralCampExposureFacts;
}>;
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function closest(point: Point, from: Point, to: Point): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: from.x + t * dx, y: from.y + t * dy };
}

/** Observed triggering geometry, not a ban or a policy score. Direct contact and
 * possible active pursuit remain separate facts so routes can compare their costs.
 * Reachability uses the same native surface rules at the actual proposed point.
 */
function computeRouteContacts(snapshot: GameSnapshot, unit: Unit, road: readonly Point[], options: CampContactOptions = {}): readonly CampContact[] {
  const facts = options.facts ?? neutralCampExposure(snapshot), contacts: CampContact[] = [];
  if (!road.length) return contacts;
  const at = (point: Point) => ({ ...unit, x: point.x, y: point.y });
  const end = road.at(-1)!;
  const bounds = road.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  for (const camp of facts.camps) {
    if (measurement) measurement.camps++;
    if (camp.memberIds.some(id => options.exemptMemberIds?.has(id))) continue;
    // Native camp reach is the home grouping envelope; activated guards can move
    // away from it. Include that measured displacement before the broad phase.
    const displacement = Math.max(0, ...camp.members.map(member => gap(member.point, camp.camp.center)));
    const radius = Math.max(camp.camp.reach, displacement) + Math.max(0, ...camp.members.map(member => member.pursuitRadius)) + unit.attackRange + unit.radius;
    if (camp.camp.center.x + radius < bounds.minX || camp.camp.center.x - radius > bounds.maxX
      || camp.camp.center.y + radius < bounds.minY || camp.camp.center.y - radius > bounds.maxY) continue;
    if (measurement) measurement.nearCamps++;
    for (let memberIndex = 0; memberIndex < camp.members.length; memberIndex++) {
      const member = camp.members[memberIndex]!, guard = camp.camp.creeps[memberIndex]!;
      const add = (reason: CampContact['reason'], point: Point, radius: number, segment: number, playerAttacks = false) => {
        const distance = gap(member.point, point);
        if (distance > radius) return;
        if (measurement) measurement.reachQueries++;
        const patient = at(point);
        if (!canReach(snapshot.map, playerAttacks ? patient : guard, playerAttacks ? guard : patient, snapshot.units)) return;
        contacts.push(Object.freeze({ camp, memberId: member.id, reason, point: Object.freeze({ ...point }),
          segment, distance, radius, arrivalTicks: Math.ceil(Math.max(0, distance - guard.attackRange) / Math.max(1, guard.speed) * SIM_TICKS_PER_SECOND) }));
      };
      const movingAcquire = unit.attackDamage > 0 ? unitAutoAcquireRadius(snapshot, unit, options.movingMode ?? 'move') : 0;
      for (let segment = 1; segment < road.length; segment++) {
        const point = closest(member.point, road[segment - 1]!, road[segment]!);
        if (!member.returning) add('camp-alert', point, strikeReach(guard, unit, member.alertRadius), segment);
        if (movingAcquire > 0) add('self-acquire', point, strikeReach(unit, guard, movingAcquire), segment, true);
        if (member.active) {
          const limit = Math.min(member.pursuitRadius, guard.attackRange + guard.speed * (options.horizonTicks ?? 100) / SIM_TICKS_PER_SECOND);
          if (gap(point, member.home) <= member.pursuitRadius && gap(point, member.responseOrigin) <= member.responseRadius)
            add('active-pursuit', point, limit, segment);
        }
      }
      const arrivingAcquire = unit.attackDamage > 0 ? unitAutoAcquireRadius(snapshot, unit, options.arrivalMode ?? 'idle') : 0;
      if (!member.returning) add('camp-alert', end, strikeReach(guard, unit, member.alertRadius), road.length - 1);
      if (arrivingAcquire > 0) add('self-acquire', end, strikeReach(unit, guard, arrivingAcquire), road.length - 1, true);
      if (member.active && gap(end, member.home) <= member.pursuitRadius && gap(end, member.responseOrigin) <= member.responseRadius)
        add('active-pursuit', end, Math.min(member.pursuitRadius, guard.attackRange + guard.speed * (options.horizonTicks ?? 100) / SIM_TICKS_PER_SECOND), road.length - 1);
    }
  }
  return Object.freeze(contacts);
}

export type NeutralCampContactMeasurement = { calls: number; elapsedMs: number; camps: number; nearCamps: number; reachQueries: number };
let measurement: NeutralCampContactMeasurement | undefined;
/** Opt-in profiling outside policy state; the ordinary path never reads the clock. */
export function withNeutralCampContactMeasurement<T>(run: () => T): { result: T; measurement: NeutralCampContactMeasurement } {
  const previous = measurement, own = { calls: 0, elapsedMs: 0, camps: 0, nearCamps: 0, reachQueries: 0 };
  measurement = own;
  try { return { result: run(), measurement: own }; } finally { measurement = previous; }
}
export function neutralCampRouteContacts(snapshot: GameSnapshot, unit: Unit, road: readonly Point[], options: CampContactOptions = {}): readonly CampContact[] {
  if (!measurement) return computeRouteContacts(snapshot, unit, road, options);
  const start = performance.now(); measurement.calls++;
  try { return computeRouteContacts(snapshot, unit, road, options); } finally { measurement.elapsedMs += performance.now() - start; }
}

export function neutralCampPointContacts(snapshot: GameSnapshot, unit: Unit, point: Point, options: CampContactOptions = {}) {
  return neutralCampRouteContacts(snapshot, unit, [point], options);
}
