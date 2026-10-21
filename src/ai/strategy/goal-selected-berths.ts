import { BOARDING_GAP } from '../../shared/naval';
import { distanceToHull, shareShipProfile, shipProfile } from '../../shared/ship-geometry';
import type { Unit } from '../../shared/types';
import { goalValueKey } from './goal-facts';
import type { AllocationReason } from './allocation-types';
import type { GoalBerth, GoalHullCandidate, GoalPublishedValue, GoalTransportFactPorts } from './goal-grounding-ports';
import type { GoalCohortMember, GoalEntityReference, GoalGroundingReader, GoalPlan } from './goal-planner-types';
import type { RegionIndex, Shore } from './regions';
import type { Point, Target } from './types';

type Answer = Extract<GoalPublishedValue<GoalBerth>, { state: 'met' | 'unmet' }>;
export type GoalSelectedBerthMemory = {
  revision: number; nextId: number;
  /** Native hull/terrain inputs are interned once, never embedded in fact IDs. */
  sources: { id: number; value: string }[];
  entries: { id: string; source: number; transport: string; members: string; shore: Shore; answer: Answer; planIds: string[] }[];
};
export type GoalPublishedBerthReader = (ship: Unit, members: readonly GoalCohortMember[], shore: Shore) => Answer | undefined;
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: unknown, b: unknown) => goalValueKey(a) === goalValueKey(b);
const point = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export function chooseGoalCoarseShore(shores: readonly Shore[], near: Point, ship: Unit,
  members: readonly GoalCohortMember[], published?: GoalPublishedBerthReader) {
  for (const shore of [...shores].sort((a, b) => gap(a.ground, near) - gap(b.ground, near)
    || goalValueKey(a).localeCompare(goalValueKey(b)))) {
    const answer = published?.(ship, members, shore);
    if (answer?.state === 'unmet') continue;
    return { shore, berth: answer?.state === 'met' ? answer.value : undefined };
  }
}

/** Only the chosen graph requests a native common berth. Coarse discovery
 * reads these already-published contacts without registering any geometry.
 * A changed water/ground pair re-enters search together: hull positioning,
 * loading force, worker route, safety and later voyage prices all use it. */
export function createGoalSelectedBerths(input: {
  memory: GoalSelectedBerthMemory; geometryRevision: string;
  regions: RegionIndex; units: readonly Unit[];
}) {
  const { memory } = input;
  const source = (ship: Unit) => goalValueKey([input.geometryRevision, ship.kind, ship.radius,
    shipProfile(ship)?.hull, ship.sailing?.heading ?? 0]);
  // The native berth scan depends on passenger shape, not their identity or
  // current HP. Every distinct shape was rechecked before publication. This
  // lets another selected worker reuse the same published physical contact.
  const membersKey = (members: readonly GoalCohortMember[]) => goalValueKey([...new Set(members.map(member =>
    goalValueKey([member.assessment.kind, member.assessment.radius])))].sort());
  const find = (ship: Unit, members: readonly GoalCohortMember[], shore: Shore) => {
    const version = memory.sources.find(entry => entry.value === source(ship));
    return version && memory.entries.find(entry => entry.source === version.id && entry.transport === ship.id
      && entry.members === membersKey(members) && same(entry.shore, shore));
  };
  const published: GoalPublishedBerthReader = (ship, members, shore) => find(ship, members, shore)?.answer;
  const retain = (planIds: readonly string[]) => {
    memory.entries = memory.entries.filter(entry => {
      const ship = input.units.find(unit => unit.id === entry.transport && unit.hp > 0);
      return ship && memory.sources.some(version => version.id === entry.source && version.value === source(ship))
        && entry.planIds.some(id => planIds.includes(id));
    });
    memory.sources = memory.sources.filter(source => memory.entries.some(entry => entry.source === source.id));
  };
  function prepare(plan: GoalPlan, selected: GoalPlan['actions'], ports: GoalTransportFactPorts,
    resolve: NonNullable<GoalGroundingReader['resolveCohort']>): GoalPlan | undefined {
    const pending = new Set<string>(), changes: AllocationReason[] = [];
    for (const node of selected) {
      const action = node.declaration, at = action.executor.parameters.at as Target | undefined;
      if (action.kind !== 'position-transport' || action.precision !== 'coarse' || !at?.seaId) continue;
      const transport = action.executor.parameters.transport as GoalEntityReference;
      if (transport?.kind !== 'existing') continue;
      const ship = input.units.find(unit => unit.id === transport.entityId && unit.hp > 0);
      if (!ship) continue;
      // A pure position request has no passenger berth obligation. Locate the
      // chosen transport which introduced this exact pickup prerequisite.
      const parent = plan.actions.find(candidate => ['transport-force', 'transport-worker'].includes(candidate.declaration.kind)
        && same(candidate.declaration.executor.parameters.transport, transport)
        && point((candidate.declaration.executor.parameters.departure as { water: Point }).water, at.point));
      if (!parent) continue;
      const parameters = parent.declaration.executor.parameters;
      const from = parameters.from as Target, cohort = parameters.cohort as readonly GoalEntityReference[];
      if (!from.landId) continue;
      const members = resolve(cohort);
      if (members.state !== 'met') {
        if (members.state === 'pending') members.requestIds.forEach(id => pending.add(id));
        continue;
      }
      const contact = chooseGoalCoarseShore(input.regions.shoresByLand.get(from.landId)?.get(at.seaId) ?? [],
        from.point, ship, members.candidates, published);
      if (!contact) continue;
      const old = find(ship, members.candidates, contact.shore);
      if (old) { if (!old.planIds.includes(plan.id)) old.planIds.push(plan.id); continue; }
      const profile = shipProfile(ship); if (!profile || !members.candidates.length) continue;
      const hull: GoalHullCandidate = { id: ship.id, reference: transport, seaId: at.seaId, assessment: ship,
        availableTick: plan.observedTick, capacity: profile.loadCapacity, cargoUnitIds: [], preconditions: [], factIds: [ship.id] };
      const first = ports.berth(members.candidates[0]!.assessment, hull, contact.shore);
      let answer: GoalPublishedValue<GoalBerth> = first;
      if (first.state === 'met') {
        const facts = new Set(first.factIds);
        for (const member of members.candidates) {
          const next = ports.berth(member.assessment, hull, { ...contact.shore, ...first.value });
          if (next.state !== 'met') { answer = next; break; }
          next.factIds.forEach(id => facts.add(id));
          if (gap(next.value.water, first.value.water) > ship.radius) {
            answer = { state: 'unmet', reason: { code: 'selected-cohort-has-no-common-berth', factIds: [...facts], values: {} } }; break;
          }
        }
        if (answer.state === 'met') {
          // Nearby independently valid berths do not prove one rendezvous.
          // Recheck every passenger against the one pose being published.
          const dock = { ...ship, ...first.value.water, sailing: { ...ship.sailing!, heading: first.value.heading } };
          shareShipProfile(ship, dock);
          answer = members.candidates.every(member => distanceToHull(dock, first.value.ground) <= member.assessment.radius + BOARDING_GAP)
            ? { state: 'met', value: first.value, factIds: [...facts].sort() }
            : { state: 'unmet', reason: { code: 'selected-cohort-cannot-share-boarding-pose', factIds: [...facts].sort(), values: {} } };
        }
      }
      if (answer.state === 'pending') { answer.requestIds.forEach(id => pending.add(id)); continue; }
      let version = memory.sources.find(entry => entry.value === source(ship));
      if (!version) memory.sources.push(version = { id: memory.nextId++, value: source(ship) });
      const id = `selected-berth:${memory.nextId++}`;
      memory.entries.push({ id, source: version.id, transport: ship.id, members: membersKey(members.candidates),
        shore: contact.shore, answer, planIds: [plan.id] });
      memory.revision++;
      changes.push({ code: answer.state === 'met' ? 'selected-native-berth-reenters-search' : 'selected-native-berth-unavailable',
        factIds: [id], values: { proposedX: at.point.x, proposedY: at.point.y,
          exactX: answer.state === 'met' ? answer.value.water.x : null,
          exactY: answer.state === 'met' ? answer.value.water.y : null } });
    }
    if (!pending.size && !changes.length) return;
    const why = { code: 'selected-native-berths-pending', factIds: [...pending].sort(), values: {} };
    return { ...plan, status: 'waiting-facts', readyActionIds: [], reasons: [...plan.reasons, ...changes, ...(pending.size ? [why] : [])] };
  }
  return { published, prepare, retain };
}
