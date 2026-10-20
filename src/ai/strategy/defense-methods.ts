import { UNIT_DEFS } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { averagePoint, distance } from '../policy/spatial';
import { TOWER_STRENGTH } from '../policy/v6/strength';
import { assessAllocatedForce } from './allocated-force';
import type { AllocationMethodProvider, AllocationReason, AllocationUtility, ExecutableMethod,
  ForceQuotation, MethodAllocationQuote } from './allocation-types';
import type { DecisionFacts } from './decision';
import { defenseCoverPost, defenseGatherPost } from './executors/defend-site';
import type { Method, Objective, ResourceDemand, Situation, Target } from './types';
import { forceSuccessProbability, forceTimeGold } from './utility';
import { unitArrival } from './unit-arrivals';
import { siteCollapseAfter } from './naval-objectives';
import { arrivalWeightedForce } from './arrival-force';
import { materializeVoyages } from './materialize-voyages';
import { unitMover } from '../../shared/catalog';
import { bodyMass } from '../../shared/physical-body';

const reason = (code: string, factIds: readonly string[] = [], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });
const defenderKinds: readonly Method['kind'][] = ['local-squad', 'main-army-recall', 'wait-in-cover', 'cross-sea-reinforcement', 'evacuation'];
const forceDemand = (at: Target, strength: number): ResourceDemand => ({ kind: 'force', metric: 'field-strength', strength,
  roles: ['frontline', 'ranged'], at, neededByTick: null, permanent: false });

function threatAt(situation: DecisionFacts<Situation>, objective: DecisionFacts<Objective>) {
  return situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === objective.target.entityId);
}

function requiredDefense(situation: DecisionFacts<Situation>, objective: DecisionFacts<Objective>) {
  const threat = threatAt(situation, objective), effect = objective.effects.find(effect => effect.kind === 'force-present');
  // Total occupancy, including the incumbent post. A zero reinforcement deficit
  // must not release the defenders who make that deficit zero.
  return Math.max(effect?.kind === 'force-present' ? effect.minimumStrength : 1,
    (threat ? threat.arrivedStrength + threat.incomingStrength : 0) * 1.25);
}

function shelter(snapshot: GameSnapshot, situation: DecisionFacts<Situation>, objective: DecisionFacts<Objective>): Target | undefined {
  const effect = objective.effects.find(effect => effect.kind === 'assets-evacuated');
  if (effect?.kind === 'assets-evacuated') return effect.destination;
  return situation.assets.filter(asset => asset.owner === situation.owner && asset.kind === 'hall' && asset.complete
    && asset.id !== objective.target.entityId && sameGround(snapshot.map, asset.target.point, objective.target.point)
    && !situation.lands.flatMap(land => land.threats).some(threat => threat.siteId === asset.id
      && threat.arrivedStrength + threat.incomingStrength > threat.friendlyOnStationStrength))
    .sort((a, b) => distance(a.target.point, objective.target.point) - distance(b.target.point, objective.target.point))[0]?.target;
}

function method(input: Parameters<AllocationMethodProvider['buildMethods']>[0], kind: Method['kind'], preference: number): ExecutableMethod {
  const { snapshot, situation, objective } = input, id = `${objective.id}/method:${kind}`;
  const destination = kind === 'evacuation' ? shelter(snapshot, situation, objective) : undefined;
  const attackerIds = new Set(threatAt(situation, objective)?.attackers.map(attacker => attacker.unitId));
  const attackers = snapshot.units.filter(unit => attackerIds.has(unit.id));
  const field = attackers.length ? averagePoint(attackers) : objective.target.point;
  const known = input.executions.find(action => action.methodId === id && action.executor === 'strategy.defend-site'
    && !['complete', 'failed', 'abandoned'].includes(action.status));
  const post = kind === 'wait-in-cover' ? defenseCoverPost({ snapshot, owner: situation.owner }, objective.target.point, field)?.point
    : defenseGatherPost(objective.target.point, field);
  const at = kind === 'evacuation' ? destination ?? objective.target : known?.target ?? { ...objective.target, point: post ?? objective.target.point };
  const count = objective.effects.find(effect => effect.kind === 'assets-evacuated');
  const workers = count?.kind === 'assets-evacuated' ? count.unitIds.length : situation.units.filter(unit => unit.owner === situation.owner
    && unit.roles.includes('worker') && unit.location.kind === 'land' && unit.location.landId === objective.target.landId
    && distance(unit.location.point, objective.target.point) <= 650).length;
  const demands: ResourceDemand[] = kind === 'evacuation' ? [{ kind: 'workers', count: workers, at }]
    : [forceDemand(at, requiredDefense(situation, objective))];
  const travel = kind === 'cross-sea-reinforcement' ? `${id}/deliver` : undefined;
  const finish = `${id}/${kind === 'evacuation' ? 'evacuate' : 'defend'}`;
  return { id, objectiveId: objective.id, kind, providerId: 'strategy.defense-methods', preference, spends: [],
    demands, preconditions: [], subgoals: [], estimatedTicks: null, status: 'candidate', reasons: [], actions: [
      ...(travel ? [{ id: travel, executor: 'strategy.transport', intent: { kind: 'deliver-force' as const }, target: at,
        dependsOn: [], demands, spendIds: [], completionEffects: [] }] : []),
      { id: finish, executor: kind === 'evacuation' ? 'strategy.evacuate' : 'strategy.defend-site',
        intent: { kind: kind === 'evacuation' ? 'evacuate' : kind === 'wait-in-cover' ? 'wait-in-cover'
          : kind === 'main-army-recall' ? 'recall' : 'defend-site' }, target: at,
        dependsOn: travel ? [travel] : [], demands, spendIds: [],
        completionEffects: kind === 'evacuation' ? [] : objective.effects },
    ] };
}

export const defenseMethodProvider: AllocationMethodProvider = {
  id: 'strategy.defense-methods',
  buildMethods(input) {
    if (input.objective.kind === 'Evacuate') return [method(input, 'evacuation', 0)];
    if (input.objective.kind !== 'DefendSite') return [];
    return defenderKinds.map((kind, preference) => method(input, kind, preference));
  },
  materialize(input) {
    if (input.method.kind !== 'cross-sea-reinforcement') return input.method;
    const wanted = new Set(input.unitIds), units = input.snapshot.units.filter(unit => wanted.has(unit.id)
      && unit.owner === input.situation.owner && unit.hp > 0 && unitMover(unit.kind) === 'land' && unit.kind !== 'worker');
    const defend = input.method.actions.at(-1)!;
    const travel = input.method.actions.find(action => action.executor === 'strategy.transport') ?? {
      id: `${input.method.id}/deliver`, executor: 'strategy.transport', intent: { kind: 'deliver-force' as const }, target: defend.target,
      demands: input.method.demands, dependsOn: [], spendIds: [], completionEffects: [] };
    const plan = materializeVoyages(input, travel.id, units.map(unit => unit.id));
    const assembling = plan.voyages.map(voyage => ({ id: `${voyage.id}/assemble`, executor: 'strategy.assemble',
      intent: { kind: 'borrow-force' as const }, target: voyage.departureGround, demands: [], dependsOn: [], spendIds: [],
      completionEffects: [], unitIds: voyage.unitIds }));
    const dependencies = [...assembling.map(action => action.id), ...plan.voyages.flatMap(voyage => voyage.ship.kind === 'production' ? [voyage.ship.actionId] : [])];
    const demands: ResourceDemand[] = [...travel.demands.filter(demand => demand.kind !== 'transport'), ...plan.voyages.map(voyage => ({ kind: 'transport' as const, seaId: voyage.crossing.seaId,
      payloadMass: voyage.unitIds.reduce((sum, id) => sum + bodyMass(units.find(unit => unit.id === id)!), 0),
      departure: voyage.departure.point, landing: voyage.destination.point }))];
    const needsTravel = plan.voyages.length > 0 || plan.missing.length > 0;
    return { ...input.method, voyagePlans: plan.voyages, spends: plan.spends, preconditions: plan.missing, estimatedTicks: plan.latestArrivalTicks,
      actions: [...plan.actions, ...assembling,
        ...(needsTravel ? [{ ...travel, demands, dependsOn: dependencies, unitIds: units.map(unit => unit.id) }] : []),
        { ...defend, dependsOn: needsTravel ? [travel.id] : [], unitIds: units.map(unit => unit.id) }] };
  },
  quote(input): MethodAllocationQuote {
    const { snapshot, situation, objective, method, unitIds } = input;
    const requested = new Set(unitIds), selected = snapshot.units.filter(unit => requested.has(unit.id)
      && unit.owner === situation.owner && unit.hp > 0);
    const targetId = objective.target.entityId ?? objective.id, responseId = method.actions.at(-1)!.id;
    const threat = threatAt(situation, objective);
    const facts = new Map(situation.units.filter(unit => requested.has(unit.id)).map(unit => [unit.id, unit]));
    const evacuation = method.kind === 'evacuation';
    const at = evacuation ? shelter(snapshot, situation, objective) : objective.target;
    let missing: string | undefined;
    const unavailable: string[] = [], unknown: string[] = [], stationed: string[] = [], enRoute: string[] = [];
    const etas = new Map<string, number>();
    let latest = 0;
    for (const unit of selected) {
      const fact = facts.get(unit.id), arrival = fact && unitArrival(fact, responseId);
      if (!evacuation && method.kind === 'cross-sea-reinforcement' && fact?.roles.includes('transport')) continue;
      const sameLand = fact?.location.kind === 'land' && fact.location.landId === objective.target.landId;
      if (!fact || (!evacuation && (fact.roles.includes('worker') || fact.roles.includes('transport') || fact.roles.includes('warship')))
        || (evacuation && unit.kind !== 'worker')) { unavailable.push(unit.id); continue; }
      if (!evacuation && method.kind !== 'cross-sea-reinforcement' && !sameLand) { unavailable.push(unit.id); continue; }
      if (!evacuation && method.kind === 'local-squad' && distance(unit, objective.target.point) > 650) { unavailable.push(unit.id); continue; }
      if (fact.location.kind === 'land' && fact.location.landId === method.actions.at(-1)!.target.landId
        && distance(unit, method.actions.at(-1)!.target.point) <= 240) { stationed.push(unit.id); continue; }
      if (!arrival || arrival.status === 'unknown') { unknown.push(unit.id); continue; }
      if (!('ticks' in arrival)) { unavailable.push(unit.id); continue; }
      if (arrival.status === 'conditional' && !method.voyagePlans?.length) missing = 'response-route-prerequisites-unmet';
      latest = Math.max(latest, arrival.ticks); enRoute.push(unit.id); etas.set(unit.id, arrival.ticks);
    }
    if (selected.length !== requested.size) missing = 'allocated-unit-no-longer-present';
    if (method.preconditions.some(condition => condition.status !== 'met')) missing = method.preconditions.find(condition => condition.status !== 'met')!.reason.code;
    if (unavailable.length) missing = 'allocated-units-ineligible-for-method';
    if (unknown.length) missing = 'response-arrival-unknown';
    const validIds = new Set([...stationed, ...enRoute]);
    const cohort = selected.filter(unit => validIds.has(unit.id));
    const demand = requiredDefense(situation, objective);
    const covering = method.kind === 'wait-in-cover' ? snapshot.buildings.filter(tower => tower.owner === situation.owner
      && tower.complete && tower.hp > 0 && tower.attackDamage > 0
      && distance(tower, method.actions.at(-1)!.target.point) + 80 <= tower.attackRange) : [];
    const coverForce = covering.reduce((sum, tower) => sum + TOWER_STRENGTH * tower.hp / tower.maxHp, 0);
    if (method.kind === 'wait-in-cover' && !covering.length) missing = 'no-reachable-tower-cover';
    const total = assessAllocatedForce(situation.owner, cohort, { metric: 'field-strength', requiredForce: Math.max(0, demand - coverForce) });
    const weighted = arrivalWeightedForce(cohort.filter(unit => stationed.includes(unit.id)),
      cohort.filter(unit => enRoute.includes(unit.id)).map(unit => ({ unit, etaTicks: etas.get(unit.id)! })),
      threat?.horizonTicks ?? situation.horizonTicks,
      group => assessAllocatedForce(situation.owner, group, { metric: 'field-strength', requiredForce: total.requiredForce }).force);
    const force: ForceQuotation | null = evacuation ? null : { metric: 'field-strength', target: objective.target,
      onStationUnitIds: stationed, enRouteUnitIds: enRoute, unavailableUnitIds: unavailable, unknownUnitIds: unknown,
      onStationForce: weighted.onStationForce, effectiveForce: weighted.effectiveForce, discountedEnRouteForce: weighted.discountedEnRouteForce,
      requiredForce: total.requiredForce, evaluationUntilTick: situation.tick + situation.horizonTicks };
    if (!evacuation && weighted.effectiveForce < total.requiredForce) missing ??= 'insufficient-timely-defense-force';
    const site = situation.assets.find(asset => asset.id === targetId);
    if (threat && latest > siteCollapseAfter(snapshot, threat, site?.hp ?? 0)) missing ??= 'response-arrives-after-site-collapse';
    if (evacuation && (!at || !cohort.length)) missing ??= at ? 'no-granted-evacuees' : 'no-reachable-evacuation-shelter';
    const utilityBase = objective.conditionalQuote?.potentialUtility ?? objective.utility;
    const benefit = evacuation ? [{ code: 'workers-saved', value: cohort.length * UNIT_DEFS.worker.cost }]
      : utilityBase.benefit.map(term => ({ code: term.code, value: term.value }));
    const cost = [...utilityBase.cost.filter(term => term.code !== 'force-time' && term.code !== 'new-transport').map(term => ({ code: term.code, value: term.value })),
      { code: 'force-time', value: forceTimeGold(total.force, latest) },
      ...method.spends.filter(spend => spend.includedUtilityTermCodes.includes('new-transport')).map(spend => ({ code: 'new-transport',
        value: Math.max(0, spend.amountGold - input.budgets.filter(budget => budget.spendId === spend.spendId)
          .reduce((paid, budget) => Math.max(paid, budget.paidGold), 0)) }))];
    const probability = evacuation ? 1 : forceSuccessProbability(weighted.effectiveForce + coverForce, demand / 1.25);
    const utility: AllocationUtility = { horizonTicks: utilityBase.horizonTicks, benefit, cost,
      successProbability: probability, persistenceBonus: utilityBase.persistenceBonus,
      score: probability * benefit.reduce((sum, term) => sum + term.value, 0)
        - cost.reduce((sum, term) => sum + term.value, 0) + utilityBase.persistenceBonus };
    const why = reason(missing ?? 'allocated-defense-cohort-feasible', [...requested], { requiredForce: total.requiredForce,
      availableForce: weighted.effectiveForce, latestArrivalTicks: latest });
    return missing ? { methodId: method.id, status: 'blocked', force, utility: null, potentialUtility: utility,
      reason: why, missingPreconditions: [{ id: `${method.id}/${missing}`, kind: missing.includes('force') ? 'force' : 'route',
        status: unknown.length ? 'unknown' : 'unmet', reason: why, demand: method.demands[0] ?? null, subgoalIds: [] }] }
      : { methodId: method.id, status: 'feasible', force, utility, potentialUtility: null, missingPreconditions: [], reason: why };
  },
};
