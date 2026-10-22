import { describe, expect, it } from 'vitest';
import { createOpportunityOracle, type BundleValuationSource } from './opportunity-oracle';
import { valuationWindow } from './utility';
import { canonicalProductionUses } from './production-use';

const window = valuationWindow(1000);
const request = { objectiveId: 'island', methodId: 'ferry', unitIds: ['a', 'b', 'c', 'd'], window };
const source = (patch: Partial<BundleValuationSource> = {}): BundleValuationSource => ({
  id: 'home/local', objectiveId: 'home', unitIds: request.unitIds, effectKeys: ['safe:home'], committed: false,
  quote: ids => ids.length === 4 ? { status: 'feasible', score: 700, coverage: 'complete' }
    : { status: 'not-runnable', reasonCode: 'insufficient-force' }, ...patch,
});

describe('whole-bundle opportunity oracle', () => {
  it('reprices alternatives at the same horizon and removes all requested resources', () => {
    const calls: unknown[] = [];
    const oracle = createOpportunityOracle([source({ quote(ids, valueWindow) {
      calls.push([ids, valueWindow]);
      return ids.length ? { status: 'feasible', score: valueWindow.horizonTicks / 10, coverage: 'complete' }
        : { status: 'not-runnable', reasonCode: 'insufficient-force' };
    } })], { effectKeysFor: () => ['mine:new'] });
    const quote = oracle(request);
    expect(quote.status === 'known' && quote.gold).toBe(340);
    expect(calls).toEqual([[['a', 'b', 'c', 'd'], window], [[], window]]);
    expect(oracle(request)).toEqual(quote);
    expect(calls).toHaveLength(2);
    const longer = valuationWindow(2000);
    expect(oracle({ ...request, window: longer })).not.toEqual(quote);
    expect(calls).toHaveLength(4);
  });

  it('does not charge the same mining effect via two methods or a support goal', () => {
    const sources = [source(), source({ id: 'home/recall' }), source({ id: 'island/support', objectiveId: 'reinforce', effectKeys: ['mine:new'] })];
    const options = { effectKeysFor: () => ['mine:new'] };
    const quote = createOpportunityOracle(sources, options)(request);
    expect(quote.status === 'known' && quote.gold).toBe(700);
    expect(createOpportunityOracle([...sources].reverse(), options)(request)).toEqual(quote);
  });

  it('keeps actual commitments unknown when only a benefit lower bound is known', () => {
    const lowerBound = source({ committed: true, quote: () => ({ status: 'feasible', score: 200, coverage: 'known-effects' }) });
    expect(createOpportunityOracle([lowerBound], { effectKeysFor: () => [] })(request).status).toBe('unknown');
    const idle = createOpportunityOracle([], { effectKeysFor: () => [] })(request);
    expect(idle.status === 'known' && idle.gold).toBe(0);
    expect(createOpportunityOracle([], { effectKeysFor: () => [], unpricedCommitmentsFor: () => ['unpriced'] })(request).status).toBe('unknown');
  });

  it('uses whole-group marginal response instead of dividing an old total by head count', () => {
    const oracle = createOpportunityOracle([source({ unitIds: ['a', 'b', 'c', 'd', 'e'], quote: ids => ({
      status: 'feasible', score: ids.length === 5 ? 700 : 650, coverage: 'complete' }) })], { effectKeysFor: () => [] });
    expect(oracle(request).status === 'known' && oracle(request)).toMatchObject({ gold: 50 });
    expect(createOpportunityOracle([source()], { effectKeysFor: () => [] })(request)).toMatchObject({ gold: 700 });
  });

  it('reproduces output with a fresh transaction after serialization', () => {
    const warm = createOpportunityOracle([source()], { effectKeysFor: () => [] });
    warm({ ...request, window: valuationWindow(1) });
    const restored = JSON.parse(JSON.stringify(request));
    expect(JSON.stringify(warm(request))).toBe(JSON.stringify(createOpportunityOracle([source()], { effectKeysFor: () => [] })(restored)));
  });

  it('reprices overlapping training time without inventing a per-tick fee', () => {
    const production = [{ buildingId: 'hall', lane: 'training' as const, fromTicks: 100, throughTicks: 300 }];
    const calls: unknown[] = [];
    const queue = source({ unitIds: [], production, quote(ids, valueWindow, unavailable) {
      calls.push({ ids, valueWindow, unavailable });
      return { status: 'feasible', score: unavailable?.length ? 80 : 200, coverage: 'complete' };
    } });
    const oracle = createOpportunityOracle([queue], { effectKeysFor: () => [] });
    const value = oracle({ ...request, unitIds: [], production });
    expect(value).toMatchObject({ status: 'known', gold: 120, alternatives: [{ unitIds: [], production }] });
    expect(calls).toEqual([{ ids: [], valueWindow: window, unavailable: [] },
      { ids: [], valueWindow: window, unavailable: production }]);
    expect(oracle({ ...request, unitIds: [], production })).toEqual(value);
    expect(calls).toHaveLength(2);
  });

  it('keeps native parallel research and later training slots independent', () => {
    const queue = source({ unitIds: [], production: [{ buildingId: 'hall', lane: 'training', fromTicks: 100, throughTicks: 300 }] });
    const oracle = createOpportunityOracle([queue], { effectKeysFor: () => [] });
    expect(oracle({ ...request, unitIds: [], production: [{ buildingId: 'hall', lane: 'research', fromTicks: 100, throughTicks: 300 }] }))
      .toMatchObject({ status: 'known', gold: 0 });
    expect(oracle({ ...request, unitIds: [], production: [{ buildingId: 'hall', lane: 'training', fromTicks: 300, throughTicks: 500 }] }))
      .toMatchObject({ status: 'known', gold: 0 });
    expect(canonicalProductionUses([{ buildingId: 'hall', lane: 'training', fromTicks: 100, throughTicks: 200 },
      { buildingId: 'hall', lane: 'training', fromTicks: 200, throughTicks: 300 }]))
      .toEqual([{ buildingId: 'hall', lane: 'training', fromTicks: 100, throughTicks: 300 }]);
    expect(() => canonicalProductionUses([{ buildingId: 'hall', lane: 'training', fromTicks: 1, throughTicks: Infinity }])).toThrow(/Invalid/);
  });

  it('preserves unknown committed production instead of treating the occupied lane as free', () => {
    const production = [{ buildingId: 'hall', lane: 'training' as const, fromTicks: 0, throughTicks: 100 }];
    const queue = source({ unitIds: [], production, committed: true, quote: (_ids, _window, unavailable) => unavailable?.length
      ? { status: 'unknown', reasonCode: 'delayed-income-unpriced' } : { status: 'feasible', score: 200, coverage: 'complete' } });
    expect(createOpportunityOracle([queue], { effectKeysFor: () => [] })({ ...request, unitIds: [], production }))
      .toMatchObject({ status: 'unknown', objectiveIds: ['home'] });
    expect(createOpportunityOracle([], { effectKeysFor: () => [], unpricedProductionFor: () => ['queue-owner'] })({ ...request, unitIds: [], production }))
      .toMatchObject({ status: 'unknown', objectiveIds: ['queue-owner'] });
  });

  it('uses an explicit migration envelope without turning an unavailable exact value into zero', () => {
    const bound = { targetId: 'mine', gold: 450, window, components: [{ code: 'full-potential', valueGold: 450, factIds: ['mine'] }] };
    const oracle = createOpportunityOracle([], { effectKeysFor: () => [], unpricedCommitmentsFor: () => ['imported'],
      importedUpperBoundFor: (id, requestedWindow) => id === 'imported' ? { unitIds: request.unitIds,
        bound: { ...bound, window: requestedWindow } } : null });
    const quote = oracle(request);
    expect(quote).toMatchObject({ status: 'known', gold: 450,
      displacements: [{ objectiveId: 'imported', marginalGold: 450, withoutResourcesGold: null, basis: 'upper-bound', upperBound: bound }] });
    expect(JSON.stringify(oracle(JSON.parse(JSON.stringify(request))))).toBe(JSON.stringify(quote));
    expect(createOpportunityOracle([], { effectKeysFor: () => [], unpricedCommitmentsFor: () => ['missing'],
      importedUpperBoundFor: () => null })(request)).toMatchObject({ status: 'unknown', objectiveIds: ['missing'] });
    expect(() => createOpportunityOracle([], { effectKeysFor: () => [], unpricedCommitmentsFor: () => ['imported'],
      importedUpperBoundFor: () => ({ unitIds: request.unitIds, bound: { ...bound, window: valuationWindow(1) } }) })(request))
      .toThrow('Invalid imported task loss upper bound');
  });

  it('adopts explicitly matched progress without quoting displacement, retaining other imported losses', () => {
    const old = source({ objectiveId: 'same-progress', committed: true, quote: () => { throw Error('same progress was repriced as a competitor'); } });
    const oracle = createOpportunityOracle([old], { effectKeysFor: () => [],
      continuesCommitment: (from, to) => from === 'same-progress' && to === request.objectiveId,
      unpricedCommitmentsFor: () => ['same-progress', 'other-progress'],
      importedUpperBoundFor: id => { expect(id).toBe('other-progress'); return { unitIds: request.unitIds,
        bound: { targetId: 'different-mine', gold: 450, window, components: [{ code: 'full-potential', valueGold: 450, factIds: [] }] } }; } });
    expect(oracle(request)).toMatchObject({ status: 'known', gold: 450, displacements: [{ objectiveId: 'other-progress', marginalGold: 450 }] });
    expect(createOpportunityOracle([old], { effectKeysFor: () => [], unpricedCommitmentsFor: () => ['same-progress'],
      continuesCommitment: (from, to) => from === 'same-progress' && to === request.objectiveId })(request))
      .toMatchObject({ status: 'known', gold: 0, alternatives: [] });
  });

  it('retains every actual displacement when a speculative whole group overlaps two commitments', () => {
    const sources = [source({ id: 'old/a', objectiveId: 'old-a', committed: true, unitIds: ['a'],
      quote: ids => ids.length ? { status: 'feasible', score: 100, coverage: 'complete' } : { status: 'not-runnable', reasonCode: 'no-members' } }),
    source({ id: 'old/b', objectiveId: 'old-b', committed: true, unitIds: ['b'],
      quote: ids => ids.length ? { status: 'feasible', score: 100, coverage: 'complete' } : { status: 'not-runnable', reasonCode: 'no-members' } }),
    source({ id: 'next', objectiveId: 'next', unitIds: ['a', 'b'],
      quote: ids => ids.length ? { status: 'feasible', score: 150, coverage: 'complete' } : { status: 'not-runnable', reasonCode: 'no-members' } })];
    const options = { effectKeysFor: () => [] }, oracle = createOpportunityOracle(sources, options);
    const value = oracle(request);
    expect(value).toMatchObject({ status: 'known', gold: 200,
      displacements: [{ objectiveId: 'old-a', marginalGold: 100 }, { objectiveId: 'old-b', marginalGold: 100 }] });
    expect(createOpportunityOracle([...sources].reverse(), options)(request)).toEqual(value);
  });
});

it('uses a formal delay-loss upper bound for a committed assembly without treating its payoff lower bound as exact loss', () => {
  const window = valuationWindow(100);
  const bound = { targetId: 'island', gold: 30, continuationUpperGold: 100, window, mode: 'scenario-delay' as const,
    components: [{ code: 'known-path-delay', valueGold: 30, factIds: ['path'] }] };
  const source: BundleValuationSource = { id: 'assembly', objectiveId: 'island', unitIds: ['one', 'two'], effectKeys: ['island'],
    committed: true, quote: () => ({ status: 'feasible', score: 20, coverage: 'known-effects' }),
    assemblyDisplacement: remaining => { expect(remaining).toEqual(['two']); return { status: 'known', bound }; } };
  const oracle = createOpportunityOracle([source], { effectKeysFor: () => [] });
  expect(oracle({ objectiveId: 'defend', methodId: 'defend', unitIds: ['one'], window })).toMatchObject({ status: 'known', gold: 30,
    displacements: [{ objectiveId: 'island', marginalGold: 30, basis: 'assembly-delay-upper-bound', assemblyDelayUpperBound: bound }] });
  let payoffCalls = 0;
  const exactFill = createOpportunityOracle([{ ...source, quote: ids => { payoffCalls++;
    return { status: 'feasible', score: ids.length === 2 ? 100 : 90, coverage: 'complete' }; } }], { effectKeysFor: () => [] });
  expect(exactFill({ objectiveId: 'defend', methodId: 'defend', unitIds: ['one'], window })).toMatchObject({ status: 'known', gold: 30 });
  expect(payoffCalls).toBe(0); // Supply P=1 still does not authorize replacing the proved loss upper bound with 100−90.
  expect(createOpportunityOracle([{ ...source, assemblyDisplacement: () => ({ status: 'unknown', reasonCode: 'assembly-continuation-value-unknown' }) }],
    { effectKeysFor: () => [] })({ objectiveId: 'defend', methodId: 'defend', unitIds: ['one'], window })).toMatchObject({ status: 'unknown' });
});
