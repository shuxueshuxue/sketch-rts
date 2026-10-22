import { isOpenGround } from '../../shared/terrain';
import { currentFactWork } from './fact-work';
import { planningFieldKey } from './distance-fields';
import { unitMover } from '../../shared/catalog';
import { bodyMass } from '../../shared/physical-body';
import { shipProfile } from '../../shared/ship-geometry';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import type { Unit } from '../../shared/types';
import { effectiveCombatRating } from '../policy/v6/strength';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { assessAllocatedForce } from './allocated-force';
import type { AllocationLandRouteReader } from './allocation-arrival-query';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { readGoalEconomicFact, type GoalEconomicFactPorts } from './goal-economy-facts';
import { goalPoolMemberCandidates } from './goal-pool-members';
import { readGoalCoarseGeometryFact } from './goal-coarse-facts';
import { goalCampId, goalCampMemberIds, goalValueKey, resolveGoalCamp } from './goal-facts';
import { boundCache, retainCachePins, touchCache, type CacheCapacity, type CacheUse } from './bounded-cache';
import { observationJsonBytes } from './observation-json-bytes';
import type { GoalFact, GoalFactObservation, GoalFactReader, GoalPlanningContext } from './goal-planner-types';
import type { Point } from './types';

/** Evidence identities only. No snapshots, entities, query functions or
 * simulated outputs are retained. Losing an entry loses proof, never invents it. */
export type GoalWorldFactMemory = {
  version: 1; owner: string;
  camps: string[];
  requests: ({ id: string; requestedTick: number } & CacheUse)[];
  campUses?: ({ id: string } & CacheUse)[];
  capacity?: { camps: CacheCapacity; requests: CacheCapacity; payload: CacheCapacity };
};
export type GoalWorldFactPorts = GoalEconomicFactPorts & Readonly<{
  landRoute: AllocationLandRouteReader;
  seaRoute?: (fact: Extract<GoalFact['predicate'], { kind: 'route' }>, actor: Unit) => GoalFactObservation;
  /** Domain resolvers consume these same published readers. They do not
   * construct another Situation, navigation query or work allowance. */
  resolvers?: readonly ((fact: GoalFact, context: GoalPlanningContext) => GoalFactObservation | null)[];
}>;
export type GoalWorldFactInput = Omit<GoalPlanningContext, 'readFact' | 'readProjectedFact'> & Readonly<{
  ports: GoalWorldFactPorts; memory: GoalWorldFactMemory;
  allowedUnitIds?: readonly string[]; interruptedUnitIds?: readonly string[];
  /** Cache references are supplied by the composing caller, outside predicates. */
  cacheUse?: Readonly<{ thinkSequence: number; planIds: () => readonly string[] }>;
}>;

export function createGoalWorldFactMemory(owner: string): GoalWorldFactMemory {
  return { version: 1, owner, camps: [], requests: [] };
}

export const worldCampCacheId = (campId: string) => `world-camp:${campId}`;
type WorldCacheEntry = ({ kind: 'camp'; id: string } | { kind: 'request'; id: string; requestedTick: number }) & CacheUse;
function worldCacheEntries(memory: GoalWorldFactMemory): WorldCacheEntry[] {
  const uses = new Map(memory.campUses?.map(use => [use.id, use]));
  return [...memory.camps.map(id => ({ ...uses.get(id), kind: 'camp' as const, id })),
    ...memory.requests.map(request => ({ ...request, kind: 'request' as const }))];
}
function worldCachePayload(memory: GoalWorldFactMemory, entries: readonly WorldCacheEntry[]) {
  return { version: memory.version, owner: memory.owner,
    camps: entries.filter(entry => entry.kind === 'camp').map(entry => entry.id),
    requests: entries.flatMap(entry => entry.kind === 'request' ? [{ id: entry.id, requestedTick: entry.requestedTick,
      ...(entry.lastUsedThink === undefined ? {} : { lastUsedThink: entry.lastUsedThink }),
      ...(entry.planIds?.length ? { planIds: entry.planIds } : {}) }] : []),
    campUses: entries.flatMap(entry => entry.kind === 'camp' && (entry.lastUsedThink !== undefined || entry.planIds?.length)
      ? [{ id: entry.id, ...(entry.lastUsedThink === undefined ? {} : { lastUsedThink: entry.lastUsedThink }),
        ...(entry.planIds?.length ? { planIds: entry.planIds } : {}) }] : []),
  };
}
const worldCacheId = (entry: WorldCacheEntry) => entry.kind === 'camp' ? worldCampCacheId(entry.id) : `world:${entry.id}`;

/** Preserve both original per-kind count limits and the shared payload limit.
 * Capacity receipts describe metadata separately from the serialized evidence
 * payload. Referenced proof survives overflow until its plan releases it. */
export function boundGoalWorldFactMemory(memory: GoalWorldFactMemory, thinkSequence: number) {
  const entries = worldCacheEntries(memory), policy = {
    id: worldCacheId, lastUsed: (entry: WorldCacheEntry) => entry.lastUsedThink
      ?? (entry.kind === 'request' ? entry.requestedTick : 0),
    plans: (entry: WorldCacheEntry) => entry.planIds ?? [], thinkSequence,
  };
  const camps = boundCache({ ...policy, kind: 'goal-world-camps', entries: entries.filter(entry => entry.kind === 'camp'),
    maxEntries: 64, ...(memory.capacity ? { capacity: memory.capacity.camps } : {}) });
  const requests = boundCache({ ...policy, kind: 'goal-world-requests', entries: entries.filter(entry => entry.kind === 'request'),
    maxEntries: 64, ...(memory.capacity ? { capacity: memory.capacity.requests } : {}) });
  const payload = boundCache({ ...policy, kind: 'goal-world-payload', entries: [...camps.entries, ...requests.entries],
    maxBytes: 16 * 1024, bytes: retained => observationJsonBytes(worldCachePayload(memory, retained)),
    ...(memory.capacity ? { capacity: memory.capacity.payload } : {}) });
  Object.assign(memory, worldCachePayload(memory, payload.entries));
  memory.capacity = { camps: camps.capacity, requests: requests.capacity, payload: payload.capacity };
  return { ...payload, evicted: [...camps.evicted, ...requests.evicted, ...payload.evicted], capacity: memory.capacity };
}

export function retainGoalWorldFactMemory(memory: GoalWorldFactMemory,
  references: ReadonlyMap<string, ReadonlySet<string>>, thinkSequence: number) {
  const entries = worldCacheEntries(memory);
  retainCachePins(entries, references, worldCacheId, thinkSequence);
  Object.assign(memory, worldCachePayload(memory, entries));
  return boundGoalWorldFactMemory(memory, thinkSequence);
}
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const unitRevision = (unit: Unit) => [unit.id, unit.owner, unit.kind, unit.hp, unit.maxHp, unit.x, unit.y,
  unit.attackDamage, unit.attackCooldown, unit.attackRange, unit.speed, unit.level, unit.expiresTick,
  unit.deck, unit.cabin, unit.sailing?.heading];

/** The composing reader for one immutable owner-think snapshot. Geometry and
 * routing are injected from that think's existing query/6144 queue; reading a
 * fact never flushes work or falls back to native route selection. */
export function createGoalFactReader(input: GoalWorldFactInput): GoalFactReader {
  const { snapshot, owner, tick, ports, memory } = input;
  if (memory.version !== 1 || memory.owner !== owner) throw Error('Goal fact memory owner mismatch');
  const available = input.allowedUnitIds === undefined ? null : new Set(input.allowedUnitIds);
  const interrupted = new Set(input.interruptedUnitIds ?? []);
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && unit.expiresTick === undefined
    && (!available || available.has(unit.id)) && !interrupted.has(unit.id)).sort((a, b) => order(a.id, b.id));
  const camps = neutralCampExposure(snapshot);
  const sequence = input.cacheUse?.thinkSequence ?? tick;
  const touchCamp = (id: string) => {
    if (!memory.camps.includes(id)) {
      if (!camps.camps.some(camp => goalCampId(camp.memberIds) === id)) return;
      memory.camps.push(id);
    }
    const uses = memory.campUses ??= [];
    let use = uses.find(use => use.id === id);
    if (!use) { use = { id }; uses.push(use); }
    touchCache(use, sequence, input.cacheUse?.planIds() ?? []);
  };
  for (const camp of camps.camps) {
    const id = goalCampId(camp.memberIds);
    if (!memory.camps.includes(id)) memory.camps.push(id);
  }
  boundGoalWorldFactMemory(memory, sequence);
  const context: GoalPlanningContext = { ...input, readFact: fact => read(fact) };
  const memo = new Map<string, GoalFactObservation>();
  const answer = (fact: GoalFact, met: boolean, code: string, dependencies: unknown,
    extra: Partial<GoalFactObservation> = {}): GoalFactObservation => ({ fact, state: met ? 'met' : 'unmet',
    observedTick: tick, revision: goalValueKey([fact.id, code, dependencies]), evidence: [],
    reason: { code, factIds: [fact.id], values: {} }, ...extra } as GoalFactObservation);
  const pending = (fact: GoalFact, code: string, dependencies: unknown): GoalFactObservation => {
    let request = memory.requests.find(request => request.id === fact.id);
    if (!request) { request = { id: fact.id, requestedTick: tick }; memory.requests.push(request); }
    touchCache(request, sequence, input.cacheUse?.planIds() ?? []);
    boundGoalWorldFactMemory(memory, sequence);
    return { fact, state: 'pending', observedTick: tick, requestId: `world:${fact.id}`, requestedTick: request.requestedTick,
      revision: goalValueKey([fact.id, code, dependencies]), reason: { code, factIds: [fact.id], values: {} }, evidence: [] };
  };
  const atRegion = (unit: Unit, at: Extract<GoalFact['predicate'], { kind: 'unit-available' }>['at'], mover: 'land' | 'sea') => {
    const actual = ports.regionAt(unit, mover), target = mover === 'land' ? at.landId : at.seaId;
    return !!actual && actual === (target ?? ports.regionAt(at.point, mover));
  };
  const passenger = (unit: Unit) => unit.deck?.shipId ?? unit.cabin?.shipId;
  function measure(fact: GoalFact): GoalFactObservation | null {
    const p = fact.predicate;
    if (p.kind === 'route') {
      if (p.actor?.kind === 'pool-member') {
        const profile = p.actor.routeProfile;
        if (!profile) return pending(fact, 'pool-route-profile-pending', p.actor);
        if (p.mover !== 'land' || p.actor.at.landId !== p.from.landId
          || Math.hypot(profile.from.x - p.from.point.x, profile.from.y - p.from.point.y) > 1e-6)
          return answer(fact, false, 'pool-route-origin-mismatch', [p, profile]);
      }
      // Physical routes may describe an opponent; commanding remains restricted to owned leases.
      const actor = p.actor?.kind === 'pool-member' ? goalPoolMemberCandidates({ snapshot, owner, reference: p.actor,
        allowedUnitIds: input.allowedUnitIds, interruptedUnitIds: input.interruptedUnitIds })[0]
        : p.actor?.kind === 'existing' ? snapshot.units.find(unit => unit.hp > 0 && p.actor?.kind === 'existing' && unit.id === p.actor.entityId) : undefined;
      if (p.actor && !actor) return answer(fact, false, 'route-actor-not-available', p.actor);
      if (actor && unitMover(actor.kind) !== p.mover) return answer(fact, false, 'route-actor-mover-mismatch', unitRevision(actor));
      if (p.mover === 'sea') return actor && ports.seaRoute ? ports.seaRoute(p, actor)
        : pending(fact, 'goal-sea-route-port-required', [p, actor && unitRevision(actor)]);
      const a = p.from.landId ?? ports.regionAt(p.from.point, 'land'), b = p.to.landId ?? ports.regionAt(p.to.point, 'land');
      if (!a || !b || a !== b) return answer(fact, false, 'route-land-components-differ', [a, b]);
      const route = ports.landRoute(p.from.point, p.to.point);
      if (route.status !== 'known') return route.status === 'unknown'
        ? pending(fact, route.reasonCode, [p, ports.geometryRevision])
        : answer(fact, false, route.reasonCode, [p, ports.geometryRevision]);
      return answer(fact, true, 'shared-land-route-published', [p, ports.geometryRevision, route.distance, actor?.speed], {
        route: { distance: route.distance, ticks: actor ? actor.speed > 0 ? Math.ceil(route.distance / actor.speed * SIM_TICKS_PER_SECOND) : null : null,
          points: route.points }, availableTick: tick,
      });
    }
    if (p.kind === 'assembly-post') {
      const land = p.at.landId ?? ports.regionAt(p.at.point, 'land');
      if (!land?.startsWith('land:') || ports.regionAt(p.at.point, 'land') !== land)
        return answer(fact, false, 'assembly-post-land-mismatch', [p.at, land]);
      const result = ports.geometry({ key: `assembly-post:${fact.id}`, revision: ports.geometryRevision, initialState: null,
        advance: (state, allowance) => allowance < 1 ? { state, work: 0, done: false }
          : { state, work: 1, done: true, value: isOpenGround(snapshot.map, p.at.point.x, p.at.point.y) } });
      if (result.state !== 'met') return pending(fact, result.reason.code, [p.at, ports.geometryRevision, result.reason.factIds]);
      return answer(fact, result.value, 'native-assembly-post-ground', [p.at, ports.geometryRevision, result.factIds, result.value],
        result.value ? { availableTick: tick } : {});
    }
    if (p.kind === 'camp-cleared') {
      if (!memory.camps.includes(p.campId)) return answer(fact, false, 'camp-identity-unobserved', p.campId);
      const members = goalCampMemberIds(p.campId)!;
      const live = snapshot.units.filter(unit => members.includes(unit.id) && unit.owner === 'neutral' && unit.hp > 0);
      return answer(fact, live.length === 0, live.length ? 'native-camp-present' : 'recorded-camp-members-cleared', live.map(unitRevision),
        { entityIds: live.map(unit => unit.id), ...(live.length ? {} : { availableTick: tick }) });
    }
    if (p.kind === 'garrison-ready') {
      // Physical proximity or a tower is not a formal protection handoff.
      // The outer obligation reader supplies current hold/lease receipts.
      return answer(fact, false, 'formal-garrison-hold-required', fact.id, { entityIds: [] });
    }
    if (p.kind === 'force-at' || p.kind === 'force-available') {
      const refs = p.cohort, requested = new Set(refs?.flatMap(ref => ref.kind === 'existing' ? [ref.entityId] : []) ?? []);
      const eligible = own.filter(unit => !passenger(unit) && unit.kind !== 'worker' && unit.attackDamage > 0 && unitMover(unit.kind) === 'land');
      const units = eligible.filter(unit => (!refs || requested.has(unit.id)) && atRegion(unit, p.at, 'land')
        && (p.kind === 'force-available' || gap(unit, p.at.point) <= ASSEMBLY_RANGE));
      const exact = !refs || refs.every(ref => ref.kind === 'existing' && units.some(unit => unit.id === ref.entityId));
      let quantity: number;
      if (p.metric === 'combat-rating') quantity = units.reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
      else if (p.metric === 'field-strength') quantity = units.reduce((sum, unit) => sum
        + (input.situation.units.find(observed => observed.id === unit.id)?.strength ?? 0), 0);
      else {
        if (!memory.camps.includes(p.campId)) return answer(fact, false, 'camp-identity-unobserved', p.campId);
        const target = resolveGoalCamp(snapshot, p.campId);
        if (target.status !== 'present') return answer(fact, false, 'camp-force-target-not-present', target.status);
        quantity = assessAllocatedForce(owner, units, { metric: 'camp-force', camp: target.exposure.camp }).force;
      }
      return answer(fact, exact && quantity + 1e-9 >= p.minimum && p.byTick >= tick, exact ? 'native-selected-force' : 'selected-cohort-not-at-location',
        [units.map(unitRevision), p.metric === 'camp-force' ? camps.camps.map(camp => camp.camp.creeps.map(unitRevision)) : null,
          input.allowedUnitIds, input.interruptedUnitIds], { quantity, entityIds: units.map(unit => unit.id), availableTick: tick });
    }
    if (p.kind === 'unit-available' || p.kind === 'worker-at') {
      const mover = p.kind === 'unit-available' ? unitMover(p.unitKind) : 'land';
      const units = own.filter(unit => !passenger(unit) && unit.kind === (p.kind === 'worker-at' ? 'worker' : p.unitKind)
        && atRegion(unit, p.at, mover) && (p.kind !== 'worker-at' || !p.worker || p.worker.kind === 'existing' && unit.id === p.worker.entityId));
      return answer(fact, units.length >= p.count && p.byTick >= tick, 'native-callable-region-pool',
        [units.map(unitRevision), input.allowedUnitIds, input.interruptedUnitIds], { quantity: units.length, entityIds: units.map(unit => unit.id), availableTick: tick });
    }
    if (p.kind === 'cargo-aboard') {
      const hull = p.transport.kind === 'existing' ? own.find(unit => p.transport.kind === 'existing' && unit.id === p.transport.entityId && isTransportKind(unit.kind)) : undefined;
      const units = p.units.flatMap(ref => ref.kind === 'existing' ? own.filter(unit => unit.id === ref.entityId && passenger(unit) === hull?.id) : []);
      return answer(fact, !!hull && units.length === p.units.length, 'native-exact-cargo-binding', [hull && unitRevision(hull), units.map(unitRevision)],
        { entityIds: units.map(unit => unit.id), availableTick: tick });
    }
    if (p.kind === 'transport-at') {
      const hull = p.transport.kind === 'existing' ? own.find(unit => p.transport.kind === 'existing' && unit.id === p.transport.entityId && isTransportKind(unit.kind)) : undefined;
      return answer(fact, !!hull && gap(hull, p.at.point) <= p.tolerance && atRegion(hull, p.at, 'sea') && p.byTick >= tick,
        'native-transport-pose', hull && unitRevision(hull), { entityIds: hull ? [hull.id] : [], availableTick: tick });
    }
    if (p.kind === 'transport-in') {
      const hulls = own.filter(unit => isTransportKind(unit.kind) && ports.regionAt(unit, 'sea') === p.seaId
        && (!p.transport || p.transport.kind === 'existing' && unit.id === p.transport.entityId));
      const amounts = hulls.map(hull => Math.max(0, (shipProfile(hull)?.loadCapacity ?? 0) - snapshot.units
        .filter(unit => unit.hp > 0 && passenger(unit) === hull.id).reduce((sum, unit) => sum + bodyMass(unit), 0)));
      const quantity = amounts.reduce((sum, mass) => sum + mass, 0);
      return answer(fact, quantity >= p.capacity && p.byTick >= tick, 'native-free-payload-mass',
        [hulls.map(unitRevision), snapshot.units.filter(passenger).map(unitRevision), amounts],
        { quantity, entityIds: hulls.map(unit => unit.id), availableTick: tick });
    }
    return null;
  }
  function read(fact: GoalFact): GoalFactObservation {
    const p = fact.predicate;
    if (p.kind === 'camp-cleared' || (p.kind === 'force-at' || p.kind === 'force-available') && p.metric === 'camp-force')
      touchCamp(p.campId);
    const request = memory.requests.find(request => request.id === fact.id);
    if (request) touchCache(request, sequence, input.cacheUse?.planIds() ?? []);
    boundGoalWorldFactMemory(memory, sequence);
    if (input.precision !== 'coarse' && fact.predicate.kind === 'route' && fact.predicate.mover === 'land')
      currentFactWork()?.consume(planningFieldKey('land', fact.predicate.to.point));
    const previous = memo.get(fact.id);
    if (previous) return previous;
    const value = readGoalCoarseGeometryFact(fact, context) ?? readGoalEconomicFact(fact, context, ports) ?? measure(fact)
      ?? ports.resolvers?.map(resolve => resolve(fact, context)).find((value): value is GoalFactObservation => !!value)
      ?? pending(fact, 'goal-world-domain-port-required', fact.predicate);
    memo.set(fact.id, value); return value;
  }
  return read;
}
