import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { bodyMass } from '../../shared/physical-body';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import { assessAllocatedForce } from './allocated-force';
import type { AllocationMethodProvider, AllocationMethodQuoteInput, AllocationPrecondition, AllocationReason,
  AllocationUtility, ExecutableMethod, ForceQuotation, PlannedVoyage } from './allocation-types';
import { arrivalWeightedForce } from './arrival-force';
import { materializeVoyages } from './materialize-voyages';
import { landIdAt } from './regions';
import { strategicTargetCamp } from './target-camp';
import type { ResourceDemand, Target } from './types';
import { unitArrival } from './unit-arrivals';
import { discountGold, forceSuccessProbability, forceTimeGold } from './utility';

const reason = (code: string, factIds: readonly string[] = [], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });
const ids = (units: readonly Unit[]) => units.map(unit => unit.id).sort();
function hallAt(input: Pick<AllocationMethodQuoteInput, 'snapshot' | 'situation' | 'objective'>) {
  return input.snapshot.buildings.find(building => building.owner === input.situation.owner && building.hp > 0 && building.kind === 'townHall'
    && landIdAt(input.snapshot.map, building) === input.objective.target.landId && distance(building, input.objective.target.point) <= GOLD_MINE_RULES.baseRange);
}
function forceDemand(input: Pick<AllocationMethodQuoteInput, 'snapshot' | 'objective'>): ResourceDemand {
  const camp = input.objective.kind === 'ConquerIsland' ? strategicTargetCamp(input.snapshot, input.objective.target) : undefined;
  const required = camp ? assessAllocatedForce(input.objective.owner, [], { metric: 'camp-force', camp }).requiredForce
    : input.objective.effects.find(effect => effect.kind === 'force-present')?.minimumStrength ?? 1;
  return { kind: 'force', metric: camp ? 'camp-force' : 'field-strength', strength: required,
    roles: ['frontline', 'ranged'], at: input.objective.target, neededByTick: null, permanent: true };
}
function action(id: string, executor: string, intent: ExecutableMethod['actions'][number]['intent'], target: Target,
  demands: readonly ResourceDemand[], dependsOn: readonly string[] = [], spendIds: readonly string[] = []): ExecutableMethod['actions'][number] {
  return { id, executor, intent, target, demands, dependsOn, spendIds, completionEffects: [] };
}

export const conquestMethodProvider: AllocationMethodProvider = {
  id: 'strategy.conquest-methods',
  buildMethods(input) {
    const { objective, snapshot } = input;
    if (objective.kind !== 'ConquerIsland' && objective.kind !== 'ReinforceFront') return [];
    const conquest = objective.kind === 'ConquerIsland', id = `${objective.id}/method:${conquest ? 'staged-beachhead' : 'cross-sea-reinforcement'}`;
    const demand = forceDemand(input), camp = conquest ? strategicTargetCamp(snapshot, objective.target) : undefined, hall = hallAt(input);
    const priorClear = input.executions.find(execution => execution.methodId === id && execution.intent.kind === 'clear-camp');
    const priorBuild = input.executions.find(execution => execution.methodId === id && execution.executor === 'strategy.build-hall');
    const retainBuild = priorBuild && !['complete', 'failed', 'abandoned'].includes(priorBuild.status);
    const needsBuild = conquest && (!hall?.complete || retainBuild);
    const hallCapital = !hall || !!priorBuild;
    const worker: ResourceDemand = { kind: 'workers', count: 1, at: objective.target };
    const capital: ResourceDemand = { kind: 'gold', amount: BUILDING_DEFS.townHall.cost }, spendId = `${objective.id}/hall-capital`;
    const deliver = `${id}/deliver-force`, clear = `${id}/clear-camp`, engineer = `${id}/deliver-workers`, wait = `${id}/wait-hall-capital`, build = `${id}/build-hall`;
    const actions = [action(deliver, 'strategy.transport', { kind: 'deliver-force' }, objective.target, [demand])];
    const clearingIntent = camp ? { kind: 'clear-camp' as const, memberIds: camp.creeps.map(unit => unit.id).sort() }
      : priorClear?.intent.kind === 'clear-camp' ? priorClear.intent : undefined;
    if (clearingIntent) actions.push(action(clear, 'strategy.clear-camp', clearingIntent, objective.target, [demand], [deliver]));
    const cleared = clearingIntent ? clear : deliver;
    if (needsBuild) {
      actions.push(action(engineer, 'strategy.transport', { kind: 'deliver-workers' }, objective.target, [worker], [cleared]));
      if (hallCapital) actions.push(action(wait, 'strategy.wait-income', { kind: 'wait-income' }, objective.target, [capital], [cleared], [spendId]));
      actions.push(action(build, 'strategy.build-hall', { kind: 'build-hall' }, objective.target, [worker, ...(hallCapital ? [capital] : [])],
        [engineer, ...(hallCapital ? [wait] : [])], hallCapital ? [spendId] : []));
    }
    const terminal = action(`${id}/garrison`, conquest ? 'strategy.establish-garrison' : 'strategy.establish-force',
      { kind: 'establish-garrison' }, objective.target,
      [conquest ? { kind: 'force', metric: 'field-strength', strength: 1, roles: ['frontline', 'ranged'], at: objective.target, neededByTick: null, permanent: true } : demand],
      [needsBuild ? build : cleared]);
    actions.push({ ...terminal, completionEffects: objective.effects });
    return [{ id, objectiveId: objective.id, providerId: this.id, preference: 0, kind: conquest ? 'staged-beachhead' : 'cross-sea-reinforcement',
      demands: [demand, ...(needsBuild ? [worker] : [])], actions,
      spends: needsBuild && hallCapital ? [{ spendId, amountGold: BUILDING_DEFS.townHall.cost,
        includedUtilityTermCodes: ['hall-after-clearing'], externalReservationIds: ['naval:islandHall'] }] : [],
      preconditions: [], subgoals: [], estimatedTicks: null, status: 'candidate', reasons: [] }];
  },
  materialize(input) {
    const { snapshot, situation, method } = input, selected = new Set(input.unitIds);
    const units = snapshot.units.filter(unit => selected.has(unit.id) && unit.owner === situation.owner && unit.hp > 0);
    const fighters = units.filter(unit => unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0 && unit.expiresTick === undefined);
    const workers = units.filter(unit => unit.kind === 'worker');
    const actions: ExecutableMethod['actions'][number][] = [], voyages: PlannedVoyage[] = [];
    const missing: AllocationPrecondition[] = [], spends = [...method.spends];
    let latestArrival = 0;
    const stepKinds = new Map(method.actions.map(step => [step.id, step.executor]));
    const replaced = new Map<string, readonly string[]>();
    for (const step of method.actions.filter(step => step.executor !== 'strategy.train-transport' && step.executor !== 'strategy.assemble')) {
      if (step.executor === 'strategy.transport') {
        const members = step.intent.kind === 'deliver-workers' ? workers : fighters;
        const plan = materializeVoyages(input, step.id, ids(members));
        latestArrival = Math.max(latestArrival, plan.latestArrivalTicks);
        const parentDependencies = step.dependsOn.filter(id => !['strategy.train-transport', 'strategy.assemble'].includes(stepKinds.get(id) ?? ''));
        missing.push(...plan.missing); spends.push(...plan.spends); voyages.push(...plan.voyages);
        if (!plan.voyages.length && !plan.missing.length) { replaced.set(step.id, parentDependencies); continue; }
        actions.push(...plan.actions);
        const dependencies = [...parentDependencies];
        for (const voyage of plan.voyages) {
          const assemble = `${voyage.id}/assemble`;
          actions.push({ ...action(assemble, 'strategy.assemble', { kind: 'borrow-force' }, voyage.departureGround, [], parentDependencies), unitIds: voyage.unitIds });
          dependencies.push(assemble);
          if (voyage.ship.kind === 'production') dependencies.push(voyage.ship.actionId);
        }
        const demands: ResourceDemand[] = [...step.demands.filter(demand => demand.kind !== 'transport'), ...plan.voyages.map(voyage => ({ kind: 'transport' as const, seaId: voyage.crossing.seaId,
          payloadMass: voyage.unitIds.reduce((sum, id) => sum + bodyMass(units.find(unit => unit.id === id)!), 0),
          departure: voyage.departure.point, landing: voyage.destination.point }))];
        actions.push({ ...step, demands, dependsOn: [...new Set(dependencies)], unitIds: ids(members) });
      } else actions.push({ ...step, unitIds: step.executor === 'strategy.wait-income' ? []
        : ids(step.executor === 'strategy.build-hall' ? workers : fighters) });
    }
    const dependencies = (id: string): readonly string[] => replaced.has(id) ? replaced.get(id)!.flatMap(dependencies) : [id];
    const final = [...new Map(actions.map(step => [step.id, { ...step, dependsOn: [...new Set(step.dependsOn.flatMap(dependencies))] }])).values()];
    return { ...method, actions: final, voyagePlans: voyages, estimatedTicks: latestArrival,
      spends: [...new Map(spends.map(spend => [spend.spendId, spend])).values()],
      preconditions: [...method.preconditions.filter(condition => !condition.id.includes('/materialized:')), ...missing.map(condition => ({ ...condition,
        id: `${method.id}/materialized:${condition.id}` }))] };
  },
  quote(input) {
    const { snapshot, situation, objective, method } = input, requested = new Set(input.unitIds);
    const raw = snapshot.units.filter(unit => unit.owner === situation.owner && unit.hp > 0 && requested.has(unit.id));
    const fighters = raw.filter(unit => unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0 && unit.expiresTick === undefined);
    const camp = objective.kind === 'ConquerIsland' ? strategicTargetCamp(snapshot, objective.target) : undefined, demand = forceDemand(input);
    const requiredForce = demand.kind === 'force' ? demand.strength : 1;
    const assessment = (group: readonly Unit[]) => assessAllocatedForce(situation.owner, group,
      camp ? { metric: 'camp-force', camp } : { metric: 'field-strength', requiredForce });
    const total = assessment(fighters), onStation: Unit[] = [], enRoute: { unit: Unit; etaTicks: number }[] = [], unknown: string[] = [], unavailable: string[] = [];
    const facts = new Map(situation.units.map(unit => [unit.id, unit]));
    let latest = 0;
    for (const unit of fighters) {
      const fact = facts.get(unit.id);
      if (fact?.location.kind === 'land' && fact.location.landId === objective.target.landId && distance(unit, objective.target.point) <= 650) { onStation.push(unit); continue; }
      const arrival = fact && unitArrival(fact, objective.target.entityId ?? '');
      if (!arrival || arrival.status === 'unknown') { unknown.push(unit.id); continue; }
      if (!('ticks' in arrival)) { unavailable.push(unit.id); continue; }
      enRoute.push({ unit, etaTicks: arrival.ticks }); latest = Math.max(latest, arrival.ticks);
    }
    latest = Math.max(latest, method.estimatedTicks ?? 0);
    const weighted = arrivalWeightedForce(onStation, enRoute, situation.horizonTicks, group => assessment(group).force);
    const force: ForceQuotation = { metric: camp ? 'camp-force' : 'field-strength', target: objective.target,
      onStationUnitIds: ids(onStation), enRouteUnitIds: enRoute.map(entry => entry.unit.id), unavailableUnitIds: unavailable, unknownUnitIds: unknown,
      onStationForce: weighted.onStationForce, effectiveForce: weighted.effectiveForce, discountedEnRouteForce: weighted.discountedEnRouteForce,
      requiredForce, evaluationUntilTick: situation.tick + situation.horizonTicks };
    const missing: AllocationPrecondition[] = method.preconditions.filter(condition => condition.status !== 'met')
      .map(condition => ({ ...condition, reason: reason(condition.reason.code) }));
    const add = (code: string, kind: AllocationPrecondition['kind'], factIds: readonly string[] = []) => missing.push({ id: `${method.id}/${code}`, kind,
      status: code.includes('unknown') ? 'unknown' : 'unmet', reason: reason(code, factIds), demand, subgoalIds: [] });
    if (raw.length !== requested.size) add('allocated-member-no-longer-present', 'force');
    if (!total.sufficient) add('insufficient-assembled-clearing-force', 'force', ids(fighters));
    if (unknown.length) add('clearing-route-unknown', 'route', unknown);
    if (unavailable.length) add('clearing-route-unreachable', 'route', unavailable);
    if (objective.kind === 'ConquerIsland' && !hallAt(input)?.complete && !raw.some(unit => unit.kind === 'worker')) add('no-allocated-construction-worker', 'workers');
    const dps = fighters.reduce((sum, unit) => sum + combatCapability(snapshot, unit).dps, 0);
    const combatTicks = camp && dps > 0 ? Math.ceil(camp.creeps.reduce((sum, unit) => sum + unit.hp, 0) / dps * SIM_TICKS_PER_SECOND) : 0;
    const gatherTicks = 2 * SIM_TICKS_PER_SECOND, duration = latest + gatherTicks + combatTicks;
    const enemyDps = camp?.creeps.reduce((sum, unit) => sum + combatCapability(snapshot, unit).dps, 0) ?? 0;
    const expectedLossFraction = Math.min(1, enemyDps * combatTicks / SIM_TICKS_PER_SECOND / Math.max(1, fighters.reduce((sum, unit) => sum + unit.hp, 0)));
    const attrition = fighters.reduce((sum, unit) => sum + UNIT_DEFS[unit.kind].cost, 0) * expectedLossFraction;
    const source = objective.conditionalQuote?.potentialUtility ?? objective.utility;
    const mine = situation.assets.find(asset => asset.id === objective.target.entityId), hall = hallAt(input);
    const benefit = objective.kind === 'ConquerIsland' && mine ? [
      { code: 'island-income', value: discountGold(mine.discountedValueGold, duration) },
      { code: 'new-site-asset', value: hall ? 0 : BUILDING_DEFS.townHall.cost },
      { code: 'hall-after-clearing', value: hall ? 0 : -BUILDING_DEFS.townHall.cost },
    ] : source.benefit.map(term => ({ code: term.code, value: discountGold(term.value, duration) }));
    const cost = [...source.cost.filter(term => !['force-time', 'new-transport', 'camp-attrition'].includes(term.code)).map(term => ({ code: term.code, value: term.value })),
      { code: 'force-time', value: forceTimeGold(assessAllocatedForce(situation.owner, fighters, { metric: 'field-strength', requiredForce: 0 }).force, duration) },
      { code: 'new-transport', value: method.spends.filter(spend => spend.includedUtilityTermCodes.includes('new-transport'))
        .reduce((sum, spend) => sum + Math.max(0, spend.amountGold - input.budgets.filter(budget => budget.spendId === spend.spendId)
          .reduce((paid, budget) => Math.max(paid, budget.paidGold), 0)), 0) },
      { code: 'camp-attrition', value: attrition }];
    const probability = forceSuccessProbability(total.force, requiredForce);
    const utility: AllocationUtility = { horizonTicks: source.horizonTicks, benefit, cost, successProbability: probability,
      persistenceBonus: source.persistenceBonus, score: probability * benefit.reduce((sum, term) => sum + term.value, 0)
        - cost.reduce((sum, term) => sum + term.value, 0) + source.persistenceBonus };
    const why = reason(missing[0]?.reason.code ?? 'assembled-cohort-and-prerequisite-plan-feasible', ids(fighters),
      { requiredForce, assembledForce: total.force, currentEffectiveForce: weighted.effectiveForce, latestArrivalTicks: latest, combatTicks });
    return missing.length ? { methodId: method.id, status: 'blocked', force, utility: null, potentialUtility: utility, missingPreconditions: missing, reason: why }
      : { methodId: method.id, status: 'feasible', force, utility, potentialUtility: null, missingPreconditions: [], reason: why };
  },
};
