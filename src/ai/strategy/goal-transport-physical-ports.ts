import { bodyMass } from '../../shared/physical-body';
import { distanceToHull, shareShipProfile, shipProfile } from '../../shared/ship-geometry';
import { BOARDING_GAP } from '../../shared/naval';
import { hullFits } from '../../shared/ship-navigation';
import { isWalkable } from '../../shared/terrain';
import { isTransportKind } from '../../shared/transport-role';
import { fnv1a } from '../../shared/sim/checksum';
import type { GameSnapshot, Unit } from '../../shared/types';
import { createGoalBoardingGeometry, type GoalNativeGroundReader } from './goal-boarding-geometry';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalGeometryReader, GoalHullCandidate, GoalPublishedValue, GoalShorePair, GoalTransportFactPorts } from './goal-grounding-ports';
import type { GoalCandidates, GoalFactReader, GoalGroundingReader, GoalProductionOption } from './goal-planner-types';
import type { PointRouteFact } from './point-routes';
import { landIdAt, seaIdAt, type RegionIndex } from './regions';
import type { Point, Target } from './types';
import type { VoyageRisk, VoyageRiskRequest } from './voyage-risk';

type Deferred = NonNullable<Extract<GoalCandidates<never>, { state: 'met' }>['deferred']>[number];
export type GoalTransportPhysicalInput = Readonly<{
  snapshot: GameSnapshot; owner: string; tick: number; byTick: number; regions: RegionIndex;
  geometry: GoalGeometryReader; geometryRevision: string; readFact: GoalFactReader;
  /** Prepared terrain/coast-index version, independent of moving bodies. */
  shoreGeometryRevision?: string;
  resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']>;
  productionOptions: GoalGroundingReader['productionOptions'];
  resolveProducedHull?: (option: GoalProductionOption, unitKind: 'transport' | 'carrier') => GoalPublishedValue<GoalHullCandidate>;
  readGroundPoint?: GoalNativeGroundReader;
  readPointRoute: (ship: Unit, from: Point & { heading: number }, to: Point, future: boolean) => Readonly<{ id: string; fact: PointRouteFact }>;
  /** Registers/reads the central same-think batch; the domain never samples. */
  readVoyageRisk?: (request: VoyageRiskRequest) => VoyageRisk;
  /** A bounded alternative prefix, never proof of exhaustive infeasibility. */
  shorePairLimit?: number;
  /** Selected proposal refinement limits hull checks to these identities. */
  hullReferences?: readonly import('./goal-planner-types').GoalEntityReference[];
  /** Normal planner commands need connectivity; native timing refines in the background. */
  travelTimePolicy?: 'connectivity-estimate';
  /** A future dock is a target pose, independent of a hull currently turning. */
  berthOrientation?: 'shore';
}>;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unique = (ids: readonly string[]) => [...new Set(ids)].sort();
const reason = (code: string, factIds: readonly string[] = [], values: Record<string, number | string | boolean | null> = {}) => ({ code, factIds, values });
const sameRefs = (a: readonly { reference: unknown }[], b: readonly unknown[]) => goalValueKey(unique(a.map(item => goalValueKey(item.reference)))) === goalValueKey(unique(b.map(goalValueKey)));
function candidates<T>(known: readonly T[], deferred: readonly Deferred[], factIds: readonly string[]): GoalCandidates<T> {
  return known.length ? { state: 'met', candidates: known, factIds, ...(deferred.length ? { deferred } : {}) }
    : deferred.length ? { state: 'pending', requestIds: unique(deferred.flatMap(item => item.requestIds)),
      reason: reason('transport-physical-facts-pending', unique(deferred.flatMap(item => item.reason.factIds))) }
    : { state: 'unmet', reason: reason('no-compatible-transport-candidate', factIds) };
}

/** Native transport rules behind the one owner-think source. This factory
 * owns no Situation/query/work allowance and invokes no private pathfinder. */
export function createGoalTransportFactPorts(input: GoalTransportPhysicalInput): GoalTransportFactPorts {
  const nativeBerth = createGoalBoardingGeometry(input);
  const scanBerth: GoalTransportFactPorts['berth'] = (passenger, hull, shore) => {
    if (input.berthOrientation !== 'shore') return nativeBerth(passenger, hull, shore);
    // Only the proposal's preferred heading changes. The finite native scan
    // still proves hull fit, shared boarding gap and the exact land/sea pair.
    const assessment = { ...hull.assessment, sailing: { ...hull.assessment.sailing!,
      heading: Math.atan2(shore.water.y - shore.ground.y, shore.water.x - shore.ground.x) } };
    shareShipProfile(hull.assessment, assessment);
    return nativeBerth(passenger, { ...hull, assessment }, shore);
  };
  const berth: GoalTransportFactPorts['berth'] = (passenger, hull, shore, preferredPose) => {
    if (!preferredPose) return scanBerth(passenger, hull, shore);
    const pose = { x: preferredPose.x, y: preferredPose.y, heading: preferredPose.heading };
    const ground = { x: shore.ground.x, y: shore.ground.y }, profile = shipProfile(hull.assessment);
    const contact = { landId: shore.landId, seaId: shore.seaId, ground, water: { ...shore.water } };
    const tag = `preferred-boarding-pose:${goalValueKey([hull.reference, pose, passenger.radius, contact])}`;
    const pending = (code: string): GoalPublishedValue<never> => ({ state: 'pending', requestIds: [tag],
      reason: reason(code, hull.factIds) });
    if (![pose.x, pose.y, pose.heading, ground.x, ground.y, shore.water.x, shore.water.y, passenger.radius].every(Number.isFinite)
      || passenger.radius < 0) return pending('preferred-boarding-pose-invalid');
    if (!profile) return pending('preferred-boarding-profile-unpublished');
    if (input.regions.scannedRows < input.regions.totalRows) return pending('preferred-boarding-regions-unpublished');
    const shapeVersion = input.geometry.reference?.(`preferred-boarding-hull:${hull.assessment.kind}`, { hull: profile.hull });
    const shoreVersion = input.geometry.reference?.('preferred-boarding-shore', contact);
    const references = shapeVersion && shoreVersion ? [shapeVersion, shoreVersion] : undefined;
    const key = `preferred-boarding-pose:${goalValueKey(references
      ? [hull.reference, pose, passenger.radius, shapeVersion, shoreVersion]
      : [hull.reference, pose, passenger.radius, profile.hull, contact])}`;
    const read = input.geometry<{ step: number }, { valid: boolean }>({ key, revision: input.geometryRevision,
      ...(references ? { references } : {}), initialState: { step: 0 },
      advance(state, allowance) {
        const dock = { ...hull.assessment, x: pose.x, y: pose.y,
          sailing: { ...hull.assessment.sailing!, heading: pose.heading } };
        shareShipProfile(hull.assessment, dock);
        // Each check is one bounded native geometry primitive, as in the
        // shared nearest-pose cursor. There is no search or route here.
        const checks = [
          () => isWalkable(input.snapshot.map, ground.x, ground.y, 'land'),
          () => isWalkable(input.snapshot.map, pose.x, pose.y, 'sea'),
          () => landIdAt(input.snapshot.map, ground) === shore.landId,
          () => seaIdAt(input.snapshot.map, pose) === shore.seaId,
          () => hullFits(input.snapshot.map, dock, pose),
          () => distanceToHull(dock, ground) <= passenger.radius + BOARDING_GAP,
        ];
        let work = 0;
        while (work < allowance && state.step < checks.length) {
          const valid = checks[state.step++]!(); work++;
          if (!valid) return { state, work, done: true, value: { valid: false } };
        }
        return { state, work, done: state.step === checks.length,
          ...(state.step === checks.length ? { value: { valid: true } } : {}) };
      } });
    if (read.state !== 'met') return read;
    return read.value.valid ? { state: 'met', value: { water: { x: pose.x, y: pose.y }, ground, heading: pose.heading },
      factIds: unique([...hull.factIds, ...read.factIds]) } : scanBerth(passenger, hull, shore);
  };
  return {
    berth,
    shores(from, to) {
      if (!to.landId || !input.regions.lands.has(to.landId) || !from.landId && !from.seaId)
        return { state: 'pending', requestIds: [`shore-regions:${goalValueKey([from, to])}`], reason: reason('transport-region-binding-pending') };
      const landings = input.regions.shoresByLand.get(to.landId);
      const departures = from.landId ? input.regions.shoresByLand.get(from.landId) : undefined;
      const seas = [...(landings?.keys() ?? [])].filter(sea => from.seaId ? sea === from.seaId : departures?.has(sea)).sort();
      if (!seas.length) return { state: 'unmet', reason: reason('no-shared-transport-sea') };
      const limit = input.shorePairLimit ?? 16;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) return { state: 'pending', requestIds: ['shore-alternative-limit'], reason: reason('shore-alternative-limit-invalid') };
      type RankedIndex = { index: number; rank: number; id: string };
      type RankedPair = { sea: number; departure: number; landing: number; rank: number; id: string };
      type State = { sea: number; scan: number; phase: 'departures' | 'landings' | 'pairs';
        departure: number; landing: number; count: number; considered: number;
        starts: RankedIndex[]; ends: RankedIndex[]; best: RankedPair[] };
      const tag = (shore: NonNullable<GoalShorePair['departure']>) => `${shore.landId}:${shore.ground.x},${shore.ground.y}:${shore.water.x},${shore.water.y}`;
      const keep = <T extends { rank: number; id: string }>(list: T[], item: T) => {
        list.push(item); list.sort((a, b) => a.rank - b.rank || order(a.id, b.id)); if (list.length > limit) list.pop();
      };
      // An aboard request ranks only destination shores. Its hull's moving
      // pose is consumed by seaLeg, not by this finite coast enumeration.
      const originKey = from.landId ? from : { seaId: from.seaId };
      const key = `shore-pair-indices:${goalValueKey([originKey, to, limit])}`;
      const read = input.geometry<State, { pairs: RankedPair[]; count: number; considered: number }>({ key, revision: input.shoreGeometryRevision ?? input.geometryRevision,
        initialState: { sea: 0, scan: 0, phase: 'departures', departure: 0, landing: 0, count: 0, considered: 0, starts: [], ends: [], best: [] },
        advance(state, allowance) {
          let work = 0;
          while (work < allowance && state.sea < seas.length) {
            const seaId = seas[state.sea]!, ends = landings!.get(seaId)!, starts = departures?.get(seaId);
            if (state.phase === 'departures') {
              if (starts && state.scan < starts.length) {
                const index = state.scan++, shore = starts[index]!; work++;
                keep(state.starts, { index, rank: Math.hypot(shore.ground.x - from.point.x, shore.ground.y - from.point.y), id: `${tag(shore)}>` });
              } else { state.phase = 'landings'; state.scan = 0; }
              continue;
            }
            if (state.phase === 'landings') {
              if (state.scan < ends.length) {
                const index = state.scan++, shore = ends[index]!; work++;
                keep(state.ends, { index, rank: Math.hypot(shore.ground.x - to.point.x, shore.ground.y - to.point.y), id: tag(shore) });
              } else { state.phase = 'pairs'; state.count += ends.length * (starts?.length ?? 1); }
              continue;
            }
            if (state.departure >= (starts ? state.starts.length : 1) || !state.ends.length) {
              state.sea++; state.scan = 0; state.phase = 'departures'; state.departure = 0; state.landing = 0; state.starts = []; state.ends = []; continue;
            }
            const d = starts ? state.starts[state.departure]! : null, l = state.ends[state.landing]!;
            const departure = d ? starts![d.index]! : undefined, landing = ends[l.index]!;
            const id = `shore:${seaId}:${departure ? tag(departure) : 'aboard'}>${tag(landing)}`;
            work++; state.considered++;
            keep(state.best, { sea: state.sea, departure: d?.index ?? -1, landing: l.index, rank: (d?.rank ?? 0) + l.rank, id });
            state.landing++;
            if (state.landing >= state.ends.length) { state.landing = 0; state.departure++; }
          }
          const done = state.sea >= seas.length;
          // For additive pair ordering, an endpoint outside its top K already
          // has K better partners with the same other endpoint. Only K² pairs
          // per sea need examination; the returned prefix is still exact.
          return { state: done ? { ...state, starts: [], ends: [], best: [] } : state, work, done,
            ...(done ? { value: { pairs: state.best, count: state.count, considered: state.considered } } : {}) };
        } });
      if (read.state !== 'met') return read;
      // The immutable, versioned region index already owns each Shore once.
      // Retain only indices in the publication, not repeated endpoint objects.
      const pairs: GoalShorePair[] = read.value.pairs.map(item => {
        const seaId = seas[item.sea]!, departure = item.departure < 0 ? undefined : departures!.get(seaId)![item.departure];
        return { id: item.id, seaId, ...(departure ? { departure } : {}), landing: landings!.get(seaId)![item.landing]! };
      });
      const omitted = read.value.count - read.value.pairs.length;
      return candidates(pairs, omitted > 0 ? [{ id: `${key}:remaining`, requestIds: [`${key}:remaining`],
        reason: reason('shore-alternative-prefix-limited', read.factIds, { retained: read.value.pairs.length, totalPossible: read.value.count, consideredPairs: read.value.considered, omitted, nextLimit: limit * 2 }) }] : [], read.factIds);
    },
    hulls(seaId, from, mass, request) {
      const resolved = input.resolveCohort(request.cohort);
      if (resolved.state !== 'met') return resolved;
      if (!request.cohort.length || !sameRefs(resolved.candidates, request.cohort)) return { state: 'pending',
        requestIds: [`transport-cohort:${goalValueKey(request.cohort)}`], reason: reason('transport-cohort-binding-pending') };
      const waiting = resolved.candidates.filter(member => !member.assessment.deck && !member.assessment.cabin);
      const actualMass = waiting.reduce((sum, member) => sum + bodyMass(member.assessment), 0);
      if (!Number.isFinite(mass) || Math.abs(mass - actualMass) > 1e-7) return { state: 'unmet', reason: reason('transport-payload-binding-mismatch') };
      const known: GoalHullCandidate[] = [], deferred: Deferred[] = [...(resolved.deferred ?? [])], proofs = new Set(resolved.factIds);
      for (const ship of input.snapshot.units) {
        if (ship.owner !== input.owner || ship.hp <= 0 || !isTransportKind(ship.kind) || seaIdAt(input.snapshot.map, ship) !== seaId) continue;
        if (input.hullReferences && !input.hullReferences.some(ref => ref.kind === 'existing' && ref.entityId === ship.id)) continue;
        const profile = shipProfile(ship); if (!profile) continue;
        const cargo = input.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === ship.id);
        const capacity = Math.max(0, profile.loadCapacity - cargo.reduce((sum, unit) => sum + bodyMass(unit), 0));
        if (capacity < actualMass) continue;
        const reference = { kind: 'existing' as const, entityId: ship.id };
        const availability = goalFact({ kind: 'transport-in', seaId, capacity: actualMass, transport: reference, byTick: input.byTick });
        known.push({ id: `hull:${ship.id}`, reference, seaId, assessment: ship, availableTick: input.tick,
          capacity, cargoUnitIds: cargo.map(unit => unit.id).sort(), preconditions: [availability], factIds: [availability.id] });
        proofs.add(availability.id);
      }
      for (const kind of input.hullReferences?.every(ref => ref.kind === 'existing') ? [] : ['transport', 'carrier'] as const) {
        const production = input.productionOptions(kind, { ...from, seaId });
        if (production.state === 'pending') { deferred.push({ id: `produce:${kind}:${seaId}`, requestIds: production.requestIds, reason: production.reason }); continue; }
        if (production.state !== 'met') continue;
        production.factIds.forEach(id => proofs.add(id)); deferred.push(...(production.deferred ?? []));
        for (const option of production.candidates) {
          const produced = input.resolveProducedHull?.(option, kind);
          if (!produced) { deferred.push({ id: option.id, requestIds: [option.id], reason: reason('produced-hull-metadata-unquoted', option.factIds) }); continue; }
          if (produced.state === 'pending') { deferred.push({ id: option.id, requestIds: produced.requestIds, reason: produced.reason }); continue; }
          if (produced.state !== 'met') continue;
          const hull = produced.value;
          const profile = shipProfile(hull.assessment), capacity = Math.min(hull.capacity, profile?.loadCapacity ?? 0);
          if (hull.reference.kind === 'existing' || hull.seaId !== seaId || hull.assessment.kind !== kind
            || hull.assessment.owner !== input.owner || hull.assessment.hp <= 0 || hull.cargoUnitIds.length
            || !Number.isFinite(hull.availableTick) || !Number.isFinite(capacity) || capacity < actualMass) continue;
          known.push({ ...hull, capacity, preconditions: [...option.preconditions, ...hull.preconditions],
            factIds: unique([...option.factIds, ...produced.factIds, ...hull.factIds]) });
          produced.factIds.forEach(id => proofs.add(id));
        }
      }
      return candidates([...new Map(known.map(hull => [goalValueKey(hull.reference), hull])).values()]
        .sort((a, b) => order(goalValueKey(a.reference), goalValueKey(b.reference))), deferred, [...proofs].sort());
    },
    seaLeg(hull, from, to, future) {
      const ship = { ...hull.assessment, x: from.x, y: from.y,
        sailing: { ...hull.assessment.sailing!, heading: from.heading } };
      if (hull.reference.kind !== 'existing') ship.id = `goal-hull:${goalValueKey(hull.reference)}`;
      shareShipProfile(hull.assessment, ship);
      const answer = input.readPointRoute(ship, from, to, future), fact = answer.fact;
      if (fact.status !== 'complete' && input.travelTimePolicy === 'connectivity-estimate'
        && seaIdAt(input.snapshot.map, from) === hull.seaId && seaIdAt(input.snapshot.map, to) === hull.seaId) {
        const request = hull.reference.kind === 'existing' ? { id: `goal-sea-estimate:${hull.reference.entityId}:${fnv1a(goalValueKey([hull.seaId, from, to]))}`,
          seaId: hull.seaId, shipId: hull.reference.entityId, start: { ...from }, destination: { ...to } } : null;
        const risk = request && input.readVoyageRisk ? input.readVoyageRisk(request) : { status: 'unknown' as const,
          reasonCode: 'goal-voyage-basin-risk-unpublished', samples: 0, totalSamples: 0, threatIds: [] };
        return { state: 'met', value: { ticks: Math.floor(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, ship.speed) * 20),
          endpoint: { ...to }, heading: from.heading, timeBasis: 'sea-connectivity-estimate', risk },
          factIds: [answer.id, ...(request ? [request.id] : [])] };
      }
      if (fact.status !== 'complete') return fact.status === 'static-infeasible'
        ? { state: 'unmet', reason: reason(fact.reasonCode, [answer.id]) }
        : { state: 'pending', requestIds: [answer.id], reason: reason(fact.reasonCode, [answer.id]) };
      const end = fact.route.points.at(-1) ?? from;
      if (fact.route.partial || !Number.isFinite(fact.ticks) || fact.ticks < 0 || !Number.isFinite(end.heading)
        || Math.hypot(end.x - to.x, end.y - to.y) > ship.radius) return { state: 'pending', requestIds: [answer.id],
          reason: reason('native-point-route-end-unpublished', [answer.id]) };
      const request: VoyageRiskRequest | null = hull.reference.kind === 'existing' ? {
        id: `goal-sea-leg:${hull.reference.entityId}:${fnv1a(goalValueKey([hull.seaId, from, to, fact.route]))}`,
        seaId: hull.seaId, shipId: hull.reference.entityId, start: { ...from }, destination: { x: end.x, y: end.y },
        route: { points: fact.route.points, partial: false },
      } : null;
      const risk = request && input.readVoyageRisk ? input.readVoyageRisk(request) : {
        status: 'unknown' as const, reasonCode: request ? 'goal-voyage-risk-port-unpublished' : 'goal-voyage-hull-not-yet-actual',
        samples: 0, totalSamples: 0, threatIds: [],
      };
      return { state: 'met', value: { ticks: fact.ticks, endpoint: { x: end.x, y: end.y }, heading: end.heading, timeBasis: 'native-point-route', risk },
        factIds: [answer.id, ...(request ? [request.id] : [])] };
    },
  };
}
