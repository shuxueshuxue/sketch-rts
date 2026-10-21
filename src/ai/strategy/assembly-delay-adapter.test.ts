import { describe, expect, it } from 'vitest';
import { adaptAssemblyDelayLoss } from './assembly-delay-adapter';
import { valueAssemblyDelayLoss, type AssemblyDelayLossValue } from './assembly-delay-loss';
import { quoteOpportunityCost, valuationWindow } from './utility';

const window = valuationWindow(1000);
function proof(values = [30, 20], cap = 100): Extract<AssemblyDelayLossValue, { status: 'known' }> {
  return { status: 'known', window, valueCapGold: cap, lossUpperGold: values.reduce((sum, value) => sum + value, 0),
    uncappedLossUpperGold: values.reduce((sum, value) => sum + value, 0),
    components: values.map((valueGold, i) => ({ code: 'cash-delay', pathId: `path-${i}`, valueGold, factIds: [`path-${i}`, 'mine'] })),
    paths: values.map((value, i) => ({ pathId: `path-${i}`, probability: 1 / values.length,
      before: { status: 'ready', tick: 10 }, after: { status: 'ready', tick: 100 + i * 100 }, basis: 'cash-flow-delay',
      rawLossUpperGold: value * values.length, lossUpperGold: value * values.length, weightedLossUpperGold: value,
      components: [{ code: 'income', side: 'benefit', factIds: ['mine'], beforePresentGold: value * values.length,
        afterPresentGold: 0, differenceGold: value * values.length, lossUpperGold: value * values.length }],
      reason: { code: 'assembly-delay-reintegrated-cash-flows', factIds: [`path-${i}`], values: {} } })),
    reason: { code: 'assembly-delay-cash-flow-upper-bound', factIds: ['mine'], values: {} } };
}
function admit(result: ReturnType<typeof adaptAssemblyDelayLoss>) {
  expect(result.status).toBe('known');
  if (result.status !== 'known') throw new Error(result.reasonCode);
  expect(result.bound.components.reduce((sum, term) => sum + term.valueGold, 0)).toBe(result.bound.gold);
  return quoteOpportunityCost(window, [{ objectiveId: 'conquer', unitIds: ['soldier'], committed: true,
    withResourcesGold: result.bound.gold, withoutResourcesGold: null, withoutResourcesStatus: 'unknown',
    assemblyDelayUpperBound: result.bound }]);
}

describe('formal assembly delay proof adapter', () => {
  it('binds the slim formal bound and retains the complete path proof only in a detached sidecar', () => {
    const input = proof(), saved = structuredClone(input), result = adaptAssemblyDelayLoss('mine', input);
    expect(result).toMatchObject({ status: 'known', bound: { targetId: 'mine', gold: 50,
      continuationUpperGold: 100, mode: 'scenario-delay', window } });
    expect(admit(result)).toMatchObject({ status: 'known', gold: 50,
      displacements: [{ basis: 'assembly-delay-upper-bound', withoutResourcesGold: null }] });
    expect(result.sidecar).toEqual(input); expect(result.sidecar).not.toBe(input);
    if (result.status !== 'known') throw new Error(result.reasonCode);
    expect(result.bound).not.toHaveProperty('paths'); expect(result.bound.components[0]).not.toHaveProperty('pathId');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result); expect(input).toEqual(saved);
  });

  it('maps the unavailable continuation cap to the framework counter reason without inventing zero loss', () => {
    const raw = valueAssemblyDelayLoss({ forecastTick: 0, window, valueCapGold: null, scenarios: [] });
    expect(adaptAssemblyDelayLoss('mine', raw)).toMatchObject({ status: 'unknown',
      reasonCode: 'assembly-continuation-value-unknown', sidecar: raw });
    expect(adaptAssemblyDelayLoss('', proof())).toMatchObject({ status: 'unknown', reasonCode: 'assembly-delay-target-unquoted' });
    expect(adaptAssemblyDelayLoss('mine', { ...proof(), window: { ...window, horizonTicks: 1 } }))
      .toMatchObject({ status: 'unknown', reasonCode: 'assembly-delay-window-invalid' });
  });

  it('keeps the actual helper whole-cap fallback and mixed path classification explicit', () => {
    const raw = valueAssemblyDelayLoss({ forecastTick: 0, window, valueCapGold: 100, capFactIds: ['mine'], scenarios: [] });
    const result = adaptAssemblyDelayLoss('mine', raw);
    expect(result).toMatchObject({ status: 'known', bound: { gold: 100, mode: 'whole-value-cap' }, sidecar: raw });
    expect(admit(result)).toMatchObject({ status: 'known', gold: 100 });
    const mixed = proof();
    const partial = { ...mixed, paths: mixed.paths.map((path, i) => i ? { ...path, basis: 'full-cap' as const } : path) };
    expect(adaptAssemblyDelayLoss('mine', partial)).toMatchObject({ status: 'known', bound: { gold: 50, mode: 'whole-value-cap' } });
  });

  it('caps an oversized proof explicitly while preserving its original amounts', () => {
    const raw = proof([80, 60], 100), result = adaptAssemblyDelayLoss('mine', raw);
    expect(result).toMatchObject({ status: 'known', bound: { gold: 100, mode: 'whole-value-cap',
      components: [{ code: 'assembly-delay-adapter-capped-proof', valueGold: 100 }] },
    sidecar: { lossUpperGold: 140, components: [{ valueGold: 80 }, { valueGold: 60 }] } });
    expect(admit(result)).toMatchObject({ status: 'known', gold: 100 });
    const perPath = proof();
    expect(adaptAssemblyDelayLoss('mine', { ...perPath, paths: perPath.paths.map(path => ({ ...path,
      rawLossUpperGold: path.lossUpperGold + 1 })) })).toMatchObject({ status: 'known', bound: { mode: 'whole-value-cap' } });
  });

  it('resolves floating rounding conservatively with an exact component total accepted by the real oracle', () => {
    const raw = proof([.1, .2]);
    const result = adaptAssemblyDelayLoss('mine', { ...raw, lossUpperGold: .3 });
    expect(result).toMatchObject({ status: 'known', bound: { gold: .1 + .2, mode: 'scenario-delay' } }); admit(result);
    const reverse = adaptAssemblyDelayLoss('mine', { ...proof([.3]), lossUpperGold: .1 + .2 });
    expect(reverse).toMatchObject({ status: 'known', bound: { gold: .1 + .2,
      components: [{ code: 'assembly-delay-adapter-rounded-proof', valueGold: .1 + .2 }] } }); admit(reverse);
  });

  it('uses the finite cap when detailed proof is inconsistent, and allows a genuinely known zero', () => {
    for (const raw of [{ ...proof(), lossUpperGold: 1 }, proof([NaN]), { ...proof(), components: [] }]) {
      const result = adaptAssemblyDelayLoss('mine', raw);
      expect(result).toMatchObject({ status: 'known', bound: { gold: 100, mode: 'whole-value-cap',
        components: [{ code: 'assembly-delay-adapter-whole-value-cap' }] } }); admit(result);
    }
    const zero = adaptAssemblyDelayLoss('mine', proof([0], 0));
    expect(zero).toMatchObject({ status: 'known', bound: { gold: 0, mode: 'scenario-delay' } });
    expect(admit(zero)).toMatchObject({ status: 'known', gold: 0, displacements: [{ marginalGold: 0 }] });
  });
});
