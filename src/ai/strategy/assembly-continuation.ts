import type { AllocationReason, AllocationUtility } from './allocation-types';
import type { ForceAssemblyForecast } from './force-assembly-forecast';
import type { ValuationWindow } from './types';
import { sameValuationWindow, valuationWindow } from './utility';
import { assertUnitValueSides } from './unit-value-ledger';

export type AssemblyPathContinuation = Readonly<{
  pathId: string; readyTick: number; window: ValuationWindow;
  /** Gross valueConquestContinuation settlement, already delayed for this
   * particular path. null is unquoted money, never a zero-valued outcome. */
  utility: AllocationUtility | null;
  assumptions?: readonly AllocationReason[];
}>;
type Forecast = Pick<ForceAssemblyForecast, 'status' | 'forecastTick' | 'fillScenarios' | 'completionProbability'
  | 'completionProbabilityBounds' | 'diagnostics' | 'missing'>;
export type AssemblyContinuationSource = Readonly<{
  pathId: string; probability: number; conditionalWeight: number; readyTick: number | null;
  window: ValuationWindow | null; utility: AllocationUtility | null;
  /** Output indices refer to unchanged source term codes and catalogue IDs. */
  termIndices: Readonly<{ benefit: readonly number[]; cost: readonly number[] }>;
}>;
type Common = Readonly<{ window: ValuationWindow; completionProbability: number;
  completionProbabilityBounds: Readonly<{ lower: number; upper: number }>;
  basis: 'exact' | 'lower-bound'; sources: readonly AssemblyContinuationSource[];
  assumptions: readonly AllocationReason[] }>;
export type AssemblyContinuation = Common & (
  | Readonly<{ status: 'known'; utility: AllocationUtility; assemblyDelayApplied: true; missing: readonly [] }>
  | Readonly<{ status: 'unknown' | 'blocked'; utility: null; missing: readonly AllocationReason[] }>
);

const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const probability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const copyTerms = (terms: AllocationUtility['benefit'], factor = 1) => terms.map(term => ({ ...term, value: term.value * factor,
  ...(term.catalogUnitValues ? { catalogUnitValues: term.catalogUnitValues.map(entry => ({ ...entry, valueGold: entry.valueGold * factor })) } : {}) }));
const copyUtility = (value: AllocationUtility): AllocationUtility => ({ ...value, benefit: copyTerms(value.benefit), cost: copyTerms(value.cost) });
const copyReason = (reason: AllocationReason): AllocationReason => ({ ...reason, factIds: [...reason.factIds], values: { ...reason.values } });

/** Conditional monetary mixture, not navigation, combat, supply calibration or
 * an opportunity quote. Each successful path is settled at its own time before
 * this function is called. The assembly provider applies P_fill once afterward. */
export function combineAssemblyContinuations(input: Readonly<{
  forecast: Forecast; window: ValuationWindow; paths: readonly AssemblyPathContinuation[];
}>): AssemblyContinuation {
  const { forecast, window } = input;
  const bounds = forecast.completionProbabilityBounds ?? {
    lower: forecast.completionProbability, upper: forecast.completionProbability };
  const basis = bounds.upper > bounds.lower ? 'lower-bound' as const : 'exact' as const;
  const scenarios = [...forecast.fillScenarios].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const filled = scenarios.filter(path => path.probability > 0 && path.readyTick !== null);
  const mass = filled.reduce((sum, path) => sum + path.probability, 0);
  const paths = new Map(input.paths.map(path => [path.pathId, path]));
  const sources: AssemblyContinuationSource[] = scenarios.map(scenario => {
    const path = paths.get(scenario.id);
    return { pathId: scenario.id, probability: scenario.probability,
      conditionalWeight: scenario.readyTick !== null && mass > 0 ? scenario.probability / mass : 0,
      readyTick: scenario.readyTick, window: path ? { ...path.window } : null,
      utility: path?.utility ? copyUtility(path.utility) : null, termIndices: { benefit: [], cost: [] } };
  });
  const assumptions: AllocationReason[] = [];
  const common = () => ({ window: { ...window }, completionProbability: bounds.lower,
    completionProbabilityBounds: { ...bounds }, basis, sources, assumptions });
  const failed = (code: string, factIds: readonly string[] = [], status: 'unknown' | 'blocked' = 'unknown'): AssemblyContinuation => ({
    ...common(), status, utility: null, missing: [{ code, factIds, values: {} }] });
  try { valuationWindow(window.taskTicks, { phase: 'gross', window }); }
  catch { return failed('assembly-continuation-window-invalid'); }
  if (!probability(bounds.lower) || !probability(bounds.upper) || bounds.lower > bounds.upper
    || !near(bounds.lower, forecast.completionProbability)) return failed('assembly-fill-probability-invalid');
  if (scenarios.some(path => !path.id || !probability(path.probability))
    || new Set(scenarios.map(path => path.id)).size !== scenarios.length
    || !near(scenarios.reduce((sum, path) => sum + path.probability, 0), 1))
    return failed('assembly-fill-scenarios-invalid');
  if (paths.size !== input.paths.length || input.paths.some(path => !scenarios.some(scenario => scenario.id === path.pathId)))
    return failed('assembly-continuation-path-identity-invalid');
  if (!mass) return failed(forecast.status === 'blocked' ? 'assembly-no-filled-continuation' : 'assembly-fill-forecast-unquoted', [],
    forecast.status === 'blocked' ? 'blocked' : 'unknown');
  // Explicit positive lower bounds are actionable, including unresolved supply
  // tails. A missing settlement of an already filled path is a different gap.
  if (!near(mass, bounds.lower) || forecast.status === 'unknown' && basis !== 'lower-bound'
    || forecast.status === 'blocked') return failed('assembly-fill-forecast-unquoted');
  const benefit: AllocationUtility['benefit'][number][] = [], cost: AllocationUtility['cost'][number][] = [];
  let persistenceBonus = 0;
  for (const scenario of filled) {
    const path = paths.get(scenario.id), weight = scenario.probability / mass;
    if (!path?.utility) return failed('assembly-continuation-path-unquoted', [scenario.id]);
    if (!Number.isFinite(scenario.readyTick) || scenario.readyTick! < forecast.forecastTick || path.readyTick !== scenario.readyTick)
      return failed('assembly-continuation-path-time-mismatch', [scenario.id]);
    if (!sameValuationWindow(window, path.window) || path.utility.horizonTicks !== window.horizonTicks)
      return failed('assembly-continuation-path-window-mismatch', [scenario.id]);
    const utility = path.utility;
    const terms = [...utility.benefit, ...utility.cost];
    if (!probability(utility.successProbability) || !Number.isFinite(utility.persistenceBonus) || utility.persistenceBonus < 0
      || !Number.isFinite(utility.score) || terms.some(term => !Number.isFinite(term.value)) || utility.cost.some(term => term.value < 0)
      || !near(utility.score, utility.successProbability * utility.benefit.reduce((sum, term) => sum + term.value, 0)
        - utility.cost.reduce((sum, term) => sum + term.value, 0) + utility.persistenceBonus))
      return failed('assembly-continuation-path-utility-invalid', [scenario.id]);
    try { assertUnitValueSides(utility); }
    catch { return failed('assembly-continuation-path-unit-value-conflict', [scenario.id]); }
    const indices = { benefit: utility.benefit.map((_, index) => benefit.length + index), cost: utility.cost.map((_, index) => cost.length + index) };
    benefit.push(...copyTerms(utility.benefit, weight * utility.successProbability));
    cost.push(...copyTerms(utility.cost, weight));
    persistenceBonus += weight * utility.persistenceBonus;
    sources[sources.findIndex(source => source.pathId === scenario.id)] = {
      ...sources.find(source => source.pathId === scenario.id)!, termIndices: indices };
    for (const assumption of path.assumptions ?? []) assumptions.push({ ...copyReason(assumption), values: { ...assumption.values,
      assemblyPathId: scenario.id, probability: scenario.probability, conditionalWeight: weight, readyTick: scenario.readyTick } });
  }
  const utility: AllocationUtility = { horizonTicks: window.horizonTicks, benefit, cost, successProbability: 1, persistenceBonus,
    score: benefit.reduce((sum, term) => sum + term.value, 0) - cost.reduce((sum, term) => sum + term.value, 0) + persistenceBonus };
  if (!Number.isFinite(utility.score)) return failed('assembly-continuation-aggregate-nonfinite');
  try { assertUnitValueSides(utility); }
  catch { return failed('assembly-continuation-unit-value-conflict'); }
  if (basis === 'lower-bound') assumptions.push({ code: 'assembly-continuation-lower-bound', factIds: filled.map(path => path.id),
    values: { lower: bounds.lower, upper: bounds.upper, unresolvedProbability: forecast.diagnostics.unresolvedProbability ?? bounds.upper - bounds.lower } });
  return { ...common(), status: 'known', utility, assemblyDelayApplied: true, missing: [] };
}
