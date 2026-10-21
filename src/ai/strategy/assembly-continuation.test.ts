import { describe, expect, it } from 'vitest';
import type { AllocationUtility } from './allocation-types';
import { combineAssemblyContinuations, type AssemblyPathContinuation } from './assembly-continuation';
import type { ValuationWindow } from './types';
import { discountedValue } from './utility';

const window: ValuationWindow = { taskTicks: 1000, holdingTicks: 1400, horizonTicks: 2400, discountTicks: 2400 };
const fill = (id: string, probability: number, readyTick: number | null) => ({ id, probability, readyTick,
  conditionalForce: readyTick === null ? 0 : 1, production: [] });
type Forecast = Parameters<typeof combineAssemblyContinuations>[0]['forecast'];
const forecast = (): Forecast => ({ status: 'gathering', forecastTick: 0, completionProbability: .75,
  completionProbabilityBounds: { lower: .75, upper: .75 }, diagnostics: { scenarioCount: 3, scenarioLimitCount: 0 }, missing: [],
  fillScenarios: [fill('early', .25, 100), fill('late', .5, 900), fill('no-supply', .25, null)] });
const utility = (benefit: number, conditionalExpense: number, cost: number, p: number, persistenceBonus: number): AllocationUtility => ({
  horizonTicks: window.horizonTicks,
  benefit: [{ code: 'income', value: benefit }, { code: 'success-only-capital', value: -conditionalExpense }],
  cost: [{ code: 'casualty', value: cost, catalogUnitValues: [{ unitId: 'actual-fighter', valueGold: cost }] }],
  successProbability: p, persistenceBonus, score: p * (benefit - conditionalExpense) - cost + persistenceBonus });
const paths = (): AssemblyPathContinuation[] => [
  { pathId: 'early', readyTick: 100, window, utility: utility(1000, 100, 200, .8, 20),
    assumptions: [{ code: 'native-path-conditional-value', factIds: ['actual-fighter'], values: { delayApplied: true } }] },
  { pathId: 'late', readyTick: 900, window, utility: utility(1500, 300, 100, .5, 5) },
];

describe('per-path conditional assembly monetary mixture', () => {
  it('integrates each physical P before mixing terms and leaves exactly one outer P_fill', () => {
    const input = { forecast: forecast(), window, paths: paths() }, before = JSON.stringify(input);
    const mixed = combineAssemblyContinuations(input);
    expect(mixed.status).toBe('known');
    expect(mixed.utility?.successProbability).toBe(1);
    expect(mixed.utility?.benefit.map(term => term.code)).toEqual(['income', 'success-only-capital', 'income', 'success-only-capital']);
    [1000 * (.25 / .75) * .8, -100 * (.25 / .75) * .8,
      1500 * (.5 / .75) * .5, -300 * (.5 / .75) * .5].forEach((value, index) =>
      expect(mixed.utility?.benefit[index]?.value).toBeCloseTo(value));
    expect(mixed.utility?.cost[0]?.value).toBe(200 * (.25 / .75));
    expect(mixed.utility?.cost[1]?.catalogUnitValues).toEqual([{ unitId: 'actual-fighter', valueGold: 100 * (.5 / .75) }]);
    expect(mixed.utility?.persistenceBonus).toBeCloseTo(10);
    expect(mixed.utility?.score).toBeCloseTo((540 * .25 + 505 * .5) / .75);
    expect(mixed.completionProbability * mixed.utility!.score).toBeCloseTo(387.5);
    expect(mixed.utility?.cost.some(term => term.code.includes('opportunity'))).toBe(false);
    expect(mixed.sources.map(source => [source.pathId, source.probability, source.conditionalWeight, source.readyTick]))
      .toEqual([['early', .25, .25 / .75, 100], ['late', .5, .5 / .75, 900], ['no-supply', .25, 0, null]]);
    expect(mixed.sources[1]!.termIndices).toEqual({ benefit: [2, 3], cost: [1] });
    expect(mixed.sources[1]!.utility).toEqual(input.paths[1]!.utility);
    expect(mixed.assumptions[0]).toMatchObject({ code: 'native-path-conditional-value', values: {
      assemblyPathId: 'early', probability: .25, conditionalWeight: .25 / .75, readyTick: 100 } });
    expect(JSON.stringify(input)).toBe(before);
    expect(combineAssemblyContinuations({ ...input, forecast: { ...input.forecast, fillScenarios: [...input.forecast.fillScenarios].reverse() },
      paths: [...input.paths].reverse() })).toEqual(mixed);
    expect(combineAssemblyContinuations(JSON.parse(JSON.stringify(input)))).toEqual(mixed);
  });

  it('mixes already delayed cash flows, which differs from settling once at the mean time', () => {
    const model = { ...forecast(), completionProbability: 1, completionProbabilityBounds: { lower: 1, upper: 1 },
      fillScenarios: [fill('early', .5, 100), fill('late', .5, 900)] };
    const values = paths().map(path => ({ ...path, utility: utility(discountedValue(1000, path.readyTick, window), 0, 0, 1, 0) }));
    const mixed = combineAssemblyContinuations({ forecast: model, window, paths: values });
    expect(mixed.utility?.score).toBeCloseTo(.5 * discountedValue(1000, 100, window) + .5 * discountedValue(1000, 900, window));
    expect(mixed.utility?.score).not.toBeCloseTo(discountedValue(1000, 500, window), 6);
    expect(mixed.status === 'known' && mixed.assemblyDelayApplied).toBe(true);
  });

  it('keeps a supported positive lower bound actionable without declaring its unresolved tail zero', () => {
    const model: Forecast = { ...forecast(), status: 'unknown', completionProbability: .5,
      completionProbabilityBounds: { lower: .5, upper: 1 },
      diagnostics: { scenarioCount: 2, scenarioLimitCount: 0, unresolvedProbability: .5 },
      missing: [{ code: 'assembly-conditional-support-exhausted', status: 'unknown', factIds: ['tail'] }],
      fillScenarios: [fill('early', .5, 100), fill('tail', .5, null)] };
    const mixed = combineAssemblyContinuations({ forecast: model, window, paths: paths().slice(0, 1) });
    expect(mixed.status).toBe('known'); expect(mixed.basis).toBe('lower-bound');
    expect(mixed.completionProbabilityBounds).toEqual({ lower: .5, upper: 1 });
    expect(mixed.utility?.score).toBe(540);
    expect(mixed.completionProbability * mixed.utility!.score).toBe(270);
    expect(mixed.sources[1]).toMatchObject({ pathId: 'tail', probability: .5, conditionalWeight: 0, readyTick: null, utility: null });
    expect(mixed.assumptions).toContainEqual({ code: 'assembly-continuation-lower-bound', factIds: ['early'],
      values: { lower: .5, upper: 1, unresolvedProbability: .5 } });
  });

  it('refuses a missing positive filled settlement even when another path is known', () => {
    for (const values of [paths().slice(0, 1), [paths()[0]!, { ...paths()[1]!, utility: null }]]) {
      const mixed = combineAssemblyContinuations({ forecast: forecast(), window, paths: values });
      expect(mixed).toMatchObject({ status: 'unknown', utility: null,
        missing: [{ code: 'assembly-continuation-path-unquoted', factIds: ['late'] }] });
    }
  });

  it('requires no settlement for known failed or zero-probability paths', () => {
    const model = { ...forecast(), fillScenarios: [...forecast().fillScenarios, fill('impossible', 0, 300)] };
    expect(combineAssemblyContinuations({ forecast: model, window, paths: paths() }).status).toBe('known');
    const none: Forecast = { ...forecast(), status: 'blocked', completionProbability: 0,
      completionProbabilityBounds: { lower: 0, upper: 0 }, fillScenarios: [fill('no-supply', 1, null)] };
    expect(combineAssemblyContinuations({ forecast: none, window, paths: [] })).toMatchObject({ status: 'blocked', utility: null });
    expect(combineAssemblyContinuations({ forecast: { ...none, status: 'unknown', completionProbabilityBounds: { lower: 0, upper: 1 } },
      window, paths: [] })).toMatchObject({ status: 'unknown', utility: null });
  });

  it('rejects inconsistent time, window, identity, mass or monetary evidence without throwing a think', () => {
    const variants = [
      { values: [{ ...paths()[0]!, readyTick: 101 }, paths()[1]!], code: 'assembly-continuation-path-time-mismatch' },
      { values: [{ ...paths()[0]!, window: { ...window, discountTicks: 3000 } }, paths()[1]!], code: 'assembly-continuation-path-window-mismatch' },
      { values: [paths()[0]!, paths()[0]!, paths()[1]!], code: 'assembly-continuation-path-identity-invalid' },
      { values: [{ ...paths()[0]!, utility: { ...paths()[0]!.utility!, score: 9000 } }, paths()[1]!], code: 'assembly-continuation-path-utility-invalid' },
    ];
    for (const variant of variants) expect(combineAssemblyContinuations({ forecast: forecast(), window, paths: variant.values }))
      .toMatchObject({ status: 'unknown', utility: null, missing: [{ code: variant.code }] });
    expect(combineAssemblyContinuations({ forecast: { ...forecast(), completionProbability: .7,
      completionProbabilityBounds: { lower: .7, upper: .7 } }, window, paths: paths() }))
      .toMatchObject({ status: 'unknown', utility: null });
    expect(combineAssemblyContinuations({ forecast: { ...forecast(), fillScenarios: [fill('bad', 1.1, 100)] }, window, paths: [] }))
      .toMatchObject({ status: 'unknown', utility: null });
  });

  it('keeps failed combat losses and negative continuation values instead of multiplying costs by physical success', () => {
    const model = { ...forecast(), completionProbability: 1, completionProbabilityBounds: { lower: 1, upper: 1 }, fillScenarios: [fill('early', 1, 100)] };
    const mixed = combineAssemblyContinuations({ forecast: model, window,
      paths: [{ ...paths()[0]!, utility: utility(1000, 100, 40, 0, 0) }] });
    expect(mixed.utility).toMatchObject({ successProbability: 1, cost: [{ value: 40 }], score: -40 });
    expect(mixed.utility?.benefit.every(term => term.value === 0)).toBe(true);
  });

  it('preserves the cross-side catalogue invariant across mutually exclusive paths', () => {
    const values = paths();
    const original = values[1]!.utility!;
    values[1] = { ...values[1]!, utility: { ...original, cost: [], score: original.score + 100,
      benefit: [{ ...original.benefit[0]!, catalogUnitValues: [{ unitId: 'actual-fighter', valueGold: 100 }] }, original.benefit[1]!] } };
    const mixed = combineAssemblyContinuations({ forecast: forecast(), window, paths: values });
    expect(mixed).toMatchObject({ status: 'unknown', utility: null,
      missing: [{ code: 'assembly-continuation-unit-value-conflict' }] });
  });
});
