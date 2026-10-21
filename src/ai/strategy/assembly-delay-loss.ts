import type { AllocationReason, AllocationUtility } from './allocation-types';
import { valueConquestContinuation, type ConquestContinuationInput } from './conquest-value';
import { ASSEMBLY_SCENARIO_LIMIT } from './force-assembly-forecast';
import type { ValuationWindow } from './types';
import { sameValuationWindow, valuationWindow } from './utility';

export type AssemblyReadyTime = Readonly<{ status: 'ready'; tick: number } | { status: 'not-filled' } | { status: 'unknown' }>;
export type AssemblyDelayScenario = Readonly<{
  pathId: string; probability: number; before: AssemblyReadyTime; after: AssemblyReadyTime;
  plan: Readonly<{ readyTick: number; coverage: 'complete' | 'known-effects'; input: ConquestContinuationInput }> | null;
}>;
type CashComponent = Readonly<{ code: string; side: 'benefit' | 'cost' | 'persistence'; factIds: readonly string[];
  beforePresentGold: number; afterPresentGold: number; differenceGold: number; lossUpperGold: number }>;
export type AssemblyDelayPathValue = Readonly<{
  pathId: string; probability: number; before: AssemblyReadyTime; after: AssemblyReadyTime;
  basis: 'cash-flow-delay' | 'full-cap' | 'no-delay' | 'no-prior-fill';
  rawLossUpperGold: number; lossUpperGold: number; weightedLossUpperGold: number;
  components: readonly CashComponent[]; reason: AllocationReason;
}>;
type BoundComponent = Readonly<{ code: string; pathId: string | null; valueGold: number; factIds: readonly string[] }>;
export type AssemblyDelayLossValue = Readonly<{
  window: ValuationWindow; valueCapGold: number | null; paths: readonly AssemblyDelayPathValue[];
  components: readonly BoundComponent[]; reason: AllocationReason;
}> & (Readonly<{ status: 'known'; lossUpperGold: number; uncappedLossUpperGold: number }>
  | Readonly<{ status: 'unknown'; lossUpperGold: null; uncappedLossUpperGold: null }>);
const finite = (value: number) => Number.isFinite(value) && value >= 0;
const reason = (code: string, factIds: readonly string[] = [], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });

/** Monetary upper bound for delaying a retained assembly plan. Only raw cash
 * schedules enter valueConquestContinuation again: no integrated score is
 * discounted. The caller proves the same-window cap and supplies paired paths;
 * navigation, force forecasts, progress and switching costs belong elsewhere. */
export function valueAssemblyDelayLoss(input: Readonly<{
  forecastTick: number; window: ValuationWindow; valueCapGold: number | null; capFactIds?: readonly string[];
  scenarios: readonly AssemblyDelayScenario[];
}>): AssemblyDelayLossValue {
  const { window } = input, cap = input.valueCapGold === 0 ? 0 : input.valueCapGold, capIds = [...input.capFactIds ?? []];
  const unknown = (code: string): AssemblyDelayLossValue => ({ status: 'unknown', window: { ...window }, valueCapGold: cap,
    lossUpperGold: null, uncappedLossUpperGold: null, paths: [], components: [], reason: reason(code, capIds) });
  if (cap === null || !finite(cap)) return unknown('assembly-delay-value-cap-unquoted');
  try { valuationWindow(window.taskTicks, { phase: 'gross', window }); }
  catch { return unknown('assembly-delay-window-invalid'); }
  const fullCap = (code: string): AssemblyDelayLossValue => ({ status: 'known', window: { ...window }, valueCapGold: cap,
    lossUpperGold: cap, uncappedLossUpperGold: cap, paths: [],
    components: [{ code, pathId: null, valueGold: cap, factIds: capIds }], reason: reason(code, capIds, { valueCapGold: cap }) });
  if (!finite(input.forecastTick)) return fullCap('assembly-delay-epoch-unquoted');
  if (!input.scenarios.length) return fullCap('assembly-delay-scenarios-unquoted');
  if (input.scenarios.length > ASSEMBLY_SCENARIO_LIMIT) return fullCap('assembly-delay-scenario-limit');
  const scenarios = [...input.scenarios].sort((a, b) => a.pathId < b.pathId ? -1 : a.pathId > b.pathId ? 1 : 0);
  if (new Set(scenarios.map(path => path.pathId)).size !== scenarios.length
    || scenarios.some(path => !path.pathId || !finite(path.probability) || path.probability > 1)
    || Math.abs(scenarios.reduce((sum, path) => sum + path.probability, 0) - 1) > 1e-9)
    return fullCap('assembly-delay-scenarios-invalid');
  const pathValue = (path: AssemblyDelayScenario): AssemblyDelayPathValue => {
    const result = (basis: AssemblyDelayPathValue['basis'], code: string, loss: number,
      components: readonly CashComponent[] = [], rawLoss = loss): AssemblyDelayPathValue => ({ pathId: path.pathId,
      probability: path.probability, before: { ...path.before }, after: { ...path.after }, basis,
      rawLossUpperGold: rawLoss, lossUpperGold: loss, weightedLossUpperGold: path.probability * loss,
      components, reason: reason(code, [path.pathId, ...capIds]) });
    const fallback = (code: string) => result('full-cap', code, cap);
    if (!path.probability) return result('no-delay', 'assembly-delay-zero-probability', 0);
    if (path.before.status === 'not-filled') return result('no-prior-fill', 'assembly-delay-no-prior-fill', 0);
    if (path.before.status !== 'ready') return fallback('assembly-delay-before-unquoted');
    if (!finite(path.before.tick) || path.before.tick < input.forecastTick) return fallback('assembly-delay-before-stale');
    if (path.after.status !== 'ready') return fallback(path.after.status === 'not-filled'
      ? 'assembly-delay-after-window-not-filled' : 'assembly-delay-after-unquoted');
    if (!finite(path.after.tick) || path.after.tick < input.forecastTick) return fallback('assembly-delay-after-stale');
    if (path.after.tick <= path.before.tick) return result('no-delay', 'assembly-delay-not-later', 0);
    const plan = path.plan;
    if (!plan) return fallback('assembly-delay-cash-flows-unquoted');
    if (plan.coverage !== 'complete') return fallback('assembly-delay-cash-flows-incomplete');
    if (!finite(plan.readyTick) || !sameValuationWindow(plan.input.facts.window, window)
      || plan.input.window && !sameValuationWindow(plan.input.window, window)) return fallback('assembly-delay-plan-window-mismatch');
    const facts = plan.input.facts;
    if (facts.unknown.length || plan.input.voyages.unknown.length || facts.forecast.unknown.length
      || facts.forecast.status !== 'estimated' || facts.forecast.incomeGold === null || facts.siteRisk.survivalProbability === null
      || !facts.cleared && facts.battle.successProbability === null) return fallback('assembly-delay-cash-flows-unquoted');
    const originDelay = plan.input.delayTicks ?? 0;
    const beforeDelay = originDelay + path.before.tick - plan.readyTick, afterDelay = originDelay + path.after.tick - plan.readyTick;
    if (!finite(beforeDelay) || !finite(afterDelay)) return fallback('assembly-delay-plan-epoch-mismatch');
    let before: AllocationUtility, after: AllocationUtility;
    try {
      before = valueConquestContinuation({ ...plan.input, window, delayTicks: beforeDelay }).utility;
      after = valueConquestContinuation({ ...plan.input, window, delayTicks: afterDelay }).utility;
    } catch { return fallback('assembly-delay-cash-flow-evaluation-unquoted'); }
    if ([before, after].some(value => !Number.isFinite(value.score) || !finite(value.persistenceBonus)
      || !finite(value.successProbability) || value.successProbability > 1
      || [...value.benefit, ...value.cost].some(term => !Number.isFinite(term.value))
      || value.cost.some(term => term.value < 0))) return fallback('assembly-delay-cash-flow-evaluation-unquoted');
    const components: CashComponent[] = [];
    for (const side of ['benefit', 'cost'] as const) {
      if (before[side].length !== after[side].length || before[side].some((term, i) => term.code !== after[side][i]!.code))
        return fallback('assembly-delay-cash-flow-identity-mismatch');
      before[side].forEach((term, index) => {
        const other = after[side][index]!;
        const beforeGold = term.value * (side === 'benefit' ? before.successProbability : -1);
        const afterGold = other.value * (side === 'benefit' ? after.successProbability : -1);
        const beforePresentGold = beforeGold === 0 ? 0 : beforeGold, afterPresentGold = afterGold === 0 ? 0 : afterGold;
        const differenceGold = beforePresentGold - afterPresentGold;
        components.push({ code: term.code, side, beforePresentGold, afterPresentGold, differenceGold,
          lossUpperGold: Math.max(0, differenceGold), factIds: [...new Set([facts.forecast.mineId,
            ...(term.catalogUnitValues ?? []).map(entry => entry.unitId), ...(other.catalogUnitValues ?? []).map(entry => entry.unitId)])].sort() });
      });
    }
    const persistenceDifference = before.persistenceBonus - after.persistenceBonus;
    components.push({ code: 'persistence', side: 'persistence', beforePresentGold: before.persistenceBonus,
      afterPresentGold: after.persistenceBonus, differenceGold: persistenceDifference,
      lossUpperGold: Math.max(0, persistenceDifference), factIds: [facts.forecast.mineId] });
    const rawLoss = components.reduce((sum, component) => sum + component.lossUpperGold, 0);
    if (!finite(rawLoss)) return fallback('assembly-delay-cash-flow-evaluation-unquoted');
    // Deferred payments can save gold. Ignoring that saving makes this a loss
    // upper bound; the supplied whole-plan cap remains the final ceiling.
    return result('cash-flow-delay', 'assembly-delay-reintegrated-cash-flows', Math.min(cap, rawLoss), components, rawLoss);
  };
  const paths = scenarios.map(pathValue);
  let components: BoundComponent[] = paths.map(path => ({ code: path.reason.code, pathId: path.pathId,
    valueGold: path.weightedLossUpperGold, factIds: path.reason.factIds }));
  const uncappedLossUpperGold = components.reduce((sum, component) => sum + component.valueGold, 0);
  const lossUpperGold = Math.min(cap, uncappedLossUpperGold);
  // Preserve raw path evidence. If probability-mass tolerance crosses the cap,
  // use its own proof component instead of inventing fractional adjustments.
  if (uncappedLossUpperGold > cap) components = [{ code: 'assembly-delay-total-value-cap', pathId: null, valueGold: cap, factIds: capIds }];
  return { status: 'known', window: { ...window }, valueCapGold: cap, lossUpperGold, uncappedLossUpperGold, paths, components,
    reason: reason(paths.some(path => path.basis === 'full-cap') ? 'assembly-delay-with-cap-fallback' : 'assembly-delay-cash-flow-upper-bound', capIds,
      { valueCapGold: cap, fallbackPaths: paths.filter(path => path.basis === 'full-cap').length }) };
}
