import { UNIT_DEFS } from '../../shared/catalog';
import { strikeGap } from '../../shared/combat-geometry';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { averagePoint, distance } from '../policy/spatial';
import { assessAllocatedDefenseBattle, assessAllocatedForce } from './allocated-force';
import { assessDefenseResponse } from './defense-response';
import { allocatedVoyageValue, voyageCostAfterPreservedAssets } from './allocated-voyage-value';
import { defenseProtectionValue, defenseThreatScenarios } from './defense-risk';
import type { AllocationMethodProvider, AllocationReason, AllocationUtility, ExecutableMethod,
  ForceQuotation, MethodAllocationQuote } from './allocation-types';
import type { DecisionFacts } from './decision';
import { defenseCoverPost, defenseGatherPost } from './executors/defend-site';
import type { Method, Objective, ResourceDemand, Situation, Target } from './types';
import { discountedFlow, discountedValue, resolveValuation, valuationWindow } from './utility';
import { siteCollapseAfter } from './naval-objectives';
import { arrivalWeightedForce } from './arrival-force';
import { materializeVoyages } from './materialize-voyages';
import { unitMover } from '../../shared/catalog';
import { bodyMass } from '../../shared/physical-body';
import { allocatedMemberArrival } from './planned-voyage-arrival';
import { evacuationSubjectIds } from './evacuation-subjects';
import { casualtyUnitValues, sumUnitValues } from './allocated-unit-values';
import { assertUnitValueSides } from './unit-value-ledger';

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
    && asset.id !== objective.target.entityId
    && !situation.lands.flatMap(land => land.threats).some(threat => threat.siteId === asset.id
      && threat.arrivedStrength + threat.incomingStrength > threat.friendlyOnStationStrength))
    .sort((a, b) => Number(sameGround(snapshot.map, b.target.point, objective.target.point)) - Number(sameGround(snapshot.map, a.target.point, objective.target.point))
      || distance(a.target.point, objective.target.point) - distance(b.target.point, objective.target.point))[0]?.target;
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
  const subjects = evacuationSubjectIds(objective);
  const workers = subjects ? subjects.length : situation.units.filter(unit => unit.owner === situation.owner
    && unit.roles.includes('worker') && unit.location.kind === 'land' && unit.location.landId === objective.target.landId
    && distance(unit.location.point, objective.target.point) <= 650).length;
  const demands: ResourceDemand[] = kind === 'evacuation' ? [{ kind: 'workers', count: workers, at }]
    : [forceDemand(at, requiredDefense(situation, objective))];
  const travel = kind === 'cross-sea-reinforcement' || kind === 'evacuation' && destination?.landId !== undefined
    && destination.landId !== objective.target.landId ? `${id}/deliver` : undefined;
  const finish = `${id}/${kind === 'evacuation' ? 'evacuate' : 'defend'}`;
  return { id, objectiveId: objective.id, kind, providerId: 'strategy.defense-methods', preference, spends: [],
    demands, preconditions: [], subgoals: [], estimatedTicks: null, status: 'candidate', reasons: [], actions: [
      ...(travel ? [{ id: travel, executor: 'strategy.transport', intent: { kind: kind === 'evacuation' ? 'deliver-workers' as const : 'deliver-force' as const }, target: at,
        dependsOn: [], demands, spendIds: [], completionEffects: [] }] : []),
      { id: finish, executor: kind === 'evacuation' ? 'strategy.evacuate' : 'strategy.defend-site',
        intent: { kind: kind === 'evacuation' ? 'evacuate' : kind === 'wait-in-cover' ? 'wait-in-cover'
          : kind === 'main-army-recall' ? 'recall' : 'defend-site' }, target: at,
        dependsOn: travel ? [travel] : [], demands, spendIds: [],
        completionEffects: kind === 'evacuation' && objective.kind !== 'Evacuate' ? [] : objective.effects },
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
    const evacuation = input.method.kind === 'evacuation';
    const subjects = evacuation ? evacuationSubjectIds(input.objective) : undefined;
    const wanted = new Set(input.unitIds), units = input.snapshot.units.filter(unit => wanted.has(unit.id)
      && unit.owner === input.situation.owner && unit.hp > 0 && unitMover(unit.kind) === 'land'
      && (evacuation ? unit.kind === 'worker' && (!subjects || subjects.includes(unit.id)) : unit.kind !== 'worker'));
    if (input.method.kind !== 'cross-sea-reinforcement' && (!evacuation || !input.method.actions.some(action => action.executor === 'strategy.transport')))
      return { ...input.method, actions: input.method.actions.map(action => ({ ...action, unitIds: units.map(unit => unit.id) })) };
    const defend = input.method.actions.at(-1)!;
    const travel = input.method.actions.find(action => action.executor === 'strategy.transport') ?? {
      id: `${input.method.id}/deliver`, executor: 'strategy.transport', intent: { kind: 'deliver-force' as const }, target: defend.target,
      demands: input.method.demands, dependsOn: [], spendIds: [], completionEffects: [] };
    // A previous local bundle may have removed its unnecessary delivery step.
    // Rebuild the candidate skeleton before specializing the current bundle.
    const voyageInput = input.method.actions.some(action => action.id === travel.id) ? input
      : { ...input, method: { ...input.method, actions: [travel, ...input.method.actions] } };
    const plan = materializeVoyages(voyageInput, travel.id, units.map(unit => unit.id));
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
    const subjects = evacuation ? evacuationSubjectIds(objective) : undefined;
    const chosenShelter = method.actions.at(-1)!.target;
    const at = evacuation ? snapshot.buildings.some(building => building.id === chosenShelter.entityId && building.owner === situation.owner
      && building.hp > 0 && building.complete && building.id !== objective.target.entityId) ? chosenShelter : undefined : objective.target;
    let missing: string | undefined;
    const unavailable: string[] = [], unknown: string[] = [], stationed: string[] = [], enRoute: string[] = [];
    const etas = new Map<string, number>();
    let latest = 0;
    for (const unit of selected) {
      const fact = facts.get(unit.id), arrival = allocatedMemberArrival(input, unit, method.actions.at(-1)!.target, responseId);
      if (method.voyagePlans?.length && fact?.roles.includes('transport')) continue;
      const sameLand = fact?.location.kind === 'land' && fact.location.landId === objective.target.landId;
      if (!fact || (!evacuation && (fact.roles.includes('worker') || fact.roles.includes('transport') || fact.roles.includes('warship')))
        || (evacuation && (unit.kind !== 'worker' || subjects && !subjects.includes(unit.id)))) { unavailable.push(unit.id); continue; }
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
    if (subjects?.some(id => !selected.some(unit => unit.id === id && unit.kind === 'worker')))
      missing = 'evacuation-subject-not-granted';
    const threatWindow = threat?.horizonTicks ?? situation.horizonTicks;
    const opponentUnknown: string[] = [], opponentEta = new Map<string, number>(), coverage = new Map<string, number>();
    const opponentStrength = new Map((threat?.attackers ?? []).map(attacker => [attacker.unitId, attacker.strength]));
    const opponents = (threat?.attackers ?? []).flatMap(attacker => {
      const unit = snapshot.units.find(unit => unit.id === attacker.unitId && unit.hp > 0);
      if (!unit || unit.expiresTick !== undefined && unit.expiresTick <= snapshot.tick) return [];
      const arrival = attacker.arrival;
      if (!('ticks' in arrival) || arrival.crossings.some(crossing => crossing.requiresNewShip)) { opponentUnknown.push(unit.id); return []; }
      if (arrival.ticks >= threatWindow) return [];
      const available = Math.min(threatWindow, (unit.expiresTick ?? Infinity) - snapshot.tick) - arrival.ticks;
      if (available <= 0) return [];
      opponentEta.set(unit.id, arrival.ticks); coverage.set(unit.id, available / (threatWindow - arrival.ticks)); return [unit];
    });
    const enemyWeighted = arrivalWeightedForce(opponents.filter(unit => opponentEta.get(unit.id) === 0),
      opponents.filter(unit => opponentEta.get(unit.id)! > 0).map(unit => ({ unit, etaTicks: opponentEta.get(unit.id)! })), threatWindow,
      group => group.reduce((sum, unit) => sum + opponentStrength.get(unit.id)! * coverage.get(unit.id)!, 0));
    const site = situation.assets.find(asset => asset.id === targetId);
    const response = assessDefenseResponse({ snapshot, situation, target: method.actions.at(-1)!.target, arrivalTargetId: responseId,
      eligibleUnitIds: input.responseEligibleUnitIds
        ?? situation.units.filter(unit => unit.owner === situation.owner && !unit.commitments.length).map(unit => unit.id),
      excludedUnitIds: [...unitIds, ...(input.valuation?.unavailableUnitIds ?? [])],
      actualMobileOpponentForce: enemyWeighted.effectiveForce, windowTicks: threatWindow });
    // Arrival and finite summon life are priced before the mutually exclusive
    // army scenarios. A redirect probability is never multiplied into a unit.
    const scopedThreat = threat ? { ...threat, attackers: threat.attackers.filter(attacker => coverage.has(attacker.unitId)).map(attacker => ({ ...attacker,
      strength: attacker.strength * coverage.get(attacker.unitId)! / (1 + opponentEta.get(attacker.unitId)! / threatWindow) })) }
      : { siteId: targetId, horizonTicks: threatWindow, attackers: [], arrivedStrength: 0, incomingStrength: 0,
        friendlyOnStationStrength: 0, firstArrivalTicks: null, lossProbability: 0 };
    const mobileScenarios = defenseThreatScenarios(scopedThreat, response.response);
    const scenarios = mobileScenarios.status === 'unknown' ? mobileScenarios
      : { ...mobileScenarios, scenarios: mobileScenarios.scenarios.map(scenario => ({ ...scenario,
        force: scenario.force + response.hostileStaticForce })) };
    const actualOpposition = Math.max(response.hostileStaticForce, ...scenarios.scenarios.map(scenario => scenario.force));
    if (!evacuation && scenarios.status === 'unknown') missing ??= scenarios.reasonCode;
    const hostileTowers = snapshot.buildings.filter(tower => response.hostileTowerIds.includes(tower.id));
    const minimum = objective.effects.find(effect => effect.kind === 'force-present');
    // One departure margin. Success probability below sees actual opposition.
    const demand = Math.max(minimum?.kind === 'force-present' ? minimum.minimumStrength : 1, actualOpposition * 1.25);
    if (!evacuation && opponentUnknown.length) missing = 'defense-opposition-arrival-unknown';
    const covering = snapshot.buildings.filter(tower => tower.owner === situation.owner
      && tower.complete && tower.hp > 0 && tower.attackDamage > 0
      && strikeGap(tower, method.actions.at(-1)!.target.point) + 80 <= tower.attackRange);
    const coverForce = response.staticForce;
    if (method.kind === 'wait-in-cover' && !covering.length) missing = 'no-reachable-tower-cover';
    const total = assessAllocatedForce(situation.owner, cohort, { metric: 'field-strength', requiredForce: Math.max(0, demand - coverForce) });
    const weighted = arrivalWeightedForce(cohort.filter(unit => stationed.includes(unit.id)),
      cohort.filter(unit => enRoute.includes(unit.id)).map(unit => ({ unit, etaTicks: etas.get(unit.id)! })),
      threat?.horizonTicks ?? situation.horizonTicks,
      group => assessAllocatedForce(situation.owner, group, { metric: 'field-strength', requiredForce: total.requiredForce }).force);
    const force: ForceQuotation | null = evacuation ? null : { metric: 'field-strength', target: objective.target,
      onStationUnitIds: stationed, enRouteUnitIds: enRoute, unavailableUnitIds: unavailable, unknownUnitIds: unknown,
      onStationForce: weighted.onStationForce, effectiveForce: weighted.effectiveForce, discountedEnRouteForce: weighted.discountedEnRouteForce,
      requiredForce: total.requiredForce, evaluationUntilTick: situation.tick + threatWindow };
    if (!evacuation && weighted.effectiveForce < total.requiredForce) missing ??= 'insufficient-timely-defense-force';
    if (!evacuation && threat && latest > siteCollapseAfter(snapshot, threat, site?.hp ?? 0) && weighted.effectiveForce < total.requiredForce)
      missing ??= 'response-arrives-after-site-collapse';
    if (evacuation && (!at || !cohort.length)) missing ??= at ? 'no-granted-evacuees' : 'no-reachable-evacuation-shelter';
    const duration = Math.max(latest, ...objective.effects.flatMap(effect => effect.kind === 'site-safe' || effect.kind === 'force-present'
      ? [Math.max(0, effect.throughTick - situation.tick)] : []));
    const window = valuationWindow(duration, input.valuation), valuation = resolveValuation({ objectiveId: objective.id,
      methodId: method.id, unitIds, window }, input.valuation);
    const opportunity = valuation.opportunity;
    if (valuation.phase === 'net' && opportunity?.status !== 'known') missing ??= 'committed-opportunity-cost-unknown';
    // No ungranted army is promised as a defending garrison. Existing static
    // cover is the counterfactual protection if this cohort is sent elsewhere.
    const assets = situation.assets.filter(asset => asset.target.landId === objective.target.landId
      && distance(asset.target.point, objective.target.point) <= 650
      && (asset.owner === situation.owner || site?.kind === 'hall' && asset.kind === 'mine'));
    const atRisk = assets.reduce((sum, asset) => sum + (asset.kind === 'mine'
      ? discountedFlow({ goldPerTick: asset.incomeGoldPerTick, remainingGold: asset.remainingGold, startsInTicks: 0, window })
      : discountedValue(asset.replacementGold, latest, window)), 0);
    const protection = defenseProtectionValue({ threat: scenarios, assetValueGold: atRisk,
      cohortForce: weighted.effectiveForce, staticForce: coverForce });
    const noArrivalProtection = defenseProtectionValue({ threat: scenarios, assetValueGold: atRisk,
      cohortForce: weighted.onStationForce, staticForce: coverForce });
    const voyages = allocatedVoyageValue(input);
    if (voyages.unknown.length) missing ??= voyages.unknown[0]!.code;
    const transitSurvival = [...voyages.actions.values()].reduce((p, wave) => p * wave.survivalProbability, 1);
    const savedUnitValues = evacuation ? cohort.map(unit => ({ unitId: unit.id, valueGold: discountedValue(UNIT_DEFS.worker.cost, latest, window) })) : [];
    const benefit = evacuation ? [{ code: 'workers-saved', value: savedUnitValues.reduce((sum, entry) => sum + entry.valueGold, 0), catalogUnitValues: savedUnitValues }]
      : [{ code: 'protected-assets', value: protection?.benefitGold ?? 0, catalogUnitValues: assets.filter(asset => asset.kind === 'worker')
        .map(asset => ({ unitId: asset.id, valueGold: discountedValue(asset.replacementGold, latest, window) })) }];
    const preserved = new Set(benefit.flatMap(term => term.catalogUnitValues.map(entry => entry.unitId)));
    const combatUnitValues: { unitId: string; valueGold: number }[][] = [];
    const combatLoss = (party: typeof cohort, branchProbability: number) => scenarios.scenarios.reduce((sum, scenario) => {
      const battle = assessAllocatedDefenseBattle({ snapshot, units: party,
        opponents: opponents.filter(unit => scenario.unitIds.includes(unit.id)).map(unit => ({ unit, share: coverage.get(unit.id)! })),
        towers: hostileTowers, windowTicks: threatWindow });
      combatUnitValues.push(casualtyUnitValues(party, battle.casualties.permanentDeadUnitIds).map(entry => ({ ...entry,
        valueGold: discountedValue(entry.valueGold * branchProbability * scenario.probability, latest, window) })));
      return sum + scenario.probability * battle.casualties.expectedLossGold;
    }, 0);
    const combatGold = evacuation ? 0 : transitSurvival * combatLoss(cohort, transitSurvival)
      + (1 - transitSurvival) * combatLoss(cohort.filter(unit => stationed.includes(unit.id)), 1 - transitSurvival);
    const voyageCost = voyageCostAfterPreservedAssets([...voyages.actions.values()], preserved);
    const voyageUnitValues = voyageCost.catalogUnitValues.map(entry => ({ ...entry, valueGold: discountedValue(entry.valueGold, latest, window) }));
    const cost = [...(evacuation ? [] : [{ code: 'static-protection-baseline', value: protection?.staticBaselineGold ?? 0 }]),
      { code: 'combat-attrition', value: discountedValue(combatGold, latest, window), catalogUnitValues: sumUnitValues(combatUnitValues) },
      { code: 'voyage-hull-and-passengers', value: discountedValue(voyageCost.expectedLossGold, latest, window), catalogUnitValues: voyageUnitValues },
      ...(opportunity?.status === 'known' ? [{ code: 'bundle-opportunity', value: opportunity.gold }] : [])];
    // Rescued assets are additive: another hull sinking does not erase a
    // person who reaches refuge. A shore waiter needs both approach and loaded
    // legs to succeed, whereas a person already at refuge has arrived for sure.
    const expectedSavedGold = savedUnitValues.reduce((sum, entry) => sum + entry.valueGold
      * (stationed.includes(entry.unitId) ? 1 : voyages.passengerArrivalProbabilities.get(entry.unitId) ?? 1), 0);
    const savedValueGold = savedUnitValues.reduce((sum, entry) => sum + entry.valueGold, 0);
    const probability = evacuation ? savedValueGold ? expectedSavedGold / savedValueGold : 0
      : transitSurvival * (protection?.successProbability ?? 0) + (1 - transitSurvival) * (noArrivalProtection?.successProbability ?? 0);
    const persistenceBonus = objective.utility.persistenceBonus;
    const utility: AllocationUtility = { horizonTicks: window.horizonTicks, benefit, cost,
      successProbability: probability, persistenceBonus,
      score: probability * benefit.reduce((sum, term) => sum + term.value, 0)
        - cost.reduce((sum, term) => sum + term.value, 0) + persistenceBonus };
    assertUnitValueSides(utility);
    const why = reason(missing ?? 'allocated-defense-cohort-feasible', [...requested], { requiredForce: total.requiredForce,
      availableForce: weighted.effectiveForce, actualOpposition, successProbability: probability,
      staticProtection: protection && protection.benefitGold > 0 ? protection.staticBaselineGold / protection.benefitGold : 0,
      actualIntrusionCount: scenarios.actualIds.length, potentialRedirectCount: scenarios.redirects.length,
      transitSurvival,
      otherResponseTicks: response.response.status === 'known' ? response.response.ticks : null,
      latestArrivalTicks: latest, opponentUnknown: opponentUnknown.length });
    return missing ? { methodId: method.id, status: 'blocked', force, valuation, utility: null, potentialUtility: null,
      reason: why, missingPreconditions: [{ id: `${method.id}/${missing}`,
        kind: missing === 'evacuation-subject-not-granted' ? 'workers' : missing.includes('force') ? 'force' : 'route',
        status: missing.includes('unknown') ? 'unknown' : 'unmet', reason: why, demand: method.demands[0] ?? null, subgoalIds: [] }] }
      : { methodId: method.id, status: 'feasible', force, valuation, utility, potentialUtility: null, missingPreconditions: [], reason: why };
  },
};
