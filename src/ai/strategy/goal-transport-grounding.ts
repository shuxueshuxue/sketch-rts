import { unitMover } from '../../shared/catalog';
import { bodyMass } from '../../shared/physical-body';
import { isTransportKind } from '../../shared/transport-role';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import { BOARDING_GAP } from '../../shared/naval';
import { distanceToHull, shareShipProfile, shipProfile } from '../../shared/ship-geometry';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AllocationReason } from './allocation-types';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalBerth, GoalHullCandidate, GoalPublishedValue, GoalSeaLeg, GoalTransportFactPorts } from './goal-grounding-ports';
import type { GoalNavalMember } from './goal-naval-actions';
import type { GoalCandidates, GoalFact, GoalFactReader, GoalTransportOption, GoalTransportRequest } from './goal-planner-types';
import { landIdAt, seaIdAt, type Shore } from './regions';
import type { Point, Target } from './types';
import { valueGoalSeaLeg } from './goal-sea-leg-value';

type Deferred = NonNullable<Extract<GoalCandidates<never>, { state: 'met' }>['deferred']>[number];
export type GoalTransportGroundingInput = Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; tick: number; byTick: number; from: Target; to: Target;
  request: GoalTransportRequest; members: GoalPublishedValue<readonly GoalNavalMember[]>;
  ports: GoalTransportFactPorts; readFact: GoalFactReader;
}>;
const reason = (code: string, factIds: readonly string[] = [], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });
const finitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Map published physical candidates into atomic transport alternatives. Every
 * expensive answer comes from the injected owner-think ports. This module has
 * no query, Situation, native route fallback or private work allowance. */
export function groundGoalTransportOptions(input: GoalTransportGroundingInput): GoalCandidates<GoalTransportOption> {
  if (input.members.state !== 'met') return input.members;
  const members = [...input.members.value].sort((a, b) => order(goalValueKey(a.reference), goalValueKey(b.reference)));
  const requested = sorted(input.request.cohort.map(goalValueKey));
  if (!members.length || goalValueKey(sorted(members.map(member => goalValueKey(member.reference)))) !== goalValueKey(requested)
    || members.some(member => member.assessment.owner !== input.owner || member.assessment.hp <= 0 || unitMover(member.assessment.kind) !== 'land'))
    return { state: 'unmet', reason: reason('transport-cohort-binding-invalid') };
  const actual = new Map(input.snapshot.units.map(unit => [unit.id, unit]));
  if (members.some(member => member.assessment.expiresTick !== undefined || (member.reference.kind === 'existing'
    ? !actual.has(member.reference.entityId) || actual.get(member.reference.entityId)!.owner !== input.owner
      || actual.get(member.reference.entityId)!.hp <= 0 || actual.get(member.reference.entityId)!.kind !== member.assessment.kind
    : !!(member.assessment.deck || member.assessment.cabin))))
    return { state: 'unmet', reason: reason('transport-cohort-binding-invalid') };
  const aboard = members.flatMap(member => {
    const unit = member.reference.kind === 'existing' ? actual.get(member.reference.entityId) : undefined;
    const shipId = unit?.deck?.shipId ?? unit?.cabin?.shipId;
    return shipId ? [{ member, shipId }] : [];
  });
  const hullIds = sorted(aboard.map(entry => entry.shipId));
  if (hullIds.length > 1) return { state: 'unmet', reason: reason('transport-cohort-needs-separate-voyages', hullIds) };
  const loadedRefs = new Set(aboard.map(entry => goalValueKey(entry.member.reference)));
  const waiting = members.filter(member => !loadedRefs.has(goalValueKey(member.reference)));
  const origin = waiting.length ? 'land' as const : 'aboard' as const;
  const newMass = waiting.reduce((sum, member) => sum + bodyMass(member.assessment), 0);
  const proofs = new Set(input.members.factIds), deferred = new Map<string, Deferred>(), blocked: AllocationReason[] = [];
  let pathProofs = proofs;
  const addDeferred = (id: string, requestIds: readonly string[], why: AllocationReason) => {
    const old = deferred.get(id);
    deferred.set(id, { id, requestIds: sorted([...(old?.requestIds ?? []), ...requestIds]), reason: why });
  };
  function unwrap<T>(id: string, value: GoalPublishedValue<T>): T | undefined {
    if (value.state === 'pending') { addDeferred(id, value.requestIds, value.reason); return undefined; }
    if (value.state === 'unmet') { blocked.push(value.reason); return undefined; }
    value.factIds.forEach(id => { proofs.add(id); pathProofs.add(id); }); return value.value;
  }
  const shoreResult = input.ports.shores(input.from, input.to);
  if (shoreResult.state !== 'met') return shoreResult;
  shoreResult.factIds.forEach(id => proofs.add(id));
  shoreResult.deferred?.forEach(item => addDeferred(item.id, item.requestIds, item.reason));
  const hullsBySea = new Map<string, GoalCandidates<GoalHullCandidate>>(), options: GoalTransportOption[] = [];
  function berth(id: string, member: GoalNavalMember, hull: GoalHullCandidate, shore: Shore): GoalBerth | undefined {
    const value = unwrap(id, input.ports.berth(member.assessment, hull, shore));
    if (!value) return;
    if (!finitePoint(value.water) || !finitePoint(value.ground) || !Number.isFinite(value.heading)) {
      addDeferred(id, [id], reason('transport-native-berth-invalid', hull.factIds)); return;
    }
    return value;
  }
  function commonBerth(id: string, cohort: readonly GoalNavalMember[], hull: GoalHullCandidate, shore: Shore) {
    const first = berth(`${id}/0`, cohort[0]!, hull, shore);
    if (!first) return;
    // Recheck the first member against the chosen pair too: the shared native
    // projection may change when its shore input is replaced by that pair.
    for (let i = 0; i < cohort.length; i++) {
      const next = berth(`${id}/${i}`, cohort[i]!, hull, { ...shore, water: first.water, ground: first.ground });
      if (!next) return;
      if (gap(next.water, first.water) > hull.assessment.radius) {
        blocked.push(reason('transport-cohort-has-no-common-berth', hull.factIds)); return;
      }
    }
    return first;
  }
  function leg(id: string, value: ReturnType<GoalTransportFactPorts['seaLeg']>): GoalSeaLeg | undefined {
    const found = unwrap(id, value);
    if (!found) return;
    if (!finitePoint(found.endpoint) || !Number.isFinite(found.heading) || !Number.isFinite(found.ticks) || found.ticks < 0) {
      addDeferred(id, [id], reason('transport-sea-leg-pending')); return;
    }
    return found;
  }
  function dockAt(hull: GoalHullCandidate, value: GoalSeaLeg) {
    const dock = { ...hull.assessment, x: value.endpoint.x, y: value.endpoint.y,
      sailing: { ...hull.assessment.sailing!, heading: value.heading } };
    shareShipProfile(hull.assessment, dock);
    return dock;
  }
  /** A road ending near the requested water point does not prove boarding at
   * that road's actual final heading. Only cheap native geometry/region reads
   * occur here; a changed berth still goes through the injected shared ports. */
  function arrivedBerth(id: string, cohort: readonly GoalNavalMember[], hull: GoalHullCandidate,
    shore: Shore, requested: GoalBerth, value: GoalSeaLeg): GoalBerth | AllocationReason | undefined {
    const dock = dockAt(hull, value), factIds = sorted(pathProofs);
    const land = landIdAt(input.snapshot.map, requested.ground), sea = seaIdAt(input.snapshot.map, value.endpoint);
    if (!shipProfile(dock) || !land || !sea || cohort.some(member => !Number.isFinite(member.assessment.radius) || member.assessment.radius < 0)) {
      addDeferred(id, factIds.length ? factIds : [id], reason('transport-terminal-geometry-unpublished', factIds)); return;
    }
    if (land !== shore.landId || sea !== shore.seaId) return reason('transport-terminal-on-wrong-region', factIds,
      { expectedLand: shore.landId, actualLand: land, expectedSea: shore.seaId, actualSea: sea });
    const distance = distanceToHull(dock, requested.ground);
    const missing = cohort.find(member => distance > member.assessment.radius + BOARDING_GAP);
    if (missing) return reason('transport-terminal-cannot-board-cohort', factIds,
      { distance, radius: missing.assessment.radius, x: value.endpoint.x, y: value.endpoint.y, heading: value.heading });
    return { water: { ...value.endpoint }, ground: requested.ground, heading: value.heading };
  }
  function berthedLeg(id: string, cohort: readonly GoalNavalMember[], hull: GoalHullCandidate,
    shore: Shore, from: Point & { heading: number }, future: boolean) {
    let seed = shore, physicalHull = hull;
    // One finite rebind handles a native projected endpoint. No loop performs
    // private routing work or invents a new FactWork allowance.
    for (let attempt = 0; attempt < 2; attempt++) {
      const requested = commonBerth(`${id}/berth-${attempt}`, cohort, physicalHull, seed);
      if (!requested) return;
      const sailed = leg(`${id}/leg-${attempt}`, input.ports.seaLeg(hull, from, requested.water, future));
      if (!sailed) return;
      // Connectivity establishes that this published berth can be requested;
      // it does not observe a native terminal pose. Keep its expected heading
      // for the next leg and leave actual boarding checks to execution.
      if (sailed.timeBasis === 'sea-connectivity-estimate') return { berth: requested,
        leg: { ...sailed, endpoint: requested.water, heading: requested.heading } };
      const actual = arrivedBerth(`${id}/terminal-${attempt}`, cohort, hull, seed, requested, sailed);
      if (!actual) return;
      if ('water' in actual) return { berth: actual, leg: sailed };
      if (attempt === 1) { blocked.push(actual); return; }
      seed = { ...shore, water: { ...sailed.endpoint }, ground: requested.ground };
      physicalHull = { ...hull, assessment: dockAt(hull, sailed) };
    }
  }
  function pickupTicks(id: string, shore: Shore, cohort: readonly GoalNavalMember[]): { ticks: number; facts: GoalFact[] } | undefined {
    let longest = 0;
    const facts: GoalFact[] = [];
    for (const member of cohort) {
      // Fighters first satisfy the separate force-at pickup-post prerequisite.
      // Workers are a callable region pool and walk from their own known pose.
      if (member.assessment.kind !== 'worker') continue;
      const from = { landId: shore.landId, point: { x: member.assessment.x, y: member.assessment.y } };
      const fact = goalFact({ kind: 'route', mover: 'land', from,
        to: { landId: shore.landId, point: shore.ground }, actor: member.reference });
      const observed = input.readFact(fact); proofs.add(fact.id); pathProofs.add(fact.id); facts.push(fact);
      if (observed.state === 'pending') { addDeferred(id, [observed.requestId], observed.reason); return; }
      if (observed.state === 'unmet') { blocked.push(observed.reason); return; }
      const measured = observed.route;
      if (!measured || !Number.isFinite(measured.distance) || measured.distance < 0) {
        addDeferred(id, [fact.id], reason('transport-pickup-distance-pending', [fact.id])); return;
      }
      const ticks = measured.ticks ?? (member.assessment.speed > 0 ? Math.ceil(measured.distance / member.assessment.speed * SIM_TICKS_PER_SECOND) : measured.distance === 0 ? 0 : null);
      if (ticks === null || !Number.isFinite(ticks) || ticks < 0) { blocked.push(reason('transport-passenger-cannot-walk', [fact.id])); return; }
      longest = Math.max(longest, ticks);
    }
    return { ticks: longest, facts };
  }
  for (const pair of [...shoreResult.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (input.to.landId && pair.landing.landId !== input.to.landId) { blocked.push(reason('transport-landing-on-wrong-region')); continue; }
    if (origin === 'land' && !pair.departure) {
      addDeferred(pair.id, shoreResult.factIds, reason('transport-departure-shore-pending', shoreResult.factIds)); continue;
    }
    let hullResult = hullsBySea.get(pair.seaId);
    if (!hullResult) {
      hullResult = input.ports.hulls(pair.seaId, input.from, newMass, input.request); hullsBySea.set(pair.seaId, hullResult);
    }
    if (hullResult.state === 'pending') { addDeferred(pair.id, hullResult.requestIds, hullResult.reason); continue; }
    if (hullResult.state === 'unmet') { blocked.push(hullResult.reason); continue; }
    hullResult.factIds.forEach(id => proofs.add(id));
    hullResult.deferred?.forEach(item => addDeferred(item.id, item.requestIds, item.reason));
    for (const hull of [...hullResult.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      const key = `transport-option:${goalValueKey([pair.id, hull.reference, requested])}`;
      if (hull.seaId !== pair.seaId || hull.assessment.owner !== input.owner || hull.assessment.hp <= 0
        || !isTransportKind(hull.assessment.kind) || !Number.isFinite(hull.capacity) || hull.capacity < newMass) {
        blocked.push(reason('transport-payload-or-owner-unavailable', hull.factIds)); continue;
      }
      if (hullIds.length && (hull.reference.kind !== 'existing' || hull.reference.entityId !== hullIds[0])) continue;
      const realHull = hull.reference.kind === 'existing' ? actual.get(hull.reference.entityId) : undefined;
      const cargo = realHull ? input.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === realHull.id) : [];
      if (hull.reference.kind === 'existing' && (!realHull || realHull.owner !== input.owner || realHull.hp <= 0
        || realHull.kind !== hull.assessment.kind || goalValueKey(sorted(cargo.map(unit => unit.id))) !== goalValueKey(sorted(hull.cargoUnitIds)))
        || hull.reference.kind !== 'existing' && hull.cargoUnitIds.length) {
        addDeferred(key, hull.factIds, reason('transport-hull-cargo-binding-pending', hull.factIds)); continue;
      }
      if (cargo.some(unit => unit.owner !== input.owner)) { blocked.push(reason('transport-cargo-owner-unavailable', hull.factIds)); continue; }
      pathProofs = new Set([...input.members.factIds, ...shoreResult.factIds, ...hullResult.factIds, ...hull.factIds]);
      hull.factIds.forEach(id => proofs.add(id));
      let departure: GoalBerth | undefined, approach: GoalFact | undefined;
      let from = { x: hull.assessment.x, y: hull.assessment.y, heading: hull.assessment.sailing?.heading ?? 0 };
      let walk = 0;
      let pickupFacts: GoalFact[] = [];
      if (origin === 'land') {
        const shore = pair.departure!;
        if (input.from.landId && shore.landId !== input.from.landId) { blocked.push(reason('transport-departure-on-wrong-region')); continue; }
        const pickup = berthedLeg(`${key}/pickup`, waiting, hull, shore, from, hull.availableTick > input.tick);
        if (!pickup) continue;
        departure = pickup.berth;
        approach = goalFact({ kind: 'route', mover: 'sea', from: { seaId: pair.seaId, point: { x: from.x, y: from.y } },
          to: { seaId: pair.seaId, point: departure.water }, actor: hull.reference, fromHeading: from.heading });
        from = { ...pickup.leg.endpoint, heading: pickup.leg.heading };
        const walking = pickupTicks(`${key}/pickup-walk`, { ...shore, water: departure.water, ground: departure.ground }, waiting);
        if (walking === undefined) continue;
        walk = walking.ticks; pickupFacts = walking.facts;
      }
      const delivered = berthedLeg(`${key}/landing`, members, hull, pair.landing, from, true);
      if (!delivered) continue;
      const landing = delivered.berth, sailing = delivered.leg;
      const crossing = goalFact({ kind: 'route', mover: 'sea', from: { seaId: pair.seaId, point: { x: from.x, y: from.y } },
        to: { seaId: pair.seaId, point: landing.water }, actor: hull.reference, fromHeading: from.heading });
      const shoreSafe = goalFact({ kind: 'shore-safe', landId: pair.landing.landId,
        landing: { landId: pair.landing.landId, seaId: pair.seaId, point: landing.ground }, throughTick: input.byTick });
      const valuation = valueGoalSeaLeg({ snapshot: input.snapshot, owner: input.owner, hull,
        leg: { state: 'met', value: sailing, factIds: sorted(pathProofs) }, passengers: members.map(member => member.reference) });
      const common = { id: `goal-transport:${goalValueKey({ pair: pair.id, hull: hull.reference, cohort: requested, from, landing, origin })}`,
        seaId: pair.seaId, from: input.from, to: input.to, transport: hull.reference, capacity: hull.capacity,
        loadedUnitIds: sorted(hull.cargoUnitIds), landing, crossing, shoreSafe, preconditions: [...hull.preconditions, ...pickupFacts], ...valuation,
        duration: { state: 'met' as const, value: walk + (waiting.length ? GANGWAY_SETUP_TICKS : 0) + sailing.ticks + GANGWAY_SETUP_TICKS,
          factIds: sorted([...pathProofs, crossing.id, ...(approach ? [approach.id] : [])]) }, factIds: sorted(pathProofs) };
      if (origin === 'land' && departure && approach) options.push({ ...common, origin: 'land', departure, approach });
      else options.push({ ...common, origin: 'aboard', departure: { water: { x: from.x, y: from.y }, heading: from.heading } });
    }
  }
  const waitingAlternatives = [...deferred.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (options.length) return { state: 'met', candidates: [...new Map(options.map(option => [option.id, option])).values()]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), factIds: sorted(proofs),
    ...(waitingAlternatives.length ? { deferred: waitingAlternatives } : {}) };
  if (waitingAlternatives.length) return { state: 'pending', requestIds: sorted(waitingAlternatives.flatMap(item => item.requestIds)),
    reason: reason('transport-alternatives-pending', sorted(waitingAlternatives.flatMap(item => item.reason.factIds)), { alternatives: waitingAlternatives.length }) };
  return { state: 'unmet', reason: blocked[0] ?? reason('transport-no-physical-alternative') };
}
