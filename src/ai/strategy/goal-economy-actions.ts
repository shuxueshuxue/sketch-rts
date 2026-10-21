import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS, canTrainAt, requiredSupplyCap, trainingBuildingFor, unitMover } from '../../shared/catalog';
import { createBuilding } from '../../shared/map';
import { trainingRecruitPrototype } from '../../shared/sim';
import { productionRallyPoint } from '../../shared/production-spawn';
import { shipProfile } from '../../shared/ship-geometry';
import { isTransportKind } from '../../shared/transport-role';
import type { BuildingKind, TrainableUnitKind } from '../../shared/types';
import { combatRating } from '../policy/v6/strength';
import { goalFact, goalValueKey } from './goal-facts';
import type { AllocationReason } from './allocation-types';
import type { GoalActionDeclaration, GoalBuildSite, GoalEntityReference, GoalEstimate, GoalFact, GoalPlanningContext } from './goal-planner-types';
import type { Target } from './types';

const reason = (code: string, factIds: readonly string[] = []): AllocationReason => ({ code, factIds, values: {} });
const known = <T>(value: T, factIds: readonly string[] = []): GoalEstimate<T> => ({ state: 'met', value, factIds });
const failed = (code: string, factIds: readonly string[] = []): GoalEstimate<never> => ({ state: 'unmet', reason: reason(code, factIds) });
const unique = (facts: readonly GoalFact[]) => [...new Map(facts.map(fact => [fact.id, fact])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const validCount = (count: number) => Number.isSafeInteger(count) && count > 0;

/** Grounding is supplied by the shared world-fact source. These functions do
 * not choose sites, run navigation, reserve money or connect action chains. */
export function declareGoalTraining(input: Readonly<{
  unitKind: TrainableUnitKind; count: number; producer: GoalEntityReference; at: Target; byTick: number;
}>, context: GoalPlanningContext): GoalActionDeclaration | null {
  const { unitKind, count, producer, at, byTick } = input;
  if (!validCount(count) || !Number.isFinite(byTick)) return null;
  const race = context.snapshot.players[context.owner]?.race;
  if (!race || !trainingBuildingFor(race, unitKind)) return null;
  const existing = producer.kind === 'existing' ? context.snapshot.buildings.find(building => building.id === producer.entityId) : undefined;
  if (producer.kind === 'existing' && (!existing || existing.owner !== context.owner || existing.hp <= 0
    || !canTrainAt(race, existing.kind, unitKind))) return null;
  const rules = UNIT_DEFS[unitKind], amountGold = count * rules.cost;
  const source = existing ?? createBuilding('goal-training-assessment', context.owner, trainingBuildingFor(race, unitKind)!, at.point.x, at.point.y, true);
  const production = goalFact({ kind: 'production', unitKind, producer, at, byTick });
  // A pool anchor is not the native rally input. Reuse the same live unit /
  // resource rally target (or native new-building default) used at birth.
  const exit = goalFact({ kind: 'spawn-exit', producer, unitKind, toward: { point: productionRallyPoint(context.snapshot, source) } });
  const gold = goalFact({ kind: 'gold', minimum: amountGold, byTick });
  const room = goalFact({ kind: 'population-room', minimum: count * rules.supplyUsed, byTick });
  const cap = goalFact({ kind: 'supply-cap', minimum: requiredSupplyCap(unitKind) });
  const effect = goalFact({ kind: 'unit-available', unitKind, count, at, byTick });
  const id = `action:train:${goalFact({ kind: 'production', unitKind, producer, at, byTick }).id}:${count}`;
  // Native derived stats include this owner's current upgrades. Assessment
  // copies never enter outputs/entityIds, leases or the world snapshot.
  const recruit = trainingRecruitPrototype(context.snapshot, source, { unitKind, remaining: 0 });
  const recruitForce = unitMover(unitKind) === 'land' ? count * combatRating(recruit) : 0;
  const hullCapacity = isTransportKind(unitKind) ? shipProfile(recruit)?.loadCapacity ?? 0 : 0;
  // Training replenishes a fungible region pool. A later ready action leases
  // actual members; it never depends on this job producing a named entity.
  const transportEffect = hullCapacity > 0 && at.seaId ? goalFact({ kind: 'transport-in', seaId: at.seaId,
    capacity: count * hullCapacity, byTick }) : null;
  const workerEffects = unitKind === 'worker' && at.landId ? [goalFact({ kind: 'worker-at', at, count, byTick })] : [];
  return {
    id, kind: 'train', precision: context.precision ?? 'exact', preconditions: unique([production, exit, gold, room, cap]),
    effects: [{ fact: effect, operation: 'establish', at: 'finish' }, ...(transportEffect ? [{
      fact: transportEffect, operation: 'establish' as const, at: 'finish' as const }] : []),
      ...workerEffects.map(fact => ({ fact, operation: 'establish' as const, at: 'finish' as const }))],
    demands: [{ resource: { kind: 'production-lane', producer, lane: 'training' }, quantity: 1, from: 'start', until: 'finish' }],
    flows: [
      { resource: { kind: 'gold' }, delta: -amountGold, at: 'start', factIds: [gold.id] },
      { resource: { kind: 'population-room' }, delta: -count * rules.supplyUsed, at: 'start', factIds: [room.id] },
      { resource: { kind: 'unit-pool', unitKind, at }, delta: count, at: 'finish', factIds: [effect.id] },
      ...(recruitForce > 0 ? [{ resource: { kind: 'force' as const, scope: 'pool' as const, at, metric: 'combat-rating' as const },
        delta: recruitForce, at: 'finish' as const, factIds: [effect.id] }] : []),
      ...(transportEffect && at.seaId ? [{ resource: { kind: 'transport-capacity' as const, seaId: at.seaId },
        delta: count * hullCapacity, at: 'finish' as const, factIds: [exit.id] }] : []),
    ],
    // production is the available lane, not an unpriced queue wait; spawn-exit
    // is independently required. Native training advances one work/tick.
    duration: known(count * rules.trainTime, [production.id, exit.id]),
    // Capital buys retained pool assets. Battle/voyage/other consumption is
    // priced by those actions; charging purchase again would count it twice.
    cost: known([{ code: 'training-asset-exchange', gold: 0, factIds: [gold.id, effect.id] }]),
    successProbability: known(1, [production.id, exit.id]),
    executor: { executor: 'goal.train', parameters: { unitKind, count, producer, at } },
    outputs: [], reasons: [],
  };
}

/** One worker does the remaining native construction work. A worker-at fact
 * is only a same-land pool: the separate, same-think route pays the walk. */
export function declareGoalBuilding(input: Readonly<{
  buildingKind: BuildingKind; at: Target; byTick: number;
  worker: Readonly<{ ref: GoalEntityReference; from?: Target }>;
  foundationId?: string; additionalPreconditions?: readonly GoalFact[]; siteBinding?: GoalBuildSite;
}>, context: GoalPlanningContext): GoalActionDeclaration | null {
  const { buildingKind, at, byTick, worker } = input, race = context.snapshot.players[context.owner]?.race;
  const pooled = worker.ref.kind === 'pool-member' && worker.ref.unitKind === 'worker' && worker.ref.at.landId === at.landId;
  if (!race || !at.landId || worker.ref.kind === 'pool-member' && !pooled
    || (!pooled && !worker.from?.landId) || worker.from && worker.from.landId !== at.landId || !Number.isFinite(byTick)
    || !RACE_DEFS[race].buildableBuildings.includes(buildingKind)) return null;
  const binding = input.siteBinding;
  if (binding && (binding.buildingKind !== buildingKind || goalFact({ kind: 'build-site', buildingKind, at: binding.at }).id
    !== goalFact({ kind: 'build-site', buildingKind, at }).id)) return null;
  const matchingFoundations = context.snapshot.buildings.filter(building => building.owner === context.owner && building.kind === buildingKind
    && building.hp > 0 && !building.complete && Math.hypot(building.x - at.point.x, building.y - at.point.y) <= 1e-6);
  if (!input.foundationId && matchingFoundations.length > 1) return null;
  const foundation = input.foundationId ? context.snapshot.buildings.find(building => building.id === input.foundationId) : matchingFoundations[0];
  if (input.foundationId && (!foundation || foundation.owner !== context.owner || foundation.kind !== buildingKind
    || foundation.hp <= 0 || foundation.complete || Math.hypot(foundation.x - at.point.x, foundation.y - at.point.y) > 1e-6)) return null;
  const ref = worker.ref;
  const builder = ref.kind === 'existing' ? context.snapshot.units.find(unit => unit.id === ref.entityId) : undefined;
  const conditionalWorker = ref.kind === 'existing' && binding?.preconditions.some(fact => fact.predicate.kind === 'worker-at'
    && fact.predicate.at.landId === at.landId && fact.predicate.count >= 1
    && fact.predicate.worker?.kind === 'existing' && fact.predicate.worker.entityId === ref.entityId);
  if (worker.ref.kind === 'existing' && (!builder || builder.owner !== context.owner || builder.kind !== 'worker'
    || builder.hp <= 0 || (builder.deck || builder.cabin) && !conditionalWorker)) return null;
  const rules = BUILDING_DEFS[buildingKind], amountGold = foundation ? 0 : rules.cost;
  const workTicks = foundation ? Math.max(0, Math.ceil(foundation.buildTime - foundation.buildProgress)) : rules.buildTime;
  const site = goalFact({ kind: 'build-site', buildingKind, at });
  const workers = goalFact({ kind: 'worker-at', at, count: 1, byTick, ...(!pooled ? { worker: worker.ref } : {}) });
  const route = binding ? binding.route : worker.from ? goalFact({ kind: 'route', mover: 'land', from: worker.from, to: at, actor: worker.ref }) : null;
  const gold = goalFact({ kind: 'gold', minimum: amountGold, byTick });
  const routeFact = binding || !route || context.precision === 'coarse' ? null : context.readFact(route);
  let duration: GoalEstimate<number>;
  if (context.precision === 'coarse') duration = known(workTicks, [workers.id]);
  else if (binding) duration = binding.walkTicks.state === 'met'
    ? Number.isFinite(binding.walkTicks.value) && binding.walkTicks.value >= 0
      ? known(binding.walkTicks.value + workTicks, [...binding.factIds, ...binding.walkTicks.factIds])
      : failed('construction-route-time-unavailable', route ? [route.id] : [workers.id]) : binding.walkTicks;
  else if (!route) duration = { state: 'pending', requestIds: [`worker-pool-route:${workers.id}`],
    reason: reason('construction-worker-pool-route-pending', [workers.id]) };
  else if (routeFact!.state === 'pending') duration = { state: 'pending', requestIds: [routeFact!.requestId], reason: routeFact!.reason };
  else if (routeFact!.state === 'unmet') duration = { state: 'unmet', reason: routeFact!.reason };
  else if (routeFact!.route?.ticks === null || routeFact!.route?.ticks === undefined || !Number.isFinite(routeFact!.route.ticks)
    || routeFact!.route.ticks < 0) duration = failed('construction-route-time-unavailable', [route.id]);
  else duration = known(routeFact!.route.ticks + workTicks, [route.id, site.id]);
  const baseEffect = goalFact({ kind: 'building-complete', buildingKind, at,
    ...(foundation ? { building: { kind: 'existing' as const, entityId: foundation.id } } : {}) });
  const mineId = binding?.logicalTarget.entityId;
  const mine = mineId ? context.snapshot.resources.find(resource => resource.id === mineId && resource.amount > 0) : undefined;
  const effects = unique([baseEffect,
    ...(buildingKind === 'townHall' && mine && binding
      ? [goalFact({ kind: 'hall-complete', mineId: mine.id, at: binding.logicalTarget })] : []),
    ...(buildingKind === 'shipyard' && (binding?.logicalTarget.seaId ?? at.seaId)
      ? [goalFact({ kind: 'shipyard-for', seaId: (binding?.logicalTarget.seaId ?? at.seaId)! })] : [])]);
  const additionalPreconditions = unique([...(input.additionalPreconditions ?? []), ...(binding?.preconditions ?? [])]);
  const safety = unique([goalFact({ kind: 'site-safe', site: at, throughTick: byTick }),
    ...(buildingKind === 'townHall' && mine && binding
      ? [goalFact({ kind: 'site-safe', site: binding.logicalTarget, throughTick: byTick })] : [])]);
  const preconditions = unique([workers, ...(route ? [route] : []), ...(foundation ? [] : [site, gold]), ...safety, ...additionalPreconditions]);
  const id = `action:build:${JSON.stringify([baseEffect.id, route?.id ?? goalValueKey(worker.ref),
    effects.map(fact => fact.id), preconditions.map(fact => fact.id)])}`;
  const building: GoalEntityReference = foundation ? { kind: 'existing', entityId: foundation.id }
    : { kind: 'output', actionId: id, output: 'building' };
  // A native new producer completes with an empty training lane. Declare the
  // production capability explicitly so regression can discover the build;
  // population tier and free room remain independent training preconditions.
  const production = (!foundation?.queue.length ? rules.trains.filter(unitKind => canTrainAt(race, buildingKind, unitKind)) : [])
    .map(unitKind => goalFact({ kind: 'production', unitKind, producer: building, at, byTick }));
  const completed = unique([...effects, goalFact({ kind: 'building-complete', buildingKind, at, building }), ...production]);
  return {
    id, kind: 'build', precision: context.precision ?? 'exact', preconditions,
    effects: [
      ...(foundation ? [] : [{ fact: site, operation: 'invalidate' as const, at: 'start' as const }]),
      ...completed.map(fact => ({ fact, operation: 'establish' as const, at: 'finish' as const })),
    ],
    demands: [{ resource: { kind: 'entity-control', entity: worker.ref }, quantity: 1, from: 'start', until: 'finish' }],
    flows: [
      { resource: { kind: 'gold' }, delta: amountGold ? -amountGold : 0, at: 'start', factIds: foundation ? [foundation.id] : [gold.id] },
      ...(pooled ? [
        { resource: { kind: 'unit-pool' as const, unitKind: 'worker' as const, at }, delta: -1, at: 'start' as const, factIds: [workers.id] },
        { resource: { kind: 'unit-pool' as const, unitKind: 'worker' as const, at }, delta: 1, at: 'finish' as const, factIds: [workers.id] },
      ] : []),
      ...(rules.supplyProvided ? [
        { resource: { kind: 'supply-cap' as const }, delta: rules.supplyProvided, at: 'finish' as const, factIds: [baseEffect.id] },
        { resource: { kind: 'population-room' as const }, delta: rules.supplyProvided, at: 'finish' as const, factIds: [baseEffect.id] },
      ] : []),
      ...(!foundation ? [{ resource: { kind: 'entity-control' as const, entity: building }, delta: 1,
        at: 'finish' as const, factIds: [baseEffect.id] }] : []),
      ...(production.length ? [{ resource: { kind: 'production-lane' as const, producer: building, lane: 'training' },
        delta: 1, at: 'finish' as const, factIds: [baseEffect.id] }] : []),
    ],
    // The hall/yard remains as an effect under the explicit safety obligation.
    // Full native capital still leaves gold at start; occupancy is quoted by
    // the shared allocator, rather than consumed again as a utility loss.
    duration, cost: known([{ code: 'construction-asset-exchange', gold: 0,
      factIds: [...(foundation ? [foundation.id] : [gold.id]), ...safety.map(fact => fact.id), baseEffect.id] }]),
    successProbability: known(1, [site.id, ...(route ? [route.id] : [])]),
    executor: { executor: 'goal.build', parameters: { buildingKind, at, worker: worker.ref,
      approach: route?.predicate.kind === 'route' ? route.predicate.to : at, foundationId: foundation?.id ?? null } },
    outputs: foundation ? [] : ['building'], reasons: context.precision === 'coarse'
      ? [reason('coarse-construction-walk-lower-bound', [workers.id])] : [],
  };
}

/** Waiting realizes only the shared income forecast's incremental money.
 * Existing free gold is not credited again as an action output. */
export function declareGoalWaitIncome(effect: GoalFact, context: GoalPlanningContext): GoalActionDeclaration | null {
  if (effect.predicate.kind !== 'gold') return null;
  const observed = context.readFact(effect), forecast = observed.goldForecast;
  if (!forecast?.source?.id || forecast.epoch !== context.tick || !Number.isFinite(effect.predicate.minimum) || effect.predicate.minimum < 0
    || !Number.isFinite(effect.predicate.byTick) || effect.predicate.byTick < context.tick
    || !Number.isFinite(forecast.currentFreeGold) || forecast.currentFreeGold < 0
    || !Number.isFinite(forecast.goldAtDeadline) || forecast.currentFreeGold >= effect.predicate.minimum) return null;
  const wanted = Math.min(effect.predicate.minimum, forecast.goldAtDeadline) - forecast.currentFreeGold;
  if (wanted <= 0) return null;
  const segments: { fromTick: number; throughTick: number; ratePerTick: number }[] = [];
  let remaining = wanted, credited = 0, previousThrough = -Infinity;
  for (const segment of [...forecast.source.segments].sort((a, b) => a.fromTick - b.fromTick || a.throughTick - b.throughTick)) {
    if (![segment.fromTick, segment.throughTick, segment.ratePerTick].every(Number.isFinite)
      || segment.ratePerTick < 0 || segment.throughTick < segment.fromTick || segment.fromTick < previousThrough) return null;
    previousThrough = segment.throughTick;
    const fromTick = Math.max(context.tick, segment.fromTick), throughTick = Math.min(Math.floor(effect.predicate.byTick), segment.throughTick);
    if (throughTick <= fromTick || segment.ratePerTick === 0 || remaining <= 0) continue;
    const delta = Math.min(remaining, (throughTick - fromTick) * segment.ratePerTick);
    segments.push({ fromTick, throughTick: fromTick + delta / segment.ratePerTick, ratePerTick: segment.ratePerTick });
    credited += delta; remaining -= delta;
  }
  if (credited <= 0) return null;
  const minimum = forecast.currentFreeGold + credited;
  const partial = minimum < effect.predicate.minimum;
  const creditedFact = partial ? goalFact({ ...effect.predicate, minimum }) : effect;
  const duration = observed.state === 'pending'
    ? { state: 'pending' as const, requestIds: [observed.requestId], reason: observed.reason }
    : known(Math.ceil(segments.at(-1)!.throughTick - context.tick), forecast.factIds);
  return {
    id: `action:wait-income:${creditedFact.id}`, kind: 'wait-income', precision: context.precision ?? 'exact', preconditions: [],
    effects: [{ fact: creditedFact, operation: 'establish', at: 'finish' }], demands: [],
    flows: [{ resource: { kind: 'gold' }, delta: credited, at: 'finish',
      factIds: forecast.factIds, source: { ...forecast.source, segments } }], duration,
    cost: known([]), successProbability: known(1, forecast.factIds),
    executor: { executor: 'goal.wait-income', parameters: { minimumGold: minimum, byTick: effect.predicate.byTick } },
    outputs: [], reasons: partial ? [reason('income-partial-contribution', forecast.factIds)] : [],
  };
}
