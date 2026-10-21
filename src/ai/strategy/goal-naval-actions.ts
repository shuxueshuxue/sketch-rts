import { unitMover, unitRules } from '../../shared/catalog';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { bodyMass } from '../../shared/physical-body';
import { isTransportKind } from '../../shared/transport-role';
import { effectiveCombatRating } from '../policy/v6/strength';
import { forceFor } from '../policy/v7/creep';
import { assessAllocatedForce } from './allocated-force';
import { goalFact, resolveGoalCamp } from './goal-facts';
import type { GoalActionDeclaration, GoalEntityReference, GoalFact,
  GoalFactEffect, GoalParameter, GoalResourceFlow, GoalTransportOption } from './goal-planner-types';
import type { Target } from './types';
import { strategyIsOpponent } from './ownership';

export type GoalNavalEstimates = Readonly<{
  duration: GoalActionDeclaration['duration'];
  cost: GoalActionDeclaration['cost'];
  successProbability: GoalActionDeclaration['successProbability'];
}>;
export type GoalNavalCohort = Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; unitIds: readonly string[];
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
const establish = (fact: GoalFact): GoalFactEffect => ({ fact, operation: 'establish', at: 'finish' });
const facts = (items: readonly GoalFact[]) => [...new Map(items.map(fact => [fact.id, fact])).values()]
  .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Grounding identities are checked against the current world. A missing or
 * foreign identity is invalid, not a pending route, and never becomes a lease. */
function crew(input: GoalNavalCohort, workers: boolean): readonly Unit[] | null {
  const ids = [...new Set(input.unitIds)].sort(), byId = new Map(input.snapshot.units.map(unit => [unit.id, unit]));
  const units = ids.map(id => byId.get(id));
  if (!ids.length || units.some(unit => !unit || unit.owner !== input.owner || unit.hp <= 0
    || unit.expiresTick !== undefined || unitMover(unit.kind) !== 'land'
    || (workers ? unit.kind !== 'worker' : unit.kind === 'worker' || unit.attackDamage <= 0))) return null;
  return units as Unit[];
}
function demands(units: readonly Unit[]): GoalActionDeclaration['demands'] {
  return units.map(unit => ({ resource: { kind: 'entity-control', entity: existing(unit.id) }, quantity: 1, from: 'start', until: 'finish' }));
}
function poolFacts(units: readonly Unit[], at: Target, byTick: number): GoalFact[] {
  return [...new Set(units.map(unit => unit.kind))].sort().map(unitKind => goalFact({
    kind: 'unit-available', unitKind, count: units.filter(unit => unit.kind === unitKind).length, at, byTick,
  }));
}
function rating(snapshot: GameSnapshot, units: readonly Unit[]) {
  return units.reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
}
function movementFlows(units: readonly Unit[], from: Target, to: Target, force: number,
  factIds: readonly string[], fromScope: 'pool' | 'post' = 'post'): GoalResourceFlow[] {
  if (JSON.stringify(canonical(from)) === JSON.stringify(canonical(to)) && fromScope === 'post') return [];
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
    { resource: { kind: 'force', at: to, scope: 'post', metric: 'combat-rating' }, delta: force, at: 'finish', factIds });
  return flows;
}
function declaration(kind: GoalActionDeclaration['kind'], executor: string, parameters: Record<string, GoalParameter>,
  input: GoalNavalCohort, preconditions: readonly GoalFact[], effects: readonly GoalFactEffect[],
  resources: GoalActionDeclaration['demands'], flows: readonly GoalResourceFlow[]): GoalActionDeclaration {
  return { id: identity(kind, parameters), kind, preconditions: facts(preconditions), effects, demands: resources, flows,
    ...input.estimates, executor: { executor, parameters }, outputs: [], reasons: [] };
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
  const cohort = units.map(unit => existing(unit.id)), force = rating(input.snapshot, units);
  const forceAvailable = goalFact({ kind: 'force-available', at: input.from, minimum: force,
    metric: 'combat-rating', cohort, byTick: input.byTick });
  const effects = [establish(goalFact({ kind: 'force-at', at: input.at, minimum: force,
    metric: 'combat-rating', cohort, byTick: input.byTick }))];
  if (input.campId) {
    const camp = resolveGoalCamp(input.snapshot, input.campId);
    if (camp.status !== 'present') return null;
    const measured = assessAllocatedForce(input.owner, units, { metric: 'camp-force', camp: camp.exposure.camp });
    effects.push(establish(goalFact({ kind: 'force-at', at: input.at, minimum: measured.force,
      metric: 'camp-force', campId: input.campId, cohort, byTick: input.byTick })));
  }
  const preconditions = [...poolFacts(units, input.from, input.byTick), forceAvailable, input.safePost, ...input.routes];
  return declaration('assemble', 'strategy.assemble', { unitIds: units.map(unit => unit.id), from: input.from,
    at: input.at, byTick: input.byTick, ...(input.campId ? { campId: input.campId } : {}) }, input, preconditions, effects,
  demands(units), movementFlows(units, input.from, input.at, force, preconditions.map(fact => fact.id), 'pool'));
}

/** Clearing earns only the remaining guards' native bounties. Each guard is
 * one event source, so a second threshold/goal cannot spend the bounty twice. */
export function declareGoalCampClearing(input: GoalNavalCohort & Readonly<{
  campId: string; at: Target; routes: readonly GoalFact[];
}>): GoalActionDeclaration | null {
  const units = crew(input, false), camp = resolveGoalCamp(input.snapshot, input.campId);
  if (!units || camp.status !== 'present' || units.some(unit => unit.deck || unit.cabin)) return null;
  const clearingForce = goalFact({ kind: 'force-at', at: input.at, minimum: forceFor(camp.exposure.camp),
    metric: 'camp-force', campId: input.campId, cohort: units.map(unit => existing(unit.id)), byTick: input.byTick });
  const cleared = goalFact({ kind: 'camp-cleared', campId: input.campId });
  const flows = bounties(input.snapshot, camp.originalMemberIds, [cleared.id]);
  return declaration('clear-camp', 'strategy.clear-camp', { campId: input.campId,
    memberIds: [...camp.originalMemberIds], unitIds: units.map(unit => unit.id), at: input.at, byTick: input.byTick },
  input, [clearingForce, ...input.routes], [establish(cleared)], demands(units), flows);
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
    cohort: units.map(unit => existing(unit.id)), byTick: input.byTick });
  const safe = goalFact({ kind: 'shore-safe', landId: input.landing.landId, landing: input.landing, throughTick: input.throughTick });
  return declaration('clear-shore', 'strategy.clear-camp', { unitIds: units.map(unit => unit.id),
    memberIds: ids.filter(id => input.snapshot.units.find(unit => unit.id === id)!.owner === 'neutral'),
    threatIds: ids, at: input.landing, throughTick: input.throughTick }, input,
  [force, ...input.routes], [establish(safe)], demands(units), bounties(input.snapshot, ids, [safe.id]));
}

export function declareGoalDefense(input: GoalNavalCohort & Readonly<{
  site: Target; requiredForce: number; throughTick: number; routes: readonly GoalFact[];
}>): GoalActionDeclaration | null {
  const units = crew(input, false);
  if (!units || !Number.isFinite(input.requiredForce) || input.requiredForce < 0) return null;
  const force = goalFact({ kind: 'force-available', at: input.site, minimum: input.requiredForce, metric: 'combat-rating',
    cohort: units.map(unit => existing(unit.id)), byTick: input.byTick });
  return declaration('defend', 'strategy.defend-site', { unitIds: units.map(unit => unit.id), at: input.site,
    throughTick: input.throughTick }, input, [force, ...input.routes],
  [establish(goalFact({ kind: 'site-safe', site: input.site, throughTick: input.throughTick }))], demands(units), []);
}

export function declareGoalEvacuation(input: GoalNavalCohort & Readonly<{
  from: Target; shelter: Target; throughTick: number; routes: readonly GoalFact[];
}>): GoalActionDeclaration | null {
  const units = crew(input, true);
  if (!units) return null;
  const safe = goalFact({ kind: 'site-safe', site: input.shelter, throughTick: input.throughTick });
  const preconditions = [...poolFacts(units, input.from, input.byTick), safe, ...input.routes];
  return declaration('evacuate', 'strategy.evacuate', { unitIds: units.map(unit => unit.id), from: input.from,
    at: input.shelter, throughTick: input.throughTick }, input, preconditions,
  [establish(goalFact({ kind: 'assets-safe', unitIds: units.map(unit => unit.id), at: input.shelter,
    throughTick: input.throughTick })), establish(goalFact({ kind: 'worker-at', at: input.shelter,
    count: units.length, byTick: input.byTick }))], demands(units), movementFlows(units, input.from, input.shelter, 0,
    preconditions.map(fact => fact.id)));
}

export function declareGoalTransportPosition(input: Readonly<{
  option: GoalTransportOption; tolerance: number; byTick: number; estimates: GoalNavalEstimates;
}>): GoalActionDeclaration | null {
  if (!Number.isFinite(input.tolerance) || input.tolerance < 0) return null;
  const option = input.option, at = { seaId: option.seaId, point: option.departure.water };
  const preconditions = [goalFact({ kind: 'transport-in', seaId: option.seaId, capacity: 0,
    transport: option.transport, byTick: input.byTick }), ...(option.approach ? [option.approach] : [])];
  const parameters = { transport: option.transport, at, tolerance: input.tolerance, byTick: input.byTick,
    dependentUnitIds: [...new Set(option.loadedUnitIds)].sort() };
  return { id: identity('position-transport', parameters), kind: 'position-transport', preconditions: facts(preconditions),
    effects: [establish(goalFact({ kind: 'transport-at', transport: option.transport, at,
      tolerance: input.tolerance, byTick: input.byTick }))],
    demands: [{ resource: { kind: 'entity-control', entity: option.transport }, quantity: 1,
      from: 'start', until: 'finish' }, ...[...new Set(option.loadedUnitIds)].sort().map(id => ({
        resource: { kind: 'entity-control' as const, entity: existing(id) }, quantity: 1,
        from: 'start' as const, until: 'finish' as const,
      }))], flows: [], ...input.estimates,
    executor: { executor: 'strategy.transport', parameters }, outputs: [], reasons: [] };
}

type GoalTransportInput = GoalNavalCohort & Readonly<{
  option: GoalTransportOption; berthTolerance: number; pickupRoutes: readonly GoalFact[];
}>;
function transport(input: GoalTransportInput, workers: boolean): GoalActionDeclaration | null {
  const units = crew(input, workers), option = input.option;
  if (!units || !Number.isFinite(input.berthTolerance) || input.berthTolerance < 0) return null;
  const hull = option.transport.kind === 'existing'
    ? input.snapshot.units.find(unit => option.transport.kind === 'existing' && unit.id === option.transport.entityId) : undefined;
  if (option.transport.kind === 'existing' && (!hull || hull.hp <= 0 || hull.owner !== input.owner || !isTransportKind(hull.kind))) return null;
  const dependents = hull ? input.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === hull.id) : [];
  if (dependents.some(unit => unit.owner !== input.owner || !option.loadedUnitIds.includes(unit.id))) return null;
  const loaded = units.filter(unit => unit.deck || unit.cabin), waiting = units.filter(unit => !unit.deck && !unit.cabin);
  if (loaded.some(unit => option.transport.kind !== 'existing'
    || (unit.deck?.shipId ?? unit.cabin?.shipId) !== option.transport.entityId
    || !option.loadedUnitIds.includes(unit.id)) || option.origin === 'aboard' && waiting.length) return null;
  const cohort = units.map(unit => existing(unit.id));
  const loadedRefs = loaded.map(unit => existing(unit.id));
  const waitingMass = waiting.reduce((sum, unit) => sum + bodyMass(unit), 0);
  const loadedMass = loaded.reduce((sum, unit) => sum + bodyMass(unit), 0);
  const preconditions: GoalFact[] = [goalFact({ kind: 'transport-in', seaId: option.seaId,
    capacity: waitingMass, transport: option.transport, byTick: input.byTick }), option.crossing, option.shoreSafe];
  if (loaded.length) preconditions.push(goalFact({ kind: 'cargo-aboard', transport: option.transport, units: loadedRefs }));
  if (waiting.length) {
    preconditions.push(...poolFacts(waiting, option.from, input.byTick), ...input.pickupRoutes,
      goalFact({ kind: 'transport-at', transport: option.transport,
        at: { seaId: option.seaId, point: option.departure.water }, tolerance: input.berthTolerance, byTick: input.byTick }));
    if (workers) preconditions.push(...waiting.map(unit => goalFact({ kind: 'worker-at', at: option.from,
      count: 1, worker: existing(unit.id), byTick: input.byTick })));
    else preconditions.push(goalFact({ kind: 'force-at', at: option.from, minimum: rating(input.snapshot, waiting),
      metric: 'combat-rating', cohort: waiting.map(unit => existing(unit.id)), byTick: input.byTick }));
  }
  const effects: GoalFactEffect[] = [
    { fact: goalFact({ kind: 'cargo-aboard', transport: option.transport, units: cohort }), operation: 'invalidate', at: 'finish' },
  ];
  if (workers) effects.push(...units.map(unit => establish(goalFact({ kind: 'worker-at', at: option.to, count: 1,
    worker: existing(unit.id), byTick: input.byTick }))));
  else effects.push(establish(goalFact({ kind: 'force-at', at: option.to, minimum: rating(input.snapshot, units),
    metric: 'combat-rating', cohort, byTick: input.byTick })));
  const resources: GoalActionDeclaration['demands'] = [...demands([...new Map([...units, ...dependents].map(unit => [unit.id, unit])).values()]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    { resource: { kind: 'entity-control', entity: option.transport }, quantity: 1, from: 'start', until: 'finish' },
    ...(waitingMass > 0 ? [{ resource: { kind: 'transport-capacity' as const, transport: option.transport, seaId: option.seaId },
      quantity: waitingMass, from: 'start' as const, until: 'finish' as const }] : [])];
  const flows = movementFlows(waiting, option.from, option.to, workers ? 0 : rating(input.snapshot, waiting), option.factIds);
  // Already loaded soldiers have no invented original land pool. Their actual
  // unload is a destination contribution, and frees their occupied payload.
  for (const unitKind of [...new Set(loaded.map(unit => unit.kind))].sort()) flows.push({
    resource: { kind: 'unit-pool', unitKind, at: option.to }, delta: loaded.filter(unit => unit.kind === unitKind).length,
    at: 'finish', factIds: option.factIds,
  });
  if (!workers && loaded.length) flows.push({ resource: { kind: 'force', at: option.to,
    metric: 'combat-rating', scope: 'post' }, delta: rating(input.snapshot, loaded), at: 'finish', factIds: option.factIds });
  if (loadedMass > 0) flows.push({ resource: { kind: 'transport-capacity', transport: option.transport, seaId: option.seaId },
    delta: loadedMass, at: 'finish', factIds: option.factIds });
  return declaration(workers ? 'transport-worker' : 'transport-force', 'strategy.transport', {
    optionId: option.id, transport: option.transport, unitIds: units.map(unit => unit.id), origin: option.origin,
    from: option.from, at: option.to, departure: { water: option.departure.water, heading: option.departure.heading,
      ...(option.origin === 'land' ? { ground: option.departure.ground } : {}) }, landing: option.landing,
    loadedUnitIds: loaded.map(unit => unit.id), payloadMass: waitingMass + loadedMass,
    dependentUnitIds: dependents.map(unit => unit.id).sort(),
    byTick: input.byTick, berthTolerance: input.berthTolerance,
  }, { ...input, estimates: { ...input.estimates, duration: option.duration } }, preconditions, effects, resources, flows);
}

export function declareGoalForceTransport(input: GoalTransportInput): GoalActionDeclaration | null {
  return transport(input, false);
}
export function declareGoalWorkerTransport(input: GoalTransportInput): GoalActionDeclaration | null {
  return transport(input, true);
}
