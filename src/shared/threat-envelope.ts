import { pointSegmentDistanceSquared } from './navigation-math';
import { SIM_TICKS_PER_SECOND } from './time';
import type { Unit, UnitKind } from './types';

type Point = Readonly<{ x: number; y: number }>;
export type ExposureBinding = Readonly<{ declarationId: string; declarationVersion: string; scheduleEpoch: number }>;
export type ExposureSegment = Readonly<{ id: string; from: Point; to: Point }>;
export type ActionExposure = Readonly<{
  binding: ExposureBinding;
  route: Readonly<{ binding: ExposureBinding; version: string; segments: readonly ExposureSegment[] }>;
  passage: Readonly<{ binding: ExposureBinding; version: string; routeVersion: string;
    segments: readonly Readonly<{ id: string; fromTick: number; throughTick: number }>[] }>;
  actors: Readonly<{ binding: ExposureBinding; version: string; members: readonly Readonly<{ id: string; physicalVersion: string }>[] }>;
  /** Existing native/whole-cohort currency, not a new margin; zero for an unprotected worker. */
  resistance: Readonly<{ binding: ExposureBinding; version: string; force: number | null }>;
}>;
export type EnvelopeEnemy = Readonly<{
  unit: Readonly<Unit>;
  /** Native ability/shape/equipment/camp-constraint version, not an order label. */
  physicalVersion: string;
  /** Publication version of THIS enemy × THIS action's supplied reach evidence.
   * The publisher reuses it only for identical content, changes it when any
   * certificate in that row changes. It is neither a world nor planner revision. */
  evidenceVersion: string;
  /** Conservative movement/reach upper bounds, including hull/deck/body offsets.
   * Unknown bounds disable straight-line exclusion; nominal hull speed is insufficient. */
  capability: Readonly<{ armed: boolean; maxSpeed: number | null; reach: number | null; interruptForce: number | null }>;
}>;
export type EnvelopeArrival = Readonly<{
  enemyId: string; segmentId: string; binding: ExposureBinding;
  routeVersion: string; passageVersion: string; navigationVersion: string;
  physicalVersion: string; actorVersion: string; origin: Point;
  /** Published native certificates only. Paths alone do not establish attack
   * legality. A negative covers all exposed actors and the WHOLE segment. */
  proof:
    | Readonly<{ kind: 'native-interception'; point: Point; travelTicks: number; targetId: string; canAttack: boolean | null }>
    | Readonly<{ kind: 'native-whole-segment-unreachable' }>;
}>;
export type ThreatEnvelopeInput = Readonly<{
  ownerId: string; observedTick: number; navigationVersion: string; exposure: ActionExposure;
  enemies: readonly EnvelopeEnemy[]; arrivals: readonly EnvelopeArrival[];
  /** Fixed kind priors; missing kinds use explicit pessimistic 1, reported separately. */
  qByKind: Readonly<Partial<Record<UnitKind, number>>>;
}>;
type Pair = {
  state: 'inside' | 'outside' | 'pending'; reason: string;
  validFromTick: number; validThroughTick: number | null;
  witness: { point: Point; enemyArrivalTick: number; passageTick: number; travelTicks: number } | null;
};
type Row = {
  dependency: string; next: number; done: boolean; state: Pair['state'];
  validFromTick: number; validThroughTick: number | null; pendingPairs: number;
  unknown: { segmentId: string; reason: string } | null;
  witness: { segmentId: string; segmentKey: string; point: Point; travelTicks: number; passageTick: number } | null;
};
type ActionCursor = {
  globalKey: string; segments: string[]; rows: Record<string, Row>; nextEnemyId?: string;
};
/** ONE cursor per owner, shared by all that owner's action evaluations. */
export type ThreatEnvelopeCursor = Readonly<{
  version: 1; byteLength: number; ownerId?: string; actions: Readonly<Record<string, Readonly<ActionCursor>>>; order: readonly string[];
}>;
export const THREAT_ENVELOPE_RESIDENT_BYTES = 32 * 1024;
export const beginThreatEnvelope = (): ThreatEnvelopeCursor => sizeCursor({ version: 1, byteLength: 0, actions: {}, order: [] });
export type ThreatEnvelopeResult = Readonly<{
  state: 'known' | 'pending' | 'invalid'; reason: string;
  binding: ExposureBinding; envelope: readonly string[]; probability: number | null;
  factors: readonly Readonly<{ enemyId: string; kind: UnitKind; q: number }>[];
  /** At most two query-frontier entries per enemy, never an E×L resident table. */
  unknownPairs: readonly Readonly<{ enemyId: string; segmentId: string; reason: string }>[];
  witnesses: readonly Readonly<{ enemyId: string; segmentId: string; point: Point; enemyArrivalTick: number; passageTick: number }>[];
  unsupportedKinds: readonly UnitKind[]; cursor: ThreatEnvelopeCursor;
  work: number; inspectionWork: number; dependencyWork: number; aggregationWork: number; retentionWork: number;
  /** reusedPairs counts conclusions covered by row summaries; it performs no cell scan. */
  evaluatedPairs: number; reusedPairs: number; deferredPairs: number; unresolvedPairs: number; minimumWork: number;
  residentBytes: number; evictedActions: number; evictedRows: number;
}>;
const key = (value: unknown) => JSON.stringify(value);
const bytes = (value: unknown) => new TextEncoder().encode(key(value)).length;
const sameBinding = (a: ExposureBinding, b: ExposureBinding) => a.declarationId === b.declarationId
  && a.declarationVersion === b.declarationVersion && a.scheduleEpoch === b.scheduleEpoch;
const finitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
function sizeCursor(value: ThreatEnvelopeCursor): ThreatEnvelopeCursor {
  const raw = bytes({ ...value, byteLength: 0 });
  let size = raw;
  while (size !== raw + String(size).length - 1) size = raw + String(size).length - 1;
  return { ...value, byteLength: size };
}
const record = <T>(): Record<string, T> => Object.create(null);

/** Exact UTF8 size accounting without repeatedly serializing a shrinking grid.
 * Current action: unfinished rows first, then positive witnesses, then other
 * conclusions. Other actions retain newest whole entries that still fit.
 * Eviction forgets computation only; it does not manufacture a safe result. */
function retain(ownerId: string, actionId: string, action: ActionCursor, previous: ThreatEnvelopeCursor) {
  const actions = record<ActionCursor>(), order: string[] = [];
  let total = bytes({ version: 1, byteLength: 0, ownerId, actions: {}, order: [] }), evictedRows = 0, evictedActions = 0;
  const addition = (id: string, valueBytes: number) => bytes(id) * 2 + 1 + valueBytes + (order.length ? 2 : 0);
  const rows = record<Row>(), kept: ActionCursor = { ...action, rows };
  let actionBytes = bytes(kept), count = 0;
  const room = THREAT_ENVELOPE_RESIDENT_BYTES - 4 - total - addition(actionId, actionBytes);
  if (room >= 0) {
    let used = 0;
    const entries = Object.entries(action.rows);
    for (const [id, row] of [...entries.filter(([, r]) => !r.done), ...entries.filter(([, r]) => r.done && r.state === 'inside'),
      ...entries.filter(([, r]) => r.done && r.state !== 'inside')]) {
      const n = bytes(id) + 1 + bytes(row) + (count ? 1 : 0);
      if (used + n > room) { evictedRows++; continue; }
      rows[id] = row; used += n; count++;
    }
    actionBytes += used; total += addition(actionId, actionBytes); actions[actionId] = kept; order.push(actionId);
  } else { evictedActions++; evictedRows = Object.keys(action.rows).length; }
  for (const id of [...previous.order].reverse()) {
    if (id === actionId) continue;
    const old = previous.actions[id]; if (!old) continue;
    const size = addition(id, bytes(old));
    if (total + size > THREAT_ENVELOPE_RESIDENT_BYTES - 4) { evictedActions++; continue; }
    actions[id] = old; order.unshift(id); total += size;
  }
  const cursor = sizeCursor({ version: 1, byteLength: 0, ownerId, actions, order }), residentBytes = cursor.byteLength;
  if (residentBytes > THREAT_ENVELOPE_RESIDENT_BYTES) throw Error('Envelope resident accounting mismatch');
  return { cursor, residentBytes, evictedActions, evictedRows };
}

/** The only transient E-sized scratch is returned with a scan for independently
 * measuring aggregation CPU. Persist ONLY progress.cursor, never this scratch. */
export type ThreatEnvelopeScan = Readonly<{ input: ThreatEnvelopeInput; progress: ThreatEnvelopeResult; rows?: Readonly<Record<string, Row>> }>;

/** Pure continuation: no Situation, source, path query, sim, clock or mutable
 * global state. Metadata I=1+A+E+Lroute+Lpassage+M; reserve R=65+E+old action count
 * for bounded retention. Work=I+2E+R+2 visited cells+new classifications.
 * A warm summary is O(E+L+M), not E×L. Native route production has a separate
 * metered publisher: this function only validates supplied certificates.
 * Input metadata must itself fit allowance; otherwise state stays pending. */
export function scanThreatEnvelope(input: ThreatEnvelopeInput, previous: ThreatEnvelopeCursor, allowance: number): ThreatEnvelopeScan {
  if (!Number.isSafeInteger(allowance) || allowance < 0) throw Error('Invalid envelope work allowance');
  const { exposure } = input, binding = exposure.binding;
  const inspectionWork = 1 + exposure.actors.members.length + input.enemies.length + exposure.route.segments.length
    + exposure.passage.segments.length + input.arrivals.length;
  const retentionWork = 65 + input.enemies.length + previous.order.length;
  const baseWork = inspectionWork + 2 * input.enemies.length + retentionWork;
  const minimumWork = baseWork + (input.enemies.length && exposure.route.segments.length ? 3 : 0);
  const empty = (state: ThreatEnvelopeResult['state'], reason: string, work = 0): ThreatEnvelopeScan => ({ input,
    progress: { state, reason, binding, envelope: [], probability: null, factors: [], unknownPairs: [], witnesses: [], unsupportedKinds: [],
      cursor: previous, work, inspectionWork: work, dependencyWork: 0, aggregationWork: 0, retentionWork: 0,
      minimumWork, evaluatedPairs: 0, reusedPairs: 0, deferredPairs: 0, unresolvedPairs: 0,
      residentBytes: previous.byteLength, evictedActions: 0, evictedRows: 0 } });
  if (allowance < minimumWork) return empty('pending', 'envelope-input-budget-pending');
  if (previous.version !== 1 || previous.ownerId && previous.ownerId !== input.ownerId || !input.ownerId || bytes(input.ownerId) > 258)
    return empty('invalid', 'envelope-owner-or-cursor-invalid', inspectionWork);
  if (!sameBinding(binding, exposure.route.binding) || !sameBinding(binding, exposure.passage.binding)
    || !sameBinding(binding, exposure.actors.binding) || !sameBinding(binding, exposure.resistance.binding)
    || exposure.route.version !== exposure.passage.routeVersion || !binding.declarationId || !binding.declarationVersion
    || !Number.isSafeInteger(binding.scheduleEpoch) || !Number.isSafeInteger(input.observedTick) || input.observedTick < binding.scheduleEpoch
    || !input.navigationVersion || !exposure.route.version || !exposure.passage.version || !exposure.actors.version)
    return empty('invalid', 'exposure-declaration-route-passage-epoch-mismatch', inspectionWork);
  const actorIds = new Set(exposure.actors.members.map(actor => actor.id));
  if (actorIds.size !== exposure.actors.members.length || exposure.actors.members.some(actor => !actor.id || !actor.physicalVersion)
    || exposure.route.segments.length > 0 && actorIds.size === 0) return empty('invalid', 'exposure-actors-invalid', inspectionWork);
  const segments = new Map(exposure.route.segments.map(segment => [segment.id, segment]));
  const times = new Map(exposure.passage.segments.map(segment => [segment.id, segment]));
  if (segments.size !== exposure.route.segments.length || times.size !== exposure.passage.segments.length || segments.size !== times.size
    || exposure.route.segments.some(s => !s.id || !finitePoint(s.from) || !finitePoint(s.to) || !times.has(s.id)
      || !nonnegative(times.get(s.id)!.fromTick) || !nonnegative(times.get(s.id)!.throughTick)
      || times.get(s.id)!.throughTick < times.get(s.id)!.fromTick)
    || exposure.resistance.force !== null && !nonnegative(exposure.resistance.force))
    return empty('invalid', 'exposure-segment-or-resistance-invalid', inspectionWork);
  if (new Set(input.enemies.map(e => e.unit.id)).size !== input.enemies.length || input.enemies.some(e => !e.unit.id
    || !e.physicalVersion || !e.evidenceVersion || !finitePoint(e.unit) || !Number.isFinite(e.unit.hp)
    || e.capability.maxSpeed !== null && !nonnegative(e.capability.maxSpeed) || e.capability.reach !== null && !nonnegative(e.capability.reach)
    || e.capability.interruptForce !== null && !nonnegative(e.capability.interruptForce)))
    return empty('invalid', 'envelope-enemy-invalid', inspectionWork);
  const proofs = new Map<string, Map<string, EnvelopeArrival>>();
  for (const arrival of input.arrivals) {
    let row = proofs.get(arrival.enemyId); if (!row) proofs.set(arrival.enemyId, row = new Map());
    if (row.has(arrival.segmentId)) return empty('invalid', 'envelope-duplicate-arrival', inspectionWork);
    row.set(arrival.segmentId, arrival);
  }
  const segmentIndexes = new Map(exposure.route.segments.map((s, index) => [s.id, index]));
  const globalKey = key([input.navigationVersion, binding.scheduleEpoch, exposure.actors.version, exposure.actors.members]);
  const keys = exposure.route.segments.map(s => key([s.id, { x: s.from.x, y: s.from.y }, { x: s.to.x, y: s.to.y }, times.get(s.id)!.fromTick, times.get(s.id)!.throughTick]));
  const prior = previous.actions[binding.declarationId], sameGlobal = prior?.globalKey === globalKey;
  let changedAt = 0;
  if (sameGlobal) { while (changedAt < keys.length && keys[changedAt] === prior.segments[changedAt]) changedAt++; }
  const rows = record<Row>();
  let work = baseWork, evaluatedPairs = 0, reusedPairs = 0, deferredPairs = 0;
  let dependencyWork = input.enemies.length, aggregationWork = input.enemies.length;
  const start = Math.max(0, input.enemies.findIndex(e => e.unit.id === prior?.nextEnemyId));
  let nextEnemyId: string | undefined;
  for (let offset = 0; offset < input.enemies.length; offset++) {
    const index = (start + offset) % input.enemies.length, enemy = input.enemies[index]!, unit = enemy.unit;
    const arrivals = proofs.get(unit.id);
    const valid = (a: EnvelopeArrival) => sameBinding(binding, a.binding) && a.routeVersion === exposure.route.version
      && a.passageVersion === exposure.passage.version && a.navigationVersion === input.navigationVersion
      && a.actorVersion === exposure.actors.version && a.physicalVersion === enemy.physicalVersion && a.origin.x === unit.x && a.origin.y === unit.y;
    const dependency = key([unit.kind, unit.owner, unit.x, unit.y, unit.hp, unit.speed, unit.radius, unit.deck ?? null,
      unit.cabin ?? null, unit.garrison ?? null, unit.sailing?.heading ?? null, unit.expiresTick ?? null,
      enemy.physicalVersion, enemy.evidenceVersion, enemy.capability, arrivals?.size ?? 0, [...(arrivals?.values() ?? [])].every(valid)]);
    const old = sameGlobal ? prior.rows[unit.id] : undefined;
    const matching = old?.dependency === dependency && input.observedTick >= old.validFromTick
      && (old.validThroughTick === null || input.observedTick <= old.validThroughTick);
    const witnessKept = matching && old.witness && keys[segmentIndexes.get(old.witness!.segmentId) ?? -1] === old.witness.segmentKey;
    const prefixKept = matching && changedAt >= old.next && old.next <= keys.length;
    const reusable = !!(witnessKept || prefixKept);
    const row: Row = reusable ? { ...old, done: !!witnessKept || old.next === keys.length } : {
      dependency, next: 0, done: false, state: 'outside', validFromTick: input.observedTick, validThroughTick: null,
      pendingPairs: 0, unknown: null, witness: null };
    rows[unit.id] = row;
    if (reusable) reusedPairs += row.next;
    while (!row.done && row.next < keys.length && allowance - work >= 3) {
      const segment = exposure.route.segments[row.next]!, time = times.get(segment.id)!, arrival = arrivals?.get(segment.id);
      dependencyWork++; aggregationWork++; evaluatedPairs++; work += 3;
      const pair = classifyPair(input, enemy, segment, time, arrival, !!arrival && valid(arrival), actorIds);
      row.next++;
      if (pair.state === 'inside') {
        row.state = 'inside'; row.done = true; row.pendingPairs = 0; row.unknown = null; row.validThroughTick = pair.validThroughTick;
        row.witness = { segmentId: segment.id, segmentKey: keys[row.next - 1]!, ...pair.witness! };
      } else if (pair.state === 'pending') {
        row.state = 'pending'; row.pendingPairs++;
        row.unknown ??= { segmentId: segment.id, reason: pair.reason };
        row.validThroughTick = Math.min(row.validThroughTick ?? Infinity, pair.validThroughTick ?? input.observedTick);
      }
    }
    if (row.next >= keys.length) row.done = true;
    if (!row.done) { deferredPairs += keys.length - row.next; nextEnemyId ??= input.enemies[(index + 1) % input.enemies.length]!.unit.id; }
  }
  const action: ActionCursor = { globalKey, segments: keys, rows, ...(nextEnemyId ? { nextEnemyId } : {}) };
  const retained = retain(input.ownerId, binding.declarationId, action, previous);
  return { input, rows, progress: { ...empty('pending', 'envelope-scan-complete').progress, ...retained,
    work, inspectionWork, dependencyWork, aggregationWork, retentionWork, evaluatedPairs, reusedPairs, deferredPairs } };
}

/** Separate pure phase for independent CPU measurement. The paired scan carries
 * its own input, preventing cross-declaration aggregation. Only cursor persists. */
export function aggregateThreatEnvelope({ input, progress: scan, rows }: ThreatEnvelopeScan): ThreatEnvelopeResult {
  if (!rows) return scan;
  const { exposure } = input;
  const possible: EnvelopeEnemy[] = [], unknownPairs: ThreatEnvelopeResult['unknownPairs'][number][] = [];
  const witnesses: ThreatEnvelopeResult['witnesses'][number][] = [];
  let unresolvedPairs = scan.deferredPairs;
  for (const enemy of input.enemies) {
    const row = rows[enemy.unit.id]!; unresolvedPairs += row.pendingPairs;
    if (!row.done) unknownPairs.push({ enemyId: enemy.unit.id, segmentId: exposure.route.segments[row.next]!.id, reason: 'envelope-pair-budget-pending' });
    if (row.unknown) unknownPairs.push({ enemyId: enemy.unit.id, ...row.unknown });
    if (row.state === 'inside') {
      const witness = row.witness!;
      witnesses.push({ enemyId: enemy.unit.id, segmentId: witness.segmentId, point: witness.point,
        enemyArrivalTick: input.observedTick + witness.travelTicks, passageTick: witness.passageTick });
      possible.push(enemy);
    } else if (row.state === 'pending' || !row.done) possible.push(enemy);
  }
  const knownIds = new Set(witnesses.map(w => w.enemyId));
  const candidates = possible.filter(e => knownIds.has(e.unit.id));
  const totalForce = candidates.reduce((sum, e) => sum + (e.capability.interruptForce ?? 0), 0);
  let state: ThreatEnvelopeResult['state'] = 'known', reason = 'envelope-complete';
  if (possible.some(e => !knownIds.has(e.unit.id)) || candidates.length > 0
    && (candidates.some(e => e.capability.interruptForce === null) || exposure.resistance.force === null)) {
    state = 'pending'; reason = 'envelope-membership-or-interruption-pending';
  }
  const effective = state === 'known' && totalForce < exposure.resistance.force! ? [] : candidates;
  const factors: { enemyId: string; kind: UnitKind; q: number }[] = [], unsupportedKinds: UnitKind[] = [];
  for (const e of effective) {
    const prior = input.qByKind[e.unit.kind], q = prior ?? 1;
    if (!Number.isFinite(q) || q < 0 || q > 1) return { ...scan, state: 'invalid', reason: 'envelope-kind-prior-invalid' };
    if (prior === undefined && !unsupportedKinds.includes(e.unit.kind)) unsupportedKinds.push(e.unit.kind);
    factors.push({ enemyId: e.unit.id, kind: e.unit.kind, q });
  }
  factors.sort((a, b) => a.enemyId < b.enemyId ? -1 : a.enemyId > b.enemyId ? 1 : 0);
  return { ...scan, state, reason, envelope: factors.map(f => f.enemyId),
    probability: state === 'known' ? factors.reduce((p, f) => p * (1 - f.q), 1) : null,
    factors, unknownPairs, witnesses, unsupportedKinds, unresolvedPairs };
}
export function advanceThreatEnvelope(input: ThreatEnvelopeInput, previous: ThreatEnvelopeCursor, allowance: number): ThreatEnvelopeResult {
  return aggregateThreatEnvelope(scanThreatEnvelope(input, previous, allowance));
}

function classifyPair(input: ThreatEnvelopeInput, enemy: EnvelopeEnemy, segment: ExposureSegment,
  time: Readonly<{ fromTick: number; throughTick: number }>, arrival: EnvelopeArrival | undefined,
  validArrival: boolean, actorIds: ReadonlySet<string>): Pair {
  const { unit, capability } = enemy;
  const pair: Pair = { state: 'pending', reason: 'envelope-native-arrival-pending',
    validFromTick: input.observedTick, validThroughTick: null, witness: null };
  if (unit.hp <= 0 || !capability.armed || unit.cabin && !unit.cabin.breached
    || unit.expiresTick !== undefined && unit.expiresTick <= Math.max(input.observedTick, time.fromTick)
    || time.throughTick < input.observedTick) {
    pair.state = 'outside'; pair.reason = 'enemy-unavailable-or-exposure-finished'; return pair;
  }
  const distance = Math.max(0, Math.sqrt(pointSegmentDistanceSquared(unit, segment.from, segment.to)) - (capability.reach ?? Infinity));
  const lowerTicks = capability.maxSpeed === null ? 0 : capability.maxSpeed > 0 ? distance * SIM_TICKS_PER_SECOND / capability.maxSpeed : distance > 0 ? Infinity : 0;
  const lastPossible = Math.min(time.throughTick - lowerTicks, unit.expiresTick === undefined ? Infinity : unit.expiresTick - 1);
  if (input.observedTick + lowerTicks > time.throughTick) {
    pair.state = 'outside'; pair.reason = 'whole-segment-earliest-arrival-too-late';
  } else if (arrival && !validArrival) pair.reason = 'envelope-arrival-binding-stale';
  else if (arrival?.proof.kind === 'native-whole-segment-unreachable') {
    pair.state = 'outside'; pair.reason = 'native-whole-segment-unreachable';
  } else if (arrival?.proof.kind === 'native-interception') {
    const proof = arrival.proof, dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y;
    const length = dx * dx + dy * dy;
    const fraction = length ? ((proof.point.x - segment.from.x) * dx + (proof.point.y - segment.from.y) * dy) / length : 0;
    const onSegment = finitePoint(proof.point) && fraction >= 0 && fraction <= 1
      && pointSegmentDistanceSquared(proof.point, segment.from, segment.to) <= 1e-12;
    const passageTick = length ? time.fromTick + fraction * (time.throughTick - time.fromTick)
      : Math.min(time.throughTick, unit.expiresTick === undefined ? time.throughTick : unit.expiresTick - 1);
    const arrivalTick = input.observedTick + proof.travelTicks;
    if (!onSegment || !nonnegative(proof.travelTicks) || !actorIds.has(proof.targetId)) pair.reason = 'native-arrival-witness-invalid';
    else if (proof.canAttack !== true) pair.reason = 'native-target-attackability-unconfirmed';
    else if (arrivalTick <= passageTick && (unit.expiresTick === undefined || unit.expiresTick > passageTick)) {
      pair.state = 'inside'; pair.reason = 'native-interception-witness';
      pair.validThroughTick = passageTick - proof.travelTicks;
      pair.witness = { point: { x: proof.point.x, y: proof.point.y }, enemyArrivalTick: arrivalTick, passageTick, travelTicks: proof.travelTicks };
    } else pair.reason = 'native-witness-late-not-whole-segment-proof';
  }
  if (pair.state === 'pending') pair.validThroughTick = Number.isFinite(lastPossible) ? lastPossible : input.observedTick;
  return pair;
}
