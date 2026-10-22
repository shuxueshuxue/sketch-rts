import { BOARDING_GAP } from '../../shared/naval';
import { distanceToHull, shareShipProfile, shipProfile } from '../../shared/ship-geometry';
import type { Unit } from '../../shared/types';
import { goalValueKey } from './goal-facts';
import type { AllocationReason } from './allocation-types';
import type { GoalBerth, GoalHullCandidate, GoalPublishedValue, GoalTransportFactPorts } from './goal-grounding-ports';
import type { GoalCohortMember, GoalEntityReference, GoalGroundingReader, GoalPlan } from './goal-planner-types';
import type { RegionIndex, Shore } from './regions';
import type { Point, Target } from './types';
import type { GoalExactPreparation } from './goal-plan-refinement';

type Answer = GoalPublishedValue<GoalBerth>;
export type GoalSelectedBerthMemory = {
  revision: number; nextId: number;
  /** Native hull/terrain inputs are interned once, never embedded in fact IDs. */
  sources: { id: number; value: string }[];
  entries: { id: string; source: number; transport: string; members: string; shore: Shore; answer: Answer; planIds: string[];
    preferredPose?: Point & { heading: number } }[];
};
export type GoalPublishedBerthReader = ((ship: Unit, members: readonly GoalCohortMember[], shore: Shore) => Answer | undefined)
  & { preferred?: (ship: Unit, members: readonly GoalCohortMember[], shores: readonly Shore[]) => Shore | undefined;
    proposal?: (ship: Unit, members: readonly GoalCohortMember[], shore: Shore) => GoalBerth | undefined };
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: unknown, b: unknown) => goalValueKey(a) === goalValueKey(b);
const point = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const sameShore = (a: Shore, b: Shore) => a.landId === b.landId && a.seaId === b.seaId
  && point(a.water, b.water) && point(a.ground, b.ground);
export function chooseGoalCoarseShore(shores: readonly Shore[], near: Point, ship: Unit,
  members: readonly GoalCohortMember[], published?: GoalPublishedBerthReader) {
  const preferred = published?.preferred?.(ship, members, shores);
  for (const shore of [...shores].sort((a, b) => Number(b === preferred) - Number(a === preferred) || gap(a.ground, near) - gap(b.ground, near)
    || goalValueKey(a).localeCompare(goalValueKey(b)))) {
    const answer = published?.(ship, members, shore);
    if (answer?.state === 'unmet') continue;
    return { shore, berth: answer?.state === 'met' ? answer.value : undefined,
      proposal: published?.proposal?.(ship, members, shore) };
  }
}

/** Current hull contact is an alternative proposal, not proof of a dock. The
 * shared preferred-pose port proves it after selection. Include troop walking
 * in the optimistic comparison so a far boat does not attract a whole army
 * across the mainland merely because it would avoid a positioning action. */
export function chooseGoalCoarseDeparture(shores: readonly Shore[], near: Point, destination: Point, ship: Unit,
  members: readonly GoalCohortMember[], published?: GoalPublishedBerthReader) {
  const ordinary = chooseGoalCoarseShore(shores, near, ship, members, published);
  if (published?.preferred?.(ship, members, shores)) return ordinary;
  const heading = ship.sailing?.heading;
  if (!Number.isFinite(heading) || !members.length || !shipProfile(ship)) return ordinary;
  const waiting = members.filter(member => !member.assessment.deck && !member.assessment.cabin);
  const bound = (ground: Point, water: Point) => Math.max(gap(ship, water) / Math.max(1, ship.speed),
    ...waiting.map(member => gap(member.assessment, ground) / Math.max(1, member.assessment.speed)))
    + gap(water, destination) / Math.max(1, ship.speed);
  const contact = shores.filter(shore => published?.(ship, members, shore)?.state !== 'unmet' && members.every(member =>
    distanceToHull(ship, shore.ground) <= member.assessment.radius + BOARDING_GAP))
    .sort((a, b) => bound(a.ground, ship) - bound(b.ground, ship) || goalValueKey(a).localeCompare(goalValueKey(b)))[0];
  if (!contact || ordinary && bound(contact.ground, ship) >= bound(ordinary.berth?.ground ?? ordinary.shore.ground,
    ordinary.berth?.water ?? ordinary.shore.water)) return ordinary;
  return { shore: contact, berth: undefined, proposal: { ground: contact.ground,
    water: { x: ship.x, y: ship.y }, heading: heading! } };
}

/** Only the chosen graph requests a native common berth. Coarse discovery
 * reads these contacts without registering any geometry. A pending choice
 * remains a proposal until native proof publishes; actor motion changes its
 * approach price rather than silently replacing the unfinished target scan.
 * A changed water/ground pair re-enters search together: hull positioning,
 * loading force, worker route, safety and later voyage prices all use it. */
export function createGoalSelectedBerths(input: {
  memory: GoalSelectedBerthMemory; geometryRevision: string;
  regions: RegionIndex; units: readonly Unit[];
  berthOrientation?: 'shore';
  currentPlanIds?: () => readonly string[];
}) {
  const { memory } = input;
  // Snapshot units are immutable within this owner frame. These keys belong
  // to future dock proposals, never a proof about the current boat pose.
  const sourceKeys = new WeakMap<Unit, string>();
  const source = (ship: Unit) => {
    let key = sourceKeys.get(ship);
    if (!key) { key = goalValueKey([input.geometryRevision, ship.kind, ship.radius,
      shipProfile(ship)?.hull, input.berthOrientation === 'shore' ? 'future-shore-heading-v1' : ship.sailing?.heading ?? 0]); sourceKeys.set(ship, key); }
    return key;
  };
  // The native berth scan depends on passenger shape, not their identity or
  // current HP. Every distinct shape was rechecked before publication. This
  // lets another selected worker reuse the same published physical contact.
  const membersKey = (members: readonly GoalCohortMember[]) => goalValueKey([...new Set(members.map(member =>
    goalValueKey([member.assessment.kind, member.assessment.radius])))].sort());
  const find = (ship: Unit, members: readonly GoalCohortMember[], shore: Shore) => {
    const version = memory.sources.find(entry => entry.value === source(ship));
    return version && memory.entries.find(entry => entry.source === version.id && entry.transport === ship.id
      && entry.members === membersKey(members) && (sameShore(entry.shore, shore)
        || !!entry.preferredPose && entry.shore.landId === shore.landId && entry.shore.seaId === shore.seaId
          && point(entry.shore.ground, shore.ground) && point(entry.preferredPose, shore.water)));
  };
  const published: GoalPublishedBerthReader = Object.assign((ship: Unit, members: readonly GoalCohortMember[], shore: Shore) => find(ship, members, shore)?.answer,
    { proposal(ship: Unit, members: readonly GoalCohortMember[], shore: Shore) {
      const entry = find(ship, members, shore);
      return entry?.answer.state === 'met' ? entry.answer.value : entry?.preferredPose ? { ground: entry.shore.ground, water: { x: entry.preferredPose.x, y: entry.preferredPose.y },
        heading: entry.preferredPose.heading } : undefined;
    }, preferred(ship: Unit, members: readonly GoalCohortMember[], shores: readonly Shore[]) {
      const plans = input.currentPlanIds?.();
      const version = memory.sources.find(entry => entry.value === source(ship));
      const chosen = memory.entries.find(entry => entry.source === version?.id && entry.transport === ship.id
        && entry.members === membersKey(members) && entry.answer.state !== 'unmet'
        && (!plans || entry.planIds.some(id => plans.includes(id))) && shores.some(shore => sameShore(shore, entry.shore)))?.shore;
      return chosen && shores.find(shore => sameShore(shore, chosen));
    } });
  const retain = (planIds: readonly string[]) => {
    memory.entries = memory.entries.filter(entry => {
      const ship = input.units.find(unit => unit.id === entry.transport && unit.hp > 0);
      return ship && memory.sources.some(version => version.id === entry.source && version.value === source(ship))
        && entry.planIds.some(id => planIds.includes(id));
    });
    memory.sources = memory.sources.filter(source => memory.entries.some(entry => entry.source === source.id));
  };
  function prepare(plan: GoalPlan, selected: GoalPlan['actions'], ports: GoalTransportFactPorts,
    resolve: NonNullable<GoalGroundingReader['resolveCohort']>): GoalExactPreparation | undefined {
    const pending = new Set<string>(), deferredActions = new Set<string>(), changes: AllocationReason[] = [];
    for (const node of selected) {
      const action = node.declaration;
      if (!['position-transport', 'transport-force', 'transport-worker'].includes(action.kind) || action.precision !== 'coarse') continue;
      const transport = action.executor.parameters.transport as GoalEntityReference;
      if (transport?.kind !== 'existing') continue;
      const ship = input.units.find(unit => unit.id === transport.entityId && unit.hp > 0);
      if (!ship) continue;
      // A pure position request inherits its parent's passenger obligation.
      // A transport already at its proposed dock needs the same proof even
      // though its graph contains no positioning action before pickup.
      const at = action.kind === 'position-transport' ? action.executor.parameters.at as Target : undefined;
      if (action.kind === 'position-transport' && !at?.seaId) continue;
      const parent = action.kind !== 'position-transport' ? node : plan.actions.find(candidate => ['transport-force', 'transport-worker'].includes(candidate.declaration.kind)
        && same(candidate.declaration.executor.parameters.transport, transport)
        && point((candidate.declaration.executor.parameters.departure as { water: Point }).water, at!.point));
      if (!parent) continue;
      const parameters = parent.declaration.executor.parameters;
      const from = parameters.from as Target, to = parameters.at as Target, cohort = parameters.cohort as readonly GoalEntityReference[];
      const basin = parent.declaration.preconditions.find(fact => fact.predicate.kind === 'transport-in')?.predicate;
      const seaId = at?.seaId ?? (basin?.kind === 'transport-in' ? basin.seaId : undefined);
      if (!seaId) continue;
      const members = resolve(cohort);
      if (members.state !== 'met') {
        if (members.state === 'pending') { members.requestIds.forEach(id => pending.add(id)); deferredActions.add(node.id); }
        continue;
      }
      const landing = parameters.landing as { water: Point };
      const contacts = [
        ...(from.landId ? [chooseGoalCoarseDeparture(input.regions.shoresByLand.get(from.landId)?.get(seaId) ?? [],
          from.point, landing.water, ship, members.candidates, published)] : []),
        ...(action.kind !== 'position-transport' && to.landId ? [chooseGoalCoarseShore(
          input.regions.shoresByLand.get(to.landId)?.get(seaId) ?? [], to.point, ship, members.candidates, published)] : []),
      ];
      for (const contact of contacts) {
        if (!contact) continue;
        const old = find(ship, members.candidates, contact.shore);
        if (old) { if (!old.planIds.includes(plan.id)) old.planIds.push(plan.id); if (old.answer.state !== 'pending') continue; }
        const profile = shipProfile(ship); if (!profile || !members.candidates.length) continue;
        const hull: GoalHullCandidate = { id: ship.id, reference: transport, seaId, assessment: ship,
          availableTick: plan.observedTick, capacity: profile.loadCapacity, cargoUnitIds: [], preconditions: [], factIds: [ship.id] };
        const preferredPose = old?.preferredPose ?? (contact.proposal ? { ...contact.proposal.water, heading: contact.proposal.heading } : undefined);
        const first = ports.berth(members.candidates[0]!.assessment, hull, contact.shore, preferredPose);
        let answer: GoalPublishedValue<GoalBerth> = first;
        if (first.state === 'met') {
          const facts = new Set(first.factIds);
          for (const member of members.candidates) {
            const next = ports.berth(member.assessment, hull, { ...contact.shore, ...first.value },
              { ...first.value.water, heading: first.value.heading });
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
        let version = memory.sources.find(entry => entry.value === source(ship));
        if (!version) memory.sources.push(version = { id: memory.nextId++, value: source(ship) });
        const id = old?.id ?? `selected-berth:${memory.nextId++}`;
        if (old) old.answer = answer;
        else memory.entries.push({ id, source: version.id, transport: ship.id, members: membersKey(members.candidates),
          shore: contact.shore, answer, planIds: [plan.id], ...(preferredPose ? { preferredPose } : {}) });
        if (answer.state === 'pending') { answer.requestIds.forEach(id => pending.add(id)); deferredActions.add(node.id); continue; }
        memory.revision++;
        changes.push({ code: answer.state === 'met' ? 'selected-native-berth-reenters-search' : 'selected-native-berth-unavailable',
          factIds: [id], values: { proposedX: contact.shore.water.x, proposedY: contact.shore.water.y,
            exactX: answer.state === 'met' ? answer.value.water.x : null,
            exactY: answer.state === 'met' ? answer.value.water.y : null } });
      }
    }
    if (!pending.size && !changes.length) return;
    const why = { code: 'selected-native-berths-pending', factIds: [...pending].sort(), values: {} };
    return { plan: { ...plan, ...(changes.length ? { status: 'waiting-facts' as const } : {}),
      readyActionIds: changes.length ? [] : plan.readyActionIds.filter(id => !deferredActions.has(id)),
      reasons: [...plan.reasons, ...changes, ...(pending.size ? [why] : [])] },
      deferActionIds: [...deferredActions], changed: changes.length > 0 };
  }
  const requests = (planId: string) => memory.entries.filter(entry => entry.planIds.includes(planId)).flatMap(entry =>
    entry.answer.state === 'pending' ? entry.answer.requestIds : entry.answer.state === 'met' ? entry.answer.factIds : []);
  return { published, prepare, retain, requests };
}
