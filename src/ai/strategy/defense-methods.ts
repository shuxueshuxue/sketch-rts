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
  quote(input): MethodAllocationQuote {
    const { snapshot, situation, objective, method, unitIds } = input;
    const requested = new Set(unitIds), selected = snapshot.units.filter(unit => requested.has(unit.id)
      && unit.owner === situation.owner && unit.hp > 0);
    const targetId = objective.target.entityId ?? objective.id;
    const facts = new Map(situation.units.filter(unit => requested.has(unit.id)).map(unit => [unit.id, unit]));
    const evacuation = method.kind === 'evacuation';
    const at = evacuation ? shelter(snapshot, situation, objective) : objective.target;
    let missing: string | undefined;
    const unavailable: string[] = [], unknown: string[] = [], stationed: string[] = [], enRoute: string[] = [];
    let latest = 0;
    for (const unit of selected) {
      const fact = facts.get(unit.id), arrival = fact && unitArrival(fact, evacuation ? at?.entityId ?? '' : targetId);
      const sameLand = fact?.location.kind === 'land' && fact.location.landId === objective.target.landId;
      if (!fact || (!evacuation && (fact.roles.includes('worker') || fact.roles.includes('transport') || fact.roles.includes('warship')))
        || (evacuation && unit.kind !== 'worker')) { unavailable.push(unit.id); continue; }
      if (!evacuation && method.kind !== 'cross-sea-reinforcement' && !sameLand) { unavailable.push(unit.id); continue; }
      if (!evacuation && method.kind === 'local-squad' && distance(unit, objective.target.point) > 650) { unavailable.push(unit.id); continue; }
      if (sameLand && distance(unit, method.actions.at(-1)!.target.point) <= 240 && !evacuation) { stationed.push(unit.id); continue; }
      if (!arrival || arrival.status === 'unknown') { unknown.push(unit.id); continue; }
      if (!('ticks' in arrival)) { unavailable.push(unit.id); continue; }
      if (arrival.status === 'conditional') missing = 'response-route-prerequisites-unmet';
      latest = Math.max(latest, arrival.ticks); enRoute.push(unit.id);
    }
    if (selected.length !== requested.size) missing = 'allocated-unit-no-longer-present';
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
    const here = assessAllocatedForce(situation.owner, cohort.filter(unit => stationed.includes(unit.id)), { metric: 'field-strength', requiredForce: total.requiredForce });
    const force: ForceQuotation | null = evacuation ? null : { metric: 'field-strength', target: objective.target,
      onStationUnitIds: stationed, enRouteUnitIds: enRoute, unavailableUnitIds: unavailable, unknownUnitIds: unknown,
      onStationForce: here.force, effectiveForce: total.force, discountedEnRouteForce: total.force - here.force,
      requiredForce: total.requiredForce, evaluationUntilTick: situation.tick + situation.horizonTicks };
    if (!evacuation && !total.sufficient) missing ??= 'insufficient-defense-force';
    const threat = threatAt(situation, objective), site = situation.assets.find(asset => asset.id === targetId);
    if (threat && latest > siteCollapseAfter(snapshot, threat, site?.hp ?? 0)) missing ??= 'response-arrives-after-site-collapse';
    if (evacuation && (!at || !cohort.length)) missing ??= at ? 'no-granted-evacuees' : 'no-reachable-evacuation-shelter';
    const utilityBase = objective.conditionalQuote?.potentialUtility ?? objective.utility;
    const benefit = evacuation ? [{ code: 'workers-saved', value: cohort.length * UNIT_DEFS.worker.cost }]
      : utilityBase.benefit.map(term => ({ code: term.code, value: term.value }));
    const cost = [...utilityBase.cost.filter(term => term.code !== 'force-time').map(term => ({ code: term.code, value: term.value })),
      { code: 'force-time', value: forceTimeGold(total.force, latest) }];
    const probability = evacuation ? 1 : forceSuccessProbability(total.force + coverForce, demand / 1.25);
    const utility: AllocationUtility = { horizonTicks: utilityBase.horizonTicks, benefit, cost,
      successProbability: probability, persistenceBonus: utilityBase.persistenceBonus,
      score: probability * benefit.reduce((sum, term) => sum + term.value, 0)
        - cost.reduce((sum, term) => sum + term.value, 0) + utilityBase.persistenceBonus };
    const why = reason(missing ?? 'allocated-defense-cohort-feasible', [...requested], { requiredForce: total.requiredForce,
      availableForce: total.force, latestArrivalTicks: latest });
    return missing ? { methodId: method.id, status: 'blocked', force, utility: null, potentialUtility: utility,
      reason: why, missingPreconditions: [{ id: `${method.id}/${missing}`, kind: missing.includes('force') ? 'force' : 'route',
        status: unknown.length ? 'unknown' : 'unmet', reason: why, demand: method.demands[0] ?? null, subgoalIds: [] }] }
      : { methodId: method.id, status: 'feasible', force, utility, potentialUtility: null, missingPreconditions: [], reason: why };
  },
};
