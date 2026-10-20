import { describe, expect, it } from 'vitest';
import { createOpportunityOracle, type BundleValuationSource } from './opportunity-oracle';
import { valuationWindow } from './utility';

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
});
