import type { AllocationReason, AllocationUtility } from './allocation-types';
import type { AssemblyDelayLossValue, AssemblyDelayPathValue, AssemblyReadyTime } from './assembly-delay-loss';
import { valueConquestContinuation, type ConquestContinuationInput } from './conquest-value';
import { ASSEMBLY_SCENARIO_LIMIT } from './force-assembly-forecast';
import type { ValuationWindow } from './types';
import { sameValuationWindow, valuationWindow } from './utility';

export type AssemblyCohortLossScenario = Readonly<{
  pathId: string; probability: number; before: AssemblyReadyTime; after: AssemblyReadyTime;
  beforeSettlement: ConquestContinuationInput | null; afterSettlement: ConquestContinuationInput | null;
}>;
export type AssemblyCohortPathValue = AssemblyDelayPathValue & Readonly<{
  beforeContinuationGold: number | null; afterContinuationGold: number | null;
  /** Signed differences are combined before the final nonnegative loss bound. */
  signedDifferenceGold: number; weightedDifferenceGold: number;
}>;
export type AssemblyCohortLossValue = AssemblyDelayLossValue & Readonly<{ paths: readonly AssemblyCohortPathValue[] }>;
const finite = (value: number) => Number.isFinite(value) && value >= 0;
const reason = (code: string, factIds: readonly string[], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });

/** Revalue the two actual cohorts with the shared conquest settlement. Readiness
 * alone does not establish equal battle probability, casualties or income.
 * This function requests no physical facts: unresolved monetary paths use only
 * their own probability mass of the independently proved same-window cap. */
export function valueAssemblyCohortLoss(input: Readonly<{
  forecastTick: number; window: ValuationWindow; valueCapGold: number | null; capFactIds?: readonly string[];
  scenarios: readonly AssemblyCohortLossScenario[];
}>): AssemblyCohortLossValue {
  const window = { ...input.window }, cap = input.valueCapGold === 0 ? 0 : input.valueCapGold;
  const capIds = [...new Set(input.capFactIds ?? [])].sort();
  const unknown = (code: string): AssemblyCohortLossValue => ({ status: 'unknown', window, valueCapGold: cap,
    lossUpperGold: null, uncappedLossUpperGold: null, paths: [], components: [], reason: reason(code, capIds) });
  if (cap === null || !finite(cap)) return unknown('assembly-delay-value-cap-unquoted');
  try { valuationWindow(window.taskTicks, { phase: 'gross', window }); }
  catch { return unknown('assembly-delay-window-invalid'); }
  const fullCap = (code: string): AssemblyCohortLossValue => ({ status: 'known', window, valueCapGold: cap,
    lossUpperGold: cap, uncappedLossUpperGold: cap, paths: [],
    components: [{ code, pathId: null, valueGold: cap, factIds: capIds }],
    reason: reason(code, capIds, { valueCapGold: cap, fallbackProbability: 1 }) });
  if (!finite(input.forecastTick)) return fullCap('assembly-cohort-epoch-unquoted');
  if (!input.scenarios.length) return fullCap('assembly-cohort-scenarios-unquoted');
  if (input.scenarios.length > ASSEMBLY_SCENARIO_LIMIT) return fullCap('assembly-cohort-scenario-limit');
  const scenarios = [...input.scenarios].sort((a, b) => a.pathId < b.pathId ? -1 : a.pathId > b.pathId ? 1 : 0);
  if (new Set(scenarios.map(path => path.pathId)).size !== scenarios.length
    || scenarios.some(path => !path.pathId || !finite(path.probability) || path.probability > 1)
    || Math.abs(scenarios.reduce((sum, path) => sum + path.probability, 0) - 1) > 1e-9)
    return fullCap('assembly-cohort-scenarios-invalid');

  const settle = (ready: AssemblyReadyTime, settlement: ConquestContinuationInput | null):
    { utility: AllocationUtility; mineId: string | null } | { missing: string } => {
    if (ready.status === 'not-filled') return { utility: { horizonTicks: window.horizonTicks,
      benefit: [], cost: [], persistenceBonus: 0, successProbability: 1, score: 0 }, mineId: null };
    if (ready.status !== 'ready') return { missing: 'unquoted' };
    if (!finite(ready.tick) || ready.tick < input.forecastTick) return { missing: 'stale' };
    if (!settlement) return { missing: 'settlement-unquoted' };
    if ((settlement.delayTicks ?? 0) !== ready.tick - input.forecastTick) return { missing: 'settlement-epoch-mismatch' };
    if (!sameValuationWindow(settlement.window ?? settlement.facts.window, window)) return { missing: 'settlement-window-mismatch' };
    const { facts, voyages } = settlement;
    // Optional additional workforce can be unknown while the existing staffed
    // curve is known. Require the actual money/physical inputs, not that every
    // unused workforce option was evaluated.
    if (facts.unknown.length || voyages.status !== 'known' || voyages.unknown.length
      || facts.forecast.status !== 'estimated' || facts.forecast.incomeGold === null
      || facts.siteRisk.survivalProbability === null || !facts.cleared && facts.battle.successProbability === null)
      return { missing: 'settlement-unquoted' };
    let value: ReturnType<typeof valueConquestContinuation>;
    try { value = valueConquestContinuation({ ...settlement, window }); }
    catch { return { missing: 'settlement-invalid' }; }
    const utility = value.utility;
    if (!Number.isFinite(utility.score) || !finite(utility.persistenceBonus) || !finite(utility.successProbability)
      || utility.successProbability > 1 || !finite(value.forceSurvival) || value.forceSurvival > 1
      || !finite(value.workerSurvival) || value.workerSurvival > 1
      || value.battleProbability === null || !finite(value.battleProbability) || value.battleProbability > 1
      || value.postSurvival === null || !finite(value.postSurvival) || value.postSurvival > 1
      || [...utility.benefit, ...utility.cost].some(term => !Number.isFinite(term.value))
      || utility.cost.some(term => term.value < 0)) return { missing: 'settlement-invalid' };
    return { utility, mineId: facts.forecast.mineId };
  };
  const paths = scenarios.map((path): AssemblyCohortPathValue => {
    const factIds = [...new Set([path.pathId, ...capIds])].sort();
    const result = (basis: AssemblyDelayPathValue['basis'], code: string, difference: number,
      before: number | null, after: number | null, components: AssemblyDelayPathValue['components'] = []): AssemblyCohortPathValue => {
      const rawLoss = Math.max(0, difference);
      return { pathId: path.pathId, probability: path.probability, before: { ...path.before }, after: { ...path.after }, basis,
        beforeContinuationGold: before, afterContinuationGold: after, signedDifferenceGold: difference === 0 ? 0 : difference,
        weightedDifferenceGold: path.probability * difference, rawLossUpperGold: rawLoss,
        lossUpperGold: Math.min(cap, rawLoss), weightedLossUpperGold: path.probability * Math.min(cap, rawLoss), components,
        reason: reason(code, factIds) };
    };
    if (!path.probability) return result('no-delay', 'assembly-cohort-zero-probability', 0, null, null);
    const before = settle(path.before, path.beforeSettlement), after = settle(path.after, path.afterSettlement);
    if ('missing' in before || 'missing' in after) return result('full-cap',
      `assembly-cohort-${'missing' in before ? `before-${before.missing}` : `after-${'missing' in after ? after.missing : 'unquoted'}`}`,
      cap, 'missing' in before ? null : before.utility.score, 'missing' in after ? null : after.utility.score);
    const components: AssemblyDelayPathValue['components'][number][] = [];
    for (const side of ['benefit', 'cost'] as const) {
      const beforeTerms = new Map<string, { value: number; ids: Set<string> }>(), afterTerms = new Map<string, { value: number; ids: Set<string> }>();
      for (const [terms, utility] of [[beforeTerms, before.utility], [afterTerms, after.utility]] as const)
        for (const term of utility[side]) {
          const entry = terms.get(term.code) ?? { value: 0, ids: new Set<string>() };
          entry.value += term.value * (side === 'benefit' ? utility.successProbability : -1);
          for (const asset of term.catalogUnitValues ?? []) entry.ids.add(asset.unitId);
          terms.set(term.code, entry);
        }
      for (const code of [...new Set([...beforeTerms.keys(), ...afterTerms.keys()])].sort()) {
        const a = beforeTerms.get(code), b = afterTerms.get(code), beforePresentGold = a?.value ?? 0, afterPresentGold = b?.value ?? 0;
        const differenceGold = beforePresentGold - afterPresentGold;
        components.push({ code, side, beforePresentGold, afterPresentGold, differenceGold,
          lossUpperGold: Math.max(0, differenceGold), factIds: [...new Set([before.mineId, after.mineId,
            ...a?.ids ?? [], ...b?.ids ?? []].filter((id): id is string => id !== null))].sort() });
      }
    }
    const difference = before.utility.score - after.utility.score;
    components.push({ code: 'persistence', side: 'persistence', beforePresentGold: before.utility.persistenceBonus,
      afterPresentGold: after.utility.persistenceBonus, differenceGold: before.utility.persistenceBonus - after.utility.persistenceBonus,
      lossUpperGold: Math.max(0, before.utility.persistenceBonus - after.utility.persistenceBonus), factIds });
    if (!Number.isFinite(difference)) return result('full-cap', 'assembly-cohort-difference-invalid', cap,
      before.utility.score, after.utility.score);
    return result('continuation-difference', 'assembly-cohort-revalued-continuations', difference,
      before.utility.score, after.utility.score, components);
  });
  // Preserve signed gains as well as losses under the SAME joint distribution.
  // Taking positive parts per path would price a different counterfactual.
  const signed = paths.reduce((sum, path) => sum + path.weightedDifferenceGold, 0);
  if (!Number.isFinite(signed)) return fullCap('assembly-cohort-total-invalid');
  const uncappedLossUpperGold = Math.max(0, signed), lossUpperGold = Math.min(cap, uncappedLossUpperGold);
  const fallback = paths.filter(path => path.probability > 0 && path.basis === 'full-cap');
  const code = uncappedLossUpperGold > cap ? 'assembly-cohort-total-value-cap' : 'assembly-cohort-expected-continuation-loss';
  return { status: 'known', window, valueCapGold: cap, lossUpperGold, uncappedLossUpperGold, paths,
    components: [{ code, pathId: null, valueGold: lossUpperGold, factIds: [...new Set([...capIds, ...paths.map(path => path.pathId)])].sort() }],
    reason: reason(fallback.length ? 'assembly-cohort-with-cap-fallback' : 'assembly-cohort-continuation-loss', capIds,
      { valueCapGold: cap, signedDifferenceGold: signed, fallbackPaths: fallback.length,
        fallbackProbability: fallback.reduce((sum, path) => sum + path.probability, 0) }) };
}
