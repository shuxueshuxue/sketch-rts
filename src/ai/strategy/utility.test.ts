import { describe, expect, it } from 'vitest';
import { discountGold, forceSuccessProbability, forceTimeGold, STRATEGY_PARAMETERS, strategyUtility } from './utility';

describe('shared strategic utility scale', () => {
  it('charges the expected cost even if an attempt has no chance of success', () => {
    const terms = { benefit: [{ code: 'mine', value: 500, explanation: 'future income' }],
      cost: [{ code: 'voyage', value: 100, explanation: 'paid even when repelled' }], evidence: [] };
    expect(strategyUtility({ ...terms, successProbability: 0, persistenceBonus: 20 }).score).toBe(-80);
    expect(strategyUtility({ ...terms, successProbability: .2 }).score).toBe(0);
    const successOnly = strategyUtility({ ...terms, benefit: [...terms.benefit,
      { code: 'hall-after-clearing', value: -400, explanation: 'paid only after successful clearing' }],
    successProbability: .5 });
    expect(successOnly.score).toBe(-50);
  });

  it('uses the same probability curve for equal field or camp strength ratios', () => {
    expect(forceSuccessProbability(0, 0)).toBe(0);
    expect(forceSuccessProbability(0, 4)).toBe(0);
    expect(forceSuccessProbability(4, 0)).toBe(1);
    expect(forceSuccessProbability(4, 4)).toBe(.5);
    expect(forceSuccessProbability(4, 2)).toBe(forceSuccessProbability(40, 20));
    expect(forceSuccessProbability(4, 2)).toBeGreaterThan(forceSuccessProbability(2, 4));
    expect(forceSuccessProbability(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(.5);
  });

  it('prices force time and delayed benefits on one declared horizon', () => {
    const horizon = STRATEGY_PARAMETERS.utilityHorizonTicks;
    expect(forceTimeGold(1, horizon)).toBe(100);
    expect(forceTimeGold(2, horizon / 2)).toBe(100);
    expect(forceTimeGold(100, 0)).toBe(0);
    expect(discountGold(400, 0)).toBe(400);
    expect(discountGold(400, horizon)).toBe(200);
    expect(discountGold(400, horizon * 2)).toBeLessThan(discountGold(400, horizon));
  });

  it('rejects invalid facts instead of emitting a plausible non-finite score', () => {
    for (const invalid of [-1, NaN, Infinity]) {
      expect(() => forceSuccessProbability(invalid, 1)).toThrow();
      expect(() => forceSuccessProbability(1, invalid)).toThrow();
      expect(() => forceTimeGold(invalid, 1)).toThrow();
      expect(() => discountGold(100, invalid)).toThrow();
    }
    expect(() => strategyUtility({ benefit: [], cost: [], successProbability: 1.1, evidence: [] })).toThrow();
    expect(() => strategyUtility({ benefit: [], cost: [{ code: 'invalid', value: -1, explanation: '' }],
      successProbability: 1, evidence: [] })).toThrow();
  });
});
