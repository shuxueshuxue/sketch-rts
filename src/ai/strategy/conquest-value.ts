import type { AllocationUtility, ExecutableMethod } from './allocation-types';
import type { allocatedVoyageValue } from './allocated-voyage-value';
import { casualtyUnitValues, sumUnitValues } from './allocated-unit-values';
import type { conquestFacts } from './conquest-facts';
import { discountedMiningSegments } from './mining-forecast';
import type { CatalogUnitValue, ValuationWindow } from './types';
import { discountedValue, reusableAssetCost, sameValuationWindow } from './utility';
import { assertUnitValueSides } from './unit-value-ledger';

export type ConquestContinuationInput = Readonly<{
  facts: ReturnType<typeof conquestFacts>;
  voyages: ReturnType<typeof allocatedVoyageValue>;
  method: Pick<ExecutableMethod, 'actions'>;
  remainingOre: number;
  persistenceBonus: number;
  /** Actual entity identities from the caller's original world. Assessment
   * prototypes can contribute money, but never acquire catalogue identities. */
  realUnitIds: readonly string[];
  window?: ValuationWindow;
  /** Translate the supplied cash-flow schedule. Physical battle/route/risk
   * assumptions belong to facts/voyages and must be assessed by their caller. */
  delayTicks?: number;
}>;

/** The single gross conquest settlement. It never prices the borrowed bundle
 * or advances a forecast. Positive delay translates individual cash flows and
 * re-integrates staffed income in the same window, rather than discounting an
 * already integrated score a second time. */
export function valueConquestContinuation(input: ConquestContinuationInput) {
  const { facts, voyages, method } = input, window = input.window ?? facts.window, delay = input.delayTicks ?? 0;
  if (!Number.isFinite(delay) || delay < 0 || !Number.isFinite(input.remainingOre) || input.remainingOre < 0)
    throw new Error('Invalid conquest continuation timing/ore');
  const real = new Set(input.realUnitIds);
  const unchangedTiming = !delay && sameValuationWindow(window, facts.window);
  const identities = (entries: readonly CatalogUnitValue[]) => entries.filter(entry => real.has(entry.unitId));
  const at = (ticks: number) => ticks + delay;
  const forceWaves = [...voyages.actions.values()].filter(value => method.actions.find(action => action.id === value.actionId)?.intent.kind === 'deliver-force');
  const workerWaves = [...voyages.actions.values()].filter(value => method.actions.find(action => action.id === value.actionId)?.intent.kind === 'deliver-workers');
  const forceSurvival = forceWaves.reduce((value, wave) => value * wave.survivalProbability, 1);
  const workerSurvival = workerWaves.reduce((value, wave) => value * wave.survivalProbability, 1);
  const battleProbability = facts.cleared ? 1 : facts.battle.successProbability;
  const postSurvival = facts.siteRisk.survivalProbability;
  const hallCost = postSurvival === null ? null : reusableAssetCost({ priceGold: facts.hallCapital,
    survivalProbability: postSurvival, atTicks: at(facts.hallReadyTicks), window });
  const probability = forceSurvival * (battleProbability ?? 0) * workerSurvival;
  const income = facts.forecast.incomeGold === null ? 0 : unchangedTiming ? facts.forecast.incomeGold
    : discountedMiningSegments(facts.forecast.segments.map(segment => ({ ...segment,
      fromTicks: at(segment.fromTicks), untilTicks: at(segment.untilTicks) })), input.remainingOre, window);
  const trainingGold = unchangedTiming ? facts.forecast.presentTrainingGold
    : facts.forecast.training.reduce((sum, training) => sum + discountedValue(training.gold, at(training.startsInTicks), window), 0);
  const benefit = [
    { code: 'staffed-island-income', value: income * (postSurvival ?? 0) },
    { code: 'hall-after-clearing-net-loss', value: -(hallCost?.presentCostGold ?? 0) },
    { code: 'mining-worker-recruitment', value: -trainingGold },
  ];
  const cost = [
    { code: 'force-voyage-hull-and-passengers', value: discountedValue(forceWaves.reduce((sum, wave) => sum + wave.expectedLossGold, 0), at(facts.latestArrivalTicks), window),
      catalogUnitValues: identities(sumUnitValues(forceWaves.map(wave => wave.catalogUnitValues.map(entry => ({ ...entry,
        valueGold: discountedValue(entry.valueGold, at(facts.latestArrivalTicks), window) }))))) },
    { code: 'clearing-attrition-after-force-arrival', value: forceSurvival * discountedValue(facts.cleared ? 0 : facts.battle.attrition.expectedLossGold,
      at(facts.clearingUntilTicks), window), catalogUnitValues: facts.cleared ? []
        : identities(casualtyUnitValues(facts.fighters, facts.battle.attrition.permanentDeadUnitIds).map(entry => ({ ...entry,
          valueGold: forceSurvival * discountedValue(entry.valueGold, at(facts.clearingUntilTicks), window) }))) },
    { code: 'worker-voyage-after-clearing', value: forceSurvival * (battleProbability ?? 0) * discountedValue(
      workerWaves.reduce((sum, wave) => sum + wave.expectedLossGold, 0), at(Math.max(facts.clearingUntilTicks, facts.engineerArrivalTicks)), window),
      catalogUnitValues: identities(sumUnitValues(workerWaves.map(wave => wave.catalogUnitValues.map(entry => ({ ...entry,
        valueGold: forceSurvival * (battleProbability ?? 0) * discountedValue(entry.valueGold,
          at(Math.max(facts.clearingUntilTicks, facts.engineerArrivalTicks)), window) }))))) },
  ];
  const persistenceBonus = input.persistenceBonus;
  const utility: AllocationUtility = { horizonTicks: window.horizonTicks, benefit, cost, successProbability: probability,
    persistenceBonus, score: probability * benefit.reduce((sum, term) => sum + term.value, 0)
      - cost.reduce((sum, term) => sum + term.value, 0) + persistenceBonus };
  assertUnitValueSides(utility);
  return { utility, window, delayTicks: delay, forceSurvival, workerSurvival, battleProbability, postSurvival };
}
