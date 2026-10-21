import { unitMover, unitRules } from '../../shared/catalog';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { bodyMass } from '../../shared/physical-body';
import { isTransportKind } from '../../shared/transport-role';
import { effectiveCombatRating } from '../policy/v6/strength';
import { forceFor } from '../policy/v7/creep';
import { assessAllocatedForce } from './allocated-force';
import { goalFact, goalValueKey, resolveGoalCamp } from './goal-facts';
import type { GoalActionDeclaration, GoalEntityReference, GoalEstimate, GoalFact,
  GoalFactEffect, GoalParameter, GoalResourceFlow, GoalTransportOption } from './goal-planner-types';
import type { Target } from './types';
import { strategyIsOpponent } from './ownership';
import { withGoalSafetyPreconditionWindows } from './goal-safety-preconditions';

export type GoalNavalEstimates = Readonly<{
  duration: GoalActionDeclaration['duration'];
  cost: GoalActionDeclaration['cost'];
  successProbability: GoalActionDeclaration['successProbability'];
}>;
export type GoalNavalMember = Readonly<{ reference: GoalEntityReference; assessment: Unit }>;
export type GoalNavalCohort = Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; unitIds?: readonly string[];
  /** Evaluation shapes retain their symbolic reference. Their private ID is
   * never emitted as a world identity, effect, resource or execution binding. */
  cohort?: readonly GoalNavalMember[];
  byTick: number; estimates: GoalNavalEstimates;
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}
function identity(kind: GoalActionDeclaration['kind'], parameters: Record<string, GoalParameter>) {
  return `goal-action:${kind}:${JSON.stringify(canonical(parameters))}`;
}
const existing = (entityId: string): GoalEntityReference => ({ kind: 'existing', entityId });
function assessmentId(input: GoalNavalCohort, reference: GoalEntityReference): string {
  if (reference.kind === 'existing') return reference.entityId;
  let id = `assessment:${goalValueKey(reference)}`;
  while (input.snapshot.units.some(unit => unit.id === id)) id += ':';
  return id;
}
function reference(input: GoalNavalCohort, unit: Unit): GoalEntityReference {
  return input.cohort?.find(member => assessmentId(input, member.reference) === unit.id)?.reference ?? existing(unit.id);
}
const establish = (fact: GoalFact): GoalFactEffect => ({ fact, operation: 'establish', at: 'finish' });
const facts = (items: readonly GoalFact[]) => [...new Map(items.map(fact => [fact.id, fact])).values()]
  .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Grounding identities are checked against the current world. A missing or
 * foreign identity is invalid, not a pending route, and never becomes a lease. */
function crew(input: GoalNavalCohort, workers: boolean | 'cargo'): readonly Unit[] | null {
  const byId = new Map(input.snapshot.units.map(unit => [unit.id, unit]));
  const selected = input.cohort ?? [...new Set(input.unitIds ?? [])].sort().flatMap(id => {
    const unit = byId.get(id); return unit ? [{ reference: existing(id), assessment: unit }] : [];
  });
  if (!input.cohort && selected.length !== new Set(input.unitIds ?? []).size) return null;
  const unique = [...new Map(selected.map(member => [goalValueKey(member.reference), member])).entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, member]) => member);
  if (unique.some(member => member.reference.kind === 'existing'
    && (!byId.get(member.reference.entityId) || byId.get(member.reference.entityId)!.owner !== input.owner
      || byId.get(member.reference.entityId)!.hp <= 0 || byId.get(member.reference.entityId)!.kind !== member.assessment.kind))) return null;
  if (unique.some(member => member.reference.kind !== 'existing' && (member.assessment.deck || member.assessment.cabin))) return null;
  const units = unique.map(member => ({ ...member.assessment, id: assessmentId(input, member.reference) }));
  if (!units.length || units.some(unit => unit.owner !== input.owner || unit.hp <= 0
    || unit.expiresTick !== undefined || unitMover(unit.kind) !== 'land'
    || (workers === 'cargo' ? false : workers ? unit.kind !== 'worker' : unit.kind === 'worker' || unit.attackDamage <= 0))) return null;
  return units;
}
function demands(input: GoalNavalCohort, units: readonly Unit[]): GoalActionDeclaration['demands'] {
  return units.map(unit => ({ resource: { kind: 'entity-control', entity: reference(input, unit) }, quantity: 1, from: 'start', until: 'finish' }));
}
function poolFacts(units: readonly Unit[], at: Target, byTick: number): GoalFact[] {
  return [...new Set(units.map(unit => unit.kind))].sort().map(unitKind => goalFact({
    kind: 'unit-available', unitKind, count: units.filter(unit => unit.kind === unitKind).length, at, byTick,
  }));
}
function rating(snapshot: GameSnapshot, units: readonly Unit[]) {
  return units.reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
}
/** A post inventory is conditional on this exact group's combat-rating at
 * this exact post. A same-land pool, another metric or a subset is not proof. */
export function goalAssemblyPostSource(preconditions: readonly GoalFact[], from: Target,
  cohort: readonly GoalEntityReference[], force: number): GoalFact | undefined {
  const refsKey = goalValueKey([...new Set(cohort.map(goalValueKey))].sort());
  return preconditions.find(fact => {
    const p = fact.predicate;
    return p.kind === 'force-at' && p.metric === 'combat-rating' && p.cohort
      && goalValueKey(p.at) === goalValueKey(from)
      && goalValueKey([...new Set(p.cohort.map(goalValueKey))].sort()) === refsKey
      && Number.isFinite(p.minimum) && p.minimum + 1e-9 * Math.max(1, force) >= force;
  });
}
function movementFlows(units: readonly Unit[], from: Target, to: Target, force: number,
  factIds: readonly string[], fromScope: 'pool' | 'post' = 'post', toScope: 'pool' | 'post' = 'post'): GoalResourceFlow[] {
  if (JSON.stringify(canonical(from)) === JSON.stringify(canonical(to)) && fromScope === toScope) return [];
  const flows: GoalResourceFlow[] = [];
  // Callable unit pools are region inventories, not copies at each point.
  const sameRegion = from.landId !== undefined && from.landId === to.landId
    || from.seaId !== undefined && from.seaId === to.seaId;
  for (const unitKind of sameRegion ? [] : [...new Set(units.map(unit => unit.kind))].sort()) {
    const count = units.filter(unit => unit.kind === unitKind).length;
    flows.push({ resource: { kind: 'unit-pool', unitKind, at: from }, delta: -count, at: 'start', factIds },
      { resource: { kind: 'unit-pool', unitKind, at: to }, delta: count, at: 'finish', factIds });
  }
  if (force > 0) flows.push({ resource: { kind: 'force', at: from, scope: fromScope, metric: 'combat-rating' }, delta: -force, at: 'start', factIds },
    { resource: { kind: 'force', at: to, scope: toScope, metric: 'combat-rating' }, delta: force, at: 'finish', factIds });
  return flows;
}
function declaration(kind: GoalActionDeclaration['kind'], executor: string, parameters: Record<string, GoalParameter>,
  input: GoalNavalCohort, preconditions: readonly GoalFact[], effects: readonly GoalFactEffect[],
  resources: GoalActionDeclaration['demands'], flows: readonly GoalResourceFlow[]): GoalActionDeclaration {
  return withGoalSafetyPreconditionWindows({ id: identity(kind, parameters), kind, preconditions: facts(preconditions), effects, demands: resources, flows,
    ...input.estimates, executor: { executor, parameters }, outputs: [], reasons: [] }, input.snapshot.tick);
}
function bounties(snapshot: GameSnapshot, unitIds: readonly string[], factIds: readonly string[]): GoalResourceFlow[] {
  const ids = new Set(unitIds);
  return snapshot.units.filter(unit => ids.has(unit.id) && unit.owner === 'neutral' && unit.hp > 0)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(unit => ({
      resource: { kind: 'gold' as const }, delta: unitRules(snapshot, unit).goldBounty ?? 0,
      at: 'finish' as const, factIds: [...factIds, unit.id], source: { kind: 'event' as const, id: `neutral-kill-bounty:${unit.id}` },
    })).filter(flow => flow.delta > 0);
}

/** One local move contributes its actual combat-rating, even when it cannot
 * fill the requested deficit alone. Camp force is re-evaluated as a whole group
 * and is never credited as a numeric, additive resource. */
export function declareGoalAssembly(input: GoalNavalCohort & Readonly<{
  from: Target; at: Target; routes: readonly GoalFact[]; safePost: GoalFact; campId?: string;
}>): GoalActionDeclaration | null {
  const units = crew(input, false);
  if (!units || input.from.landId && input.at.landId && input.from.landId !== input.at.landId
    || units.some(unit => unit.deck || unit.cabin)) return null;
  const cohort = units.map(unit => reference(input, unit)), force = rating(input.snapshot, units);
  const postSource = goalAssemblyPostSource(input.routes, input.from, cohort, force);
  const forceAvailable = goalFact({ kind: 'force-available', at: input.from, minimum: force,
    metric: 'combat-rating', cohort, byTick: input.byTick });
  const effects = [establish(goalFact({ kind: 'force-at', at: input.at, minimum: force,
    metric: 'combat-rating', cohort, byTick: input.byTick })),
  establish(goalFact({ kind: 'force-at', at: input.at,
    minimum: assessAllocatedForce(input.owner, units, { metric: 'field-strength', requiredForce: 0 }).force,
    metric: 'field-strength', cohort, byTick: input.byTick }))];
  if (input.campId) {
    const camp = resolveGoalCamp(input.snapshot, input.campId);
    if (camp.status !== 'present') return null;
    const measured = assessAllocatedForce(input.owner, units, { metric: 'camp-force', camp: camp.exposure.camp });
    effects.push(establish(goalFact({ kind: 'force-at', at: input.at, minimum: measured.force,
      metric: 'camp-force', campId: input.campId, cohort, byTick: input.byTick })));
  }
  const post = input.campId ? goalFact({ kind: 'camp-staging', campId: input.campId, at: input.at, cohort }) : input.safePost;
  const preconditions = [...poolFacts(units, input.from, input.byTick), postSource ?? forceAvailable, post, ...input.routes];
  return declaration('assemble', 'strategy.assemble', { cohort, from: input.from,
    at: input.at, byTick: input.byTick, fromScope: postSource ? 'post' : 'pool',
    ...(input.campId ? { campId: input.campId } : {}) }, input, preconditions, effects,
  demands(input, units), movementFlows(units, input.from, input.at, force, preconditions.map(fact => fact.id), postSource ? 'post' : 'pool'));
}

/** Clearing earns only the remaining guards' native bounties. Each guard is
 * one event source, so a second threshold/goal cannot spend the bounty twice. */
export function declareGoalCampClearing(input: GoalNavalCohort & Readonly<{
  campId: string; at: Target; routes: readonly GoalFact[];
}>): GoalActionDeclaration | null {
  const units = crew(input, false), camp = resolveGoalCamp(input.snapshot, input.campId);
  if (!units || camp.status !== 'present' || units.some(unit => unit.deck || unit.cabin)) return null;
  const clearingForce = goalFact({ kind: 'force-at', at: input.at, minimum: forceFor(camp.exposure.camp),
    metric: 'camp-force', campId: input.campId, cohort: units.map(unit => reference(input, unit)), byTick: input.byTick });
  const cleared = goalFact({ kind: 'camp-cleared', campId: input.campId });
  const flows = bounties(input.snapshot, camp.originalMemberIds, [cleared.id]);
  return declaration('clear-camp', 'strategy.clear-camp', { campId: input.campId,
    memberIds: [...camp.originalMemberIds], cohort: units.map(unit => reference(input, unit)), at: input.at, byTick: input.byTick },
  input, [clearingForce, goalFact({ kind: 'camp-staging', campId: input.campId, at: input.at,
    cohort: units.map(unit => reference(input, unit)) }), ...input.routes], [establish(cleared)], demands(input, units), flows);
}

/** A shore choice is a binding on a transport alternative. Only actually
 * removing opposition establishes shore-safe at that particular landing. */
export function declareGoalShoreClearing(input: GoalNavalCohort & Readonly<{
  landing: Target; threatIds: readonly string[]; requiredForce: number; throughTick: number; routes: readonly GoalFact[];
}>): GoalActionDeclaration | null {
  const units = crew(input, false), ids = [...new Set(input.threatIds)].sort();
  if (!units || !input.landing.landId || !ids.length || !Number.isFinite(input.requiredForce) || input.requiredForce < 0
    || ids.some(id => !input.snapshot.units.some(unit => unit.id === id && unit.hp > 0
      && (unit.owner === 'neutral' || strategyIsOpponent(input.snapshot, input.owner, unit.owner))))) return null;
  const force = goalFact({ kind: 'force-at', at: input.landing, minimum: input.requiredForce, metric: 'combat-rating',
    cohort: units.map(unit => reference(input, unit)), byTick: input.byTick });
  const safe = goalFact({ kind: 'shore-safe', landId: input.landing.landId, landing: input.landing, throughTick: input.throughTick });
  return declaration('clear-shore', 'strategy.clear-camp', { cohort: units.map(unit => reference(input, unit)),
    memberIds: ids.filter(id => input.snapshot.units.find(unit => unit.id === id)!.owner === 'neutral'),
    threatIds: ids, at: input.landing, throughTick: input.throughTick }, input,
  [force, ...input.routes], [establish(safe)], demands(input, units), bounties(input.snapshot, ids, [safe.id]));
}

export function declareGoalDefense(input: GoalNavalCohort & Readonly<{
  site: Target; requiredForce: number; throughTick: number; routes: readonly GoalFact[];
  /** Movement and command post; site remains the protected logical asset. */
  post?: Target;
  effectDelayTicks?: GoalNavalEstimates['duration'];
}>): GoalActionDeclaration | null {
  const units = crew(input, false);
  const post = input.post ?? input.site;
  if (!units || post.landId !== input.site.landId || !Number.isFinite(input.requiredForce) || input.requiredForce < 0
    || !Number.isFinite(input.throughTick) || input.throughTick < input.snapshot.tick
    || input.estimates.duration.state === 'met' && input.estimates.duration.value < input.throughTick - input.snapshot.tick) return null;
  const delay = input.effectDelayTicks ?? { state: 'pending' as const, requestIds: [goalFact({ kind: 'site-safe',
    site: input.site, throughTick: input.throughTick }).id],
  reason: { code: 'defense-arrival-time-unquoted', factIds: input.routes.map(fact => fact.id), values: {} } };
  if (delay.state === 'met' && (!Number.isFinite(delay.value) || delay.value < 0
    || delay.value > input.throughTick - input.snapshot.tick
    || input.estimates.duration.state === 'met' && delay.value > input.estimates.duration.value)) return null;
  const force = goalFact({ kind: 'force-available', at: input.site, minimum: input.requiredForce, metric: 'combat-rating',
    cohort: units.map(unit => reference(input, unit)), byTick: input.byTick });
  const safe = goalFact({ kind: 'site-safe', site: input.site, throughTick: input.throughTick });
  return declaration('defend', 'strategy.defend-site', { cohort: units.map(unit => reference(input, unit)), at: post,
    ...(input.post ? { protectedSite: input.site } : {}),
    throughTick: input.throughTick }, { ...input, estimates: { ...input.estimates,
    duration: delay.state === 'met' ? input.estimates.duration : delay } }, [force, ...input.routes],
  [{ fact: safe, operation: 'establish', at: delay.state === 'met'
    ? delay.value === 0 ? 'start' : { offsetTicks: delay.value } : 'finish' }], demands(input, units), []);
}

export function declareGoalEvacuation(input: GoalNavalCohort & Readonly<{
  from: Target; shelter: Target; throughTick: number; routes: readonly GoalFact[];
}>): GoalActionDeclaration | null {
  const units = crew(input, true);
  if (!units) return null;
  // assets-safe names observed entities. A future worker first regresses to a
  // concrete availability fact; do not emit an invented rescue identity.
  if (units.some(unit => reference(input, unit).kind !== 'existing')) return null;
  const safe = goalFact({ kind: 'site-safe', site: input.shelter, throughTick: input.throughTick });
  const preconditions = [...poolFacts(units, input.from, input.byTick), safe, ...input.routes];
  return declaration('evacuate', 'strategy.evacuate', { unitIds: units.map(unit => unit.id), from: input.from,
    at: input.shelter, throughTick: input.throughTick }, input, preconditions,
  [establish(goalFact({ kind: 'assets-safe', unitIds: units.map(unit => unit.id), at: input.shelter,
    throughTick: input.throughTick })), establish(goalFact({ kind: 'worker-at', at: input.shelter,
    count: units.length, byTick: input.byTick }))], demands(input, units), movementFlows(units, input.from, input.shelter, 0,
    preconditions.map(fact => fact.id)));
}

export function declareGoalTransportPosition(input: Readonly<{
  option: GoalTransportOption; tolerance: number; tick: number; byTick: number; estimates: GoalNavalEstimates;
}>): GoalActionDeclaration | null {
  const option = input.option;
  return declareGoalTransportReposition({ transport: option.transport,
    at: { seaId: option.seaId, point: option.departure.water }, dependentUnitIds: option.loadedUnitIds,
    tolerance: input.tolerance, tick: input.tick, byTick: input.byTick, estimates: input.estimates,
    preconditions: [...(option.preconditions ?? []), ...(option.approach ? [option.approach] : [])] });
}

/** Repositioning a hull is a sea move, including when no passengers or land
 * destination exist. It needs no invented boarding shore or landing pair. */
export function declareGoalTransportReposition(input: Readonly<{
  transport: GoalEntityReference; at: Target; dependentUnitIds: readonly string[];
  tolerance: number; tick: number; byTick: number; estimates: GoalNavalEstimates; preconditions: readonly GoalFact[];
}>): GoalActionDeclaration | null {
  if (!Number.isFinite(input.tolerance) || input.tolerance < 0) return null;
  const { transport, at } = input;
  if (!at.seaId) return null;
  const preconditions = [goalFact({ kind: 'transport-in', seaId: at.seaId, capacity: 0,
    transport, byTick: input.byTick }), ...input.preconditions];
  const parameters = { transport, at, tolerance: input.tolerance, byTick: input.byTick,
    dependentUnitIds: [...new Set(input.dependentUnitIds)].sort() };
  return withGoalSafetyPreconditionWindows({ id: identity('position-transport', parameters), kind: 'position-transport', preconditions: facts(preconditions),
    effects: [establish(goalFact({ kind: 'transport-at', transport, at,
      tolerance: input.tolerance, byTick: input.byTick }))],
    demands: [{ resource: { kind: 'entity-control', entity: transport }, quantity: 1,
      from: 'start', until: 'finish' }, ...[...new Set(input.dependentUnitIds)].sort().map(id => ({
        resource: { kind: 'entity-control' as const, entity: existing(id) }, quantity: 1,
        from: 'start' as const, until: 'finish' as const,
      }))], flows: [], ...input.estimates,
    executor: { executor: 'strategy.transport', parameters }, outputs: [], reasons: [] }, input.tick);
}

type GoalTransportInput = GoalNavalCohort & Readonly<{
  option: GoalTransportOption; berthTolerance: number; pickupRoutes: readonly GoalFact[];
}>;
function transport(input: GoalTransportInput, workers: boolean): GoalActionDeclaration | null {
  const units = crew(input, 'cargo'), option = input.option;
  if (!units || !Number.isFinite(input.berthTolerance) || input.berthTolerance < 0) return null;
  const engineers = units.filter(unit => unit.kind === 'worker'), fighters = units.filter(unit => unit.kind !== 'worker');
  if (workers ? !engineers.length : !fighters.length) return null;
  const hull = option.transport.kind === 'existing'
    ? input.snapshot.units.find(unit => option.transport.kind === 'existing' && unit.id === option.transport.entityId) : undefined;
  if (option.transport.kind === 'existing' && (!hull || hull.hp <= 0 || hull.owner !== input.owner || !isTransportKind(hull.kind))) return null;
  const dependents = hull ? input.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === hull.id) : [];
  if (dependents.some(unit => unit.owner !== input.owner || !option.loadedUnitIds.includes(unit.id))) return null;
  const loaded = units.filter(unit => unit.deck || unit.cabin), waiting = units.filter(unit => !unit.deck && !unit.cabin);
  if (loaded.some(unit => option.transport.kind !== 'existing'
    || (unit.deck?.shipId ?? unit.cabin?.shipId) !== option.transport.entityId
    || !option.loadedUnitIds.includes(unit.id)) || option.origin === 'aboard' && waiting.length) return null;
  const cohort = units.map(unit => reference(input, unit));
  const loadedRefs = loaded.map(unit => reference(input, unit));
  if (option.origin === 'land' && !option.from.landId) return null;
  const loadingPost: Target | null = option.origin === 'land'
    ? { landId: option.from.landId!, point: option.departure.ground } : null;
  const waitingMass = waiting.reduce((sum, unit) => sum + bodyMass(unit), 0);
  const loadedMass = dependents.reduce((sum, unit) => sum + bodyMass(unit), 0);
  const shorePredicate = option.shoreSafe.predicate;
  if (shorePredicate.kind !== 'shore-safe') return null;
  // This is a prototype at the observation epoch. The scheduler binds the
  // marked windows to the real start + duration before allowing execution.
  // An unquoted duration remains unquoted; current safety is not a forecast.
  const throughTick = input.snapshot.tick + (option.duration.state === 'met' ? option.duration.value : 0);
  const shoreSafe = goalFact({ ...shorePredicate, throughTick });
  const handoffSafe = engineers.length ? goalFact({ kind: 'site-safe', site: option.to, throughTick }) : undefined;
  const oldHandoff = handoffSafe ? goalFact({ kind: 'site-safe', site: option.to, throughTick: input.byTick }) : undefined;
  const replacements = new Map([[option.shoreSafe.id, shoreSafe], ...(oldHandoff && handoffSafe ? [[oldHandoff.id, handoffSafe] as const] : [])]);
  const factIds = (ids: readonly string[]) => [...new Set(ids.map(id => replacements.get(id)?.id ?? id))].sort();
  const factReferences = <T>(estimate: GoalEstimate<T>): GoalEstimate<T> => estimate.state === 'met'
    ? { ...estimate, factIds: factIds(estimate.factIds) }
    : { ...estimate, reason: { ...estimate.reason, factIds: factIds(estimate.reason.factIds) },
      ...(estimate.state === 'pending' ? { requestIds: factIds(estimate.requestIds) } : {}) };
  const optionFactIds = factIds(option.factIds);
  const estimates: GoalNavalEstimates = { duration: factReferences(option.duration),
    cost: factReferences(input.estimates.cost.state === 'met' ? { ...input.estimates.cost,
      value: input.estimates.cost.value.map(term => ({ ...term, factIds: factIds(term.factIds) })) } : input.estimates.cost),
    successProbability: factReferences(input.estimates.successProbability) };
  // Training contributes to the regional capacity pool. A symbolic future
  // hull cannot demand a named world ship's inventory before it exists.
  // Exact refinement/allocation must subsequently bind the actual hull.
  const capacityIdentity = option.transport.kind === 'existing' ? { transport: option.transport } : {};
  const preconditions: GoalFact[] = [goalFact({ kind: 'transport-in', seaId: option.seaId,
    capacity: waitingMass, ...capacityIdentity, byTick: input.byTick }),
    ...(option.preconditions ?? []).map(fact => replacements.get(fact.id) ?? fact), option.crossing, shoreSafe];
  if (loaded.length) preconditions.push(goalFact({ kind: 'cargo-aboard', transport: option.transport, units: loadedRefs }));
  // An unprotected delivery must be safe at its actual shore and at the
  // requested handoff. A remote safe beach does not make a guarded mine safe.
  if (handoffSafe) preconditions.push(handoffSafe);
  if (waiting.length) {
    preconditions.push(...poolFacts(waiting, option.from, input.byTick), ...input.pickupRoutes,
      goalFact({ kind: 'transport-at', transport: option.transport,
        at: { seaId: option.seaId, point: option.departure.water }, tolerance: input.berthTolerance, byTick: input.byTick }));
    const waitingWorkers = waiting.filter(unit => unit.kind === 'worker'), waitingFighters = waiting.filter(unit => unit.kind !== 'worker');
    preconditions.push(...waitingWorkers.map(unit => goalFact({ kind: 'worker-at', at: option.from,
      count: 1, worker: reference(input, unit), byTick: input.byTick })));
    if (waitingFighters.length && loadingPost) preconditions.push(goalFact({ kind: 'force-at', at: loadingPost,
      minimum: rating(input.snapshot, waitingFighters), metric: 'combat-rating',
      cohort: waitingFighters.map(unit => reference(input, unit)), byTick: input.byTick }));
  }
  const effects: GoalFactEffect[] = [
    { fact: goalFact({ kind: 'cargo-aboard', transport: option.transport,
      units: [...cohort, ...dependents.map(unit => existing(unit.id))] }), operation: 'invalidate', at: 'finish' },
  ];
  effects.push(...engineers.map(unit => establish(goalFact({ kind: 'worker-at', at: option.to, count: 1,
    worker: reference(input, unit), byTick: input.byTick }))));
  if (fighters.length) effects.push(establish(goalFact({ kind: 'force-available', at: option.to, minimum: rating(input.snapshot, fighters),
    metric: 'combat-rating', cohort: fighters.map(unit => reference(input, unit)), byTick: input.byTick })),
  establish(goalFact({ kind: 'force-available', at: option.to,
    minimum: assessAllocatedForce(input.owner, fighters, { metric: 'field-strength', requiredForce: 0 }).force,
    metric: 'field-strength', cohort: fighters.map(unit => reference(input, unit)), byTick: input.byTick })));
  const resources: GoalActionDeclaration['demands'] = [...demands(input, [...new Map([...units, ...dependents].map(unit => [unit.id, unit])).values()]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    { resource: { kind: 'entity-control', entity: option.transport }, quantity: 1, from: 'start', until: 'finish' },
    ...(waitingMass > 0 ? [{ resource: { kind: 'transport-capacity' as const, ...capacityIdentity, seaId: option.seaId },
      quantity: waitingMass, from: 'start' as const, until: 'finish' as const }] : [])];
  const declaredPreconditions = preconditions.map(fact => replacements.get(fact.id) ?? fact);
  const sourceFacts = factIds([...optionFactIds, ...declaredPreconditions.map(fact => fact.id)]);
  const flows = movementFlows(waiting, loadingPost ?? option.from, option.to, rating(input.snapshot, waiting), sourceFacts, 'post', 'pool');
  // Already loaded soldiers have no invented original land pool. Their actual
  // unload is a destination contribution, and frees their occupied payload.
  for (const unitKind of [...new Set(loaded.map(unit => unit.kind))].sort()) flows.push({
    resource: { kind: 'unit-pool', unitKind, at: option.to }, delta: loaded.filter(unit => unit.kind === unitKind).length,
    at: 'finish', factIds: optionFactIds,
  });
  if (loaded.some(unit => unit.kind !== 'worker')) flows.push({ resource: { kind: 'force', at: option.to,
    metric: 'combat-rating', scope: 'pool' }, delta: rating(input.snapshot, loaded), at: 'finish', factIds: optionFactIds });
  if (loadedMass > 0) flows.push({ resource: { kind: 'transport-capacity', transport: option.transport, seaId: option.seaId },
    delta: loadedMass, at: 'finish', factIds: optionFactIds });
  const action = declaration(workers ? 'transport-worker' : 'transport-force', 'strategy.transport', {
    optionId: option.id, transport: option.transport, cohort, origin: option.origin,
    ...(loadingPost && waiting.some(unit => unit.kind !== 'worker') ? { loadingPost } : {}),
    from: option.from, at: option.to, departure: { water: option.departure.water, heading: option.departure.heading,
      ...(option.origin === 'land' ? { ground: option.departure.ground } : {}) }, landing: option.landing,
    loadedUnitIds: loaded.map(unit => unit.id), payloadMass: waitingMass + loadedMass,
    dependentUnitIds: dependents.map(unit => unit.id).sort(),
    byTick: input.byTick, berthTolerance: input.berthTolerance,
  }, { ...input, estimates }, declaredPreconditions, effects, resources, flows);
  return action;
}

export function declareGoalForceTransport(input: GoalTransportInput): GoalActionDeclaration | null {
  return transport(input, false);
}
export function declareGoalWorkerTransport(input: GoalTransportInput): GoalActionDeclaration | null {
  return transport(input, true);
}
