import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { distance } from '../policy/spatial';
import { creepForce } from '../policy/v7/creep';
import { assessAllocatedCampBattle, assessAllocatedForce, assessPostBattleSiteRisk, targetEnemyReinforcements } from './allocated-force';
import type { AllocationMethodQuoteInput } from './allocation-types';
import { assessDefenseResponse } from './defense-response';
import { miningCapacity } from './mining-capacity';
import { forecastMiningWorkforce } from './mining-forecast';
import { landIdAt } from './regions';
import { allocatedMemberArrival } from './planned-voyage-arrival';
import { valuationWindow } from './utility';

export function conquestHallAt(input: Pick<AllocationMethodQuoteInput, 'snapshot' | 'situation' | 'objective'>) {
  return input.snapshot.buildings.find(building => building.owner === input.situation.owner && building.hp > 0 && building.kind === 'townHall'
    && landIdAt(input.snapshot.map, building) === input.objective.target.landId && distance(building, input.objective.target.point) <= GOLD_MINE_RULES.baseRange);
}

/** One current-epoch first fight, construction and economic timeline for both
 * materialization and quoting. The comparison window never moves this method's
 * own completion ETA. No transport, worker or fight outcome is fabricated. */
export function conquestFacts(input: AllocationMethodQuoteInput) {
  const { snapshot, situation, objective, method } = input, selected = new Set(input.unitIds);
  const members = snapshot.units.filter(unit => selected.has(unit.id) && unit.owner === situation.owner && unit.hp > 0);
  const fighters = members.filter(unit => unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0 && unit.expiresTick === undefined);
  const workers = members.filter(unit => unit.kind === 'worker'), hall = conquestHallAt(input);
  const facts = new Map(situation.units.map(unit => [unit.id, unit]));
  const onStation = new Set<string>(), arrivals = new Map<string, number>();
  const unknown: { code: string; ids: readonly string[] }[] = [];
  for (const unit of [...fighters, ...workers]) {
    const fact = facts.get(unit.id);
    const here = fact?.location.kind === 'land' && fact.location.landId === objective.target.landId
      && distance(unit, objective.target.point) <= (unit.kind === 'worker' ? GOLD_MINE_RULES.baseRange : 240);
    if (here) { onStation.add(unit.id); arrivals.set(unit.id, 0); continue; }
    const arrival = allocatedMemberArrival(input, unit, objective.target, objective.target.entityId ?? '');
    if (!arrival || !('ticks' in arrival)) { unknown.push({ code: arrival?.status === 'unreachable' ? 'conquest-member-route-unreachable' : 'conquest-member-route-unknown', ids: [unit.id] }); continue; }
    if (arrival.status === 'conditional' && !method.voyagePlans?.some(voyage => voyage.unitIds.includes(unit.id)))
      unknown.push({ code: 'conquest-member-transport-unmaterialized', ids: [unit.id] });
    arrivals.set(unit.id, arrival.ticks);
  }
  const clear = input.executions.find(execution => execution.methodId === method.id && execution.intent.kind === 'clear-camp');
  const cleared = clear?.status === 'complete';
  if (cleared && clear.intent.kind === 'clear-camp' && snapshot.units.some(unit => unit.hp > 0 && clear.intent.kind === 'clear-camp'
    && clear.intent.memberIds.includes(unit.id))) unknown.push({ code: 'completed-clearing-disagrees-with-world', ids: [clear.token.actionId] });
  const latestArrivalTicks = Math.max(0, ...fighters.map(unit => arrivals.get(unit.id) ?? 0),
    fighters.some(unit => !onStation.has(unit.id)) ? method.estimatedTicks ?? 0 : 0);
  const battle = assessAllocatedCampBattle({ snapshot, situation, target: objective.target,
    unitIds: fighters.map(unit => unit.id), battleStartTicks: latestArrivalTicks + 2 * SIM_TICKS_PER_SECOND });
  if (!cleared && battle.status !== 'known') unknown.push({ code: battle.reasonCode, ids: battle.engagement.unknownEnemyIds });
  const clearingUntilTicks = cleared ? 0 : battle.battleUntilTicks;
  // build-hall uses the first physically granted worker; quote the same one.
  const engineer = workers[0];
  if (!engineer) unknown.push({ code: 'no-allocated-construction-worker', ids: [] });
  const engineerArrivalTicks = engineer ? arrivals.get(engineer.id) ?? 0 : 0;
  const paid = (spendId: string) => Math.max(0, ...input.budgets.filter(budget => budget.spendId === spendId).map(budget => budget.paidGold));
  const transportCapital = method.spends.filter(spend => spend.includedUtilityTermCodes.includes('new-transport'))
    .reduce((sum, spend) => sum + Math.max(0, spend.amountGold - paid(spend.spendId)), 0);
  const hallCapital = hall ? 0 : Math.max(0, BUILDING_DEFS.townHall.cost - paid(`${objective.id}/hall-capital`));
  const netCapitalCash = situation.economy.cashGold - transportCapital - hallCapital;
  const currentIncome = situation.assets.filter(asset => asset.kind === 'mine' && asset.owner === situation.owner)
    .reduce((sum, asset) => sum + asset.incomeGoldPerTick, 0);
  const fundingTicks = netCapitalCash >= 0 ? 0 : currentIncome > 0 ? Math.ceil(-netCapitalCash / currentIncome) : null;
  if (fundingTicks === null) unknown.push({ code: 'hall-capital-income-unavailable', ids: [] });
  const buildTicks = hall?.complete ? 0 : hall ? Math.max(0, hall.buildTime - hall.buildProgress) : BUILDING_DEFS.townHall.buildTime;
  const hallReadyTicks = Math.max(clearingUntilTicks, engineerArrivalTicks, fundingTicks ?? 0) + buildTicks;
  const window = valuationWindow(hallReadyTicks, input.valuation);
  const survivingPermanentCampForce = cleared ? assessAllocatedForce(situation.owner, fighters,
    { metric: 'camp-force', camp: { center: objective.target.point, creeps: [], strength: 0, reach: 0 } }).force
    : battle.attrition.survivingCampForce;
  const post = { snapshot, situation, target: objective.target,
    battleStartTicks: hallReadyTicks, windowTicks: Math.max(1, window.horizonTicks - hallReadyTicks),
    excludedEnemyIds: cleared ? [] : battle.engagement.memberIds, survivingPermanentCampForce,
    plannedAssetRadius: BUILDING_DEFS.townHall.radius };
  const reinforcements = targetEnemyReinforcements(post), resolved = new Set(post.excludedEnemyIds);
  const response = assessDefenseResponse({ snapshot, situation, target: objective.target,
    arrivalTargetId: objective.target.entityId ?? objective.id, metric: 'camp-force',
    plannedAssetRadius: BUILDING_DEFS.townHall.radius, windowTicks: window.horizonTicks,
    eligibleUnitIds: situation.units.filter(unit => unit.owner === situation.owner && !unit.commitments.length).map(unit => unit.id),
    excludedUnitIds: [...input.unitIds, ...(input.valuation?.unavailableUnitIds ?? [])],
    actualMobileOpponentForce: creepForce([...reinforcements.onStation, ...reinforcements.arriving.map(entry => entry.unit)]
      .filter(unit => !resolved.has(unit.id))) });
  const siteRisk = assessPostBattleSiteRisk({ ...post, response: response.response });
  if (siteRisk.status === 'unknown') unknown.push({ code: 'post-clearing-site-risk-unknown', ids: siteRisk.unknownEnemyIds });
  const mineId = objective.target.entityId ?? '';
  const capacity = situation.assets.find(asset => asset.id === mineId)?.miningCapacity ?? miningCapacity(
    snapshot.units.filter(unit => unit.owner === situation.owner && unit.hp > 0 && unit.order.type === 'mine' && unit.order.resourceId === mineId)
      .map(unit => unit.id));
  const forecast = forecastMiningWorkforce({ snapshot, situation, mineId, engineerId: engineer?.id ?? null, hallReadyTicks, window,
    availableGold: netCapitalCash, explicitWorkerIds: workers.map(unit => unit.id), allowedUnitIds: input.unitIds,
    ...(input.valuation?.unavailableUnitIds ? { unavailableUnitIds: input.valuation.unavailableUnitIds } : {}),
    ...(input.valuation?.allowedProduction ? { allowedProduction: input.valuation.allowedProduction } : {}),
    ...(input.valuation?.unavailableProduction ? { unavailableProduction: input.valuation.unavailableProduction } : {}), capacity });
  if (forecast.status === 'unknown' || forecast.incomeGold === null) unknown.push({ code: 'mining-workforce-income-unknown', ids: [mineId] });
  return { members, fighters, workers, hall, onStation, arrivals, unknown, latestArrivalTicks, battle, cleared,
    clearingUntilTicks, engineerArrivalTicks, transportCapital, hallCapital, netCapitalCash, fundingTicks,
    hallReadyTicks, window, survivingPermanentCampForce, response, siteRisk, forecast };
}
