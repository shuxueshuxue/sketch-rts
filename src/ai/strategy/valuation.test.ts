import { describe, expect, it } from 'vitest';
import { assetSurvivalProbability, discountedFlow, discountedValue, forceSuccessProbability, quoteOpportunityCost, resolveValuation,
  reusableAssetCost, strategyUtility, valuationWindow } from './utility';
import type { OpportunityAlternative } from './types';

const window = valuationWindow(1200);
const alternative = (patch: Partial<OpportunityAlternative> = {}): OpportunityAlternative => ({
  objectiveId: 'defend-home', unitIds: ['a', 'b', 'c', 'd'], withResourcesGold: 700,
  withoutResourcesGold: null, withoutResourcesStatus: 'not-runnable', committed: false, ...patch,
});

describe('shared bundle valuation', () => {
  it('integrates prospective mine income over the same epoch and bounded resource', () => {
    expect(window).toEqual({ taskTicks: 1200, holdingTicks: 2400, horizonTicks: 3600, discountTicks: 2400 });
    const flow = discountedFlow({ goldPerTick: .2, remainingGold: 9000, startsInTicks: 1200, window });
    expect(flow).toBeCloseTo(480 * Math.log(6000 / 3600), 10);
    expect(discountedFlow({ goldPerTick: .2, remainingGold: 10, startsInTicks: 1200, window })).toBeLessThan(10);
    expect(discountedFlow({ goldPerTick: .2, remainingGold: 9000, startsInTicks: 3600, window })).toBe(0);
    expect(discountedValue(240, 1200, window)).toBe(160);
    expect(discountedValue(240, 3601, window)).toBe(0);
    expect(valuationWindow(9999, { phase: 'gross', window })).toEqual(window);
  });

  it('charges expected asset loss while crediting continued ship service', () => {
    const continued = reusableAssetCost({ priceGold: 240, survivalProbability: .95, atTicks: 1200, window });
    expect(continued.residualGold).toBe(228);
    expect(continued.expectedLossGold).toBe(12);
    expect(continued.presentCostGold).toBe(8);
    const consumed = reusableAssetCost({ priceGold: 240, survivalProbability: 0, atTicks: 1200, window });
    expect(consumed.presentCostGold).toBe(160);
    expect(reusableAssetCost({ priceGold: 240, survivalProbability: 1, atTicks: 0, window }).presentCostGold).toBe(0);
    // The same future loss applies to an already paid hull; cash admission is separate.
    expect(JSON.parse(JSON.stringify(continued))).toEqual(continued);
    expect(assetSurvivalProbability({ status: 'unknown' })).toBeNull();
    expect(assetSurvivalProbability({ status: 'known', ourForce: 0, opponentForce: 0 })).toBe(1);
    expect(assetSurvivalProbability({ status: 'known', ourForce: 4, opponentForce: 2 })).toBe(.8);
  });

  it('does not charge idle soldiers their price or a fixed duration fee', () => {
    const idle = quoteOpportunityCost(window, []);
    expect(idle).toEqual({ window, status: 'known', gold: 0,
      basis: 'no-positive-feasible-alternative', alternatives: [] });
    const defend = quoteOpportunityCost(window, [alternative()]);
    expect(defend.status).toBe('known');
    if (defend.status !== 'known') throw new Error('Expected a priced alternative');
    const island = (opportunity: number) => strategyUtility({ benefit: [{ code: 'mine', value: 500, explanation: '' }],
      cost: [{ code: 'bundle-opportunity', value: opportunity, explanation: '' }], successProbability: .7, evidence: [],
      horizonTicks: window.horizonTicks }).score;
    expect(island(0)).toBeGreaterThan(0);
    expect(island(defend.gold)).toBeLessThan(0);
    expect(defend.gold).toBe(700);
  });

  it('uses whole-group marginal loss and never adds mutually exclusive payoffs', () => {
    const result = quoteOpportunityCost(window, [
      alternative({ objectiveId: 'a', withResourcesGold: 700, withoutResourcesGold: 200, withoutResourcesStatus: 'feasible' }),
      alternative({ objectiveId: 'b', withResourcesGold: 400 }),
      alternative({ objectiveId: 'c', unitIds: ['e'], withResourcesGold: 80 }),
    ]);
    expect(result.status).toBe('known');
    if (result.status !== 'known') throw new Error('Expected known marginal loss');
    expect(result.gold).toBe(580);
    expect(result.alternatives.map(item => item.objectiveId)).toEqual(['a', 'c']);
    expect(quoteOpportunityCost(window, [...[alternative({ objectiveId: 'b', withResourcesGold: 400 }),
      alternative({ objectiveId: 'a', withResourcesGold: 700, withoutResourcesGold: 200, withoutResourcesStatus: 'feasible' }),
      alternative({ objectiveId: 'c', unitIds: ['e'], withResourcesGold: 80 })]])).toEqual(result);
  });

  it('keeps unknown actual commitments unknown and labels prospective bounds', () => {
    expect(quoteOpportunityCost(window, [alternative({ committed: true, withoutResourcesStatus: 'unknown' })]))
      .toEqual({ window, status: 'unknown', objectiveIds: ['defend-home'], reason: { code: 'committed-opportunity-cost-unknown' } });
    const bound = quoteOpportunityCost(window, [alternative({ withoutResourcesStatus: 'unknown' })]);
    expect(bound.status).toBe('known');
    if (bound.status === 'known') expect(bound.alternatives[0]).toMatchObject({ marginalGold: 700,
      withoutResourcesGold: null, basis: 'conservative-bound' });
    expect(quoteOpportunityCost(window, [], ['unquoted-task']).status).toBe('unknown');
  });

  it('does not ask for opportunity costs in gross passes or accept another horizon', () => {
    const request = { objectiveId: 'island', methodId: null, unitIds: ['d', 'a', 'a'], window };
    expect(resolveValuation(request, { phase: 'gross', opportunity: () => { throw new Error('Gross oracle called'); } }))
      .toEqual({ phase: 'gross', window, unitIds: ['a', 'd'], opportunity: null });
    expect(resolveValuation(request, { phase: 'net' }).opportunity?.status).toBe('unknown');
    const net = resolveValuation(request, { phase: 'net', opportunity: () => quoteOpportunityCost(window, []) });
    expect(JSON.parse(JSON.stringify(net))).toEqual(net);
    expect(() => resolveValuation(request, { phase: 'net', opportunity: () => quoteOpportunityCost(valuationWindow(1201), []) }))
      .toThrow('different valuation window');
  });

  it('keeps the safety margin in departure demand, outside the probability curve', () => {
    const actualOpponent = 2.6, departureRequirement = actualOpponent + 1.5;
    const ourForce = 4.7;
    expect(ourForce).toBeGreaterThan(departureRequirement);
    expect(forceSuccessProbability(ourForce, actualOpponent)).toBeGreaterThan(forceSuccessProbability(ourForce, departureRequirement));
    expect(forceSuccessProbability(ourForce, actualOpponent)).toBe(forceSuccessProbability(ourForce, 2.6));
  });

  it('preserves dominance while exposing legitimate horizon-dependent ordering', () => {
    const short = valuationWindow(100, { phase: 'gross', holdingTicks: 100 });
    const long = valuationWindow(100, { phase: 'gross', holdingTicks: 2400 });
    const income = (rate: number, w: typeof window) => discountedFlow({ goldPerTick: rate,
      remainingGold: 9000, startsInTicks: 100, window: w });
    for (const w of [short, long]) expect(income(.2, w)).toBeGreaterThan(income(.1, w));
    // More holding values a long-lived mine more; the one-off loot is unchanged.
    expect(income(.2, short)).toBeLessThan(discountedValue(100, 0, short));
    expect(income(.2, long)).toBeGreaterThan(discountedValue(100, 0, long));
  });

  it('rejects malformed windows, probability and unavailable numeric sentinels', () => {
    expect(() => valuationWindow(1, { phase: 'gross', window: { ...window, horizonTicks: 1 } })).toThrow();
    expect(() => reusableAssetCost({ priceGold: 240, survivalProbability: 1.1, atTicks: 0, window })).toThrow();
    expect(() => discountedFlow({ goldPerTick: NaN, remainingGold: 9000, startsInTicks: 0, window })).toThrow();
    expect(() => quoteOpportunityCost(window, [alternative({ withoutResourcesGold: 0 })])).toThrow();
    expect(() => quoteOpportunityCost(window, [alternative({ withoutResourcesStatus: 'feasible' })])).toThrow();
  });
});
