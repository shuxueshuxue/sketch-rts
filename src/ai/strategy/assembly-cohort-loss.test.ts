import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { createUnit } from '../../shared/map';
import { snapshotGame } from '../../shared/sim';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import type { AssemblyFactsRequest } from './assembly-facts';
import type { AssemblyAssessmentCohort } from './assembly-supply-reader';
import type { AllocationArrivalReader } from './allocation-arrival-query';
import { prepareAssemblyConquestContinuation } from './assembly-conquest-continuation';
import { adaptAssemblyDelayLoss } from './assembly-delay-adapter';
import { valueAssemblyCohortLoss, type AssemblyCohortLossScenario } from './assembly-cohort-loss';
import { conquestMethodProvider } from './conquest-methods';
import { valueConquestContinuation } from './conquest-value';
import { buildStrategyDecision } from './decision';
import { landIdAt } from './regions';
import { quoteOpportunityCost, valuationWindow } from './utility';

/** Original six-to-five native scene and fixed Arrival facts from the independent
 * audit. This verifies conditional quotation, not a natural grant or battle. */
function fixture(enemy = false) {
  let scene = sketchScene('assembly-conquest-path-preparation').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 2000 })
    .townHall('us', 400, 400).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 700, 600, { id: 'producer' })
    .goldMine('new', 1400, 1400, 10000).worker('us', 1450, 1400, { id: 'engineer' })
    .unit('us', 'emberRavager', 800, 1000, { id: 'ungranted' })
    .unit('neutral', 'ogreWarrior', 1400, 1400, { id: 'guard' });
  for (let i = 0; i < 6; i++) scene = scene.unit('us', 'emberRavager', 950, 950 + i * 10, { id: `member-${i}` });
  if (enemy) scene = scene.unit('foe', 'footman', 2200, 1400, { id: 'foe-member' });
  const snapshot = snapshotGame(scene.build().createGame());
  snapshot.players.us!.supplyCap = 100;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  snapshot.buildings.find(building => building.id === 'producer')!.queue = [
    { id: 'consumed', unitKind: 'footman', remaining: 100 }, { id: 'remaining', unitKind: 'footman', remaining: 500 }];
  const situation = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity).situation;
  const target = { entityId: 'new', point: { x: 1400, y: 1400 }, landId: landIdAt(snapshot.map, { x: 1400, y: 1400 })! };
  const objective: AssemblyFactsRequest['objective'] = { id: 'conquest', kind: 'ConquerIsland', owner: 'us', target,
    effects: [{ kind: 'mining-established', mineId: 'new', completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'candidate', sinceTick: 0, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  const skeleton = conquestMethodProvider.buildMethods({ snapshot, situation, objective, previous: null, executions: [], blocked: [] })[0]!;
  const unitIds = snapshot.units.filter(unit => unit.id.startsWith('member-')).map(unit => unit.id);
  const post = { id: 'home', target: { point: { x: 1000, y: 1000 }, landId: target.landId }, unitIds };
  const request: AssemblyFactsRequest = { objective, methodId: skeleton.id, campTarget: target, requiredForce: 1,
    posts: [post], unitIds, responseEligibleUnitIds: ['engineer'], valuation: { phase: 'gross', window: valuationWindow(2000) } };
  const units = snapshot.units.filter(unit => unitIds.includes(unit.id)).map(unit => ({ ...unit, x: 1000, y: 1000 }));
  const prototype = { ...createUnit('assembly-assessment:paid:producer:consumed', 'us', 'footman', 1000, 1000), hp: 30 };
  const cohort: AssemblyAssessmentCohort = { pathId: 'path-one', readyTick: snapshot.tick + 200,
    units: [...units, prototype], realUnitIds: unitIds, sourceFactIds: [...unitIds, 'producer', 'consumed'], missing: [] };
  const arrival = vi.fn<AllocationArrivalReader>(unit => ({ status: 'reachable',
    ticks: unit.owner === 'foe' ? 300 : unit.kind === 'worker' ? 20 : 100,
    landTicks: unit.owner === 'foe' ? 300 : unit.kind === 'worker' ? 20 : 100, crossings: [] }));
  return { snapshot, situation, request, cohort, skeleton, arrival, budgets: [], executions: [] };
}

function paired() {
  const input = fixture(), ids = input.request.unitIds, remaining = ids.slice(0, -1), real = new Set(ids);
  const beforeCohort = { ...input.cohort, pathId: 'certain-supply', readyTick: input.snapshot.tick,
    units: input.cohort.units.filter(unit => real.has(unit.id)), realUnitIds: ids };
  const afterCohort = { ...beforeCohort, units: beforeCohort.units.filter(unit => remaining.includes(unit.id)), realUnitIds: remaining };
  const before = prepareAssemblyConquestContinuation({ ...input, cohort: beforeCohort });
  const after = prepareAssemblyConquestContinuation({ ...input, request: { ...input.request, unitIds: remaining }, cohort: afterCohort });
  expect(before.settlement).not.toBeNull(); expect(after.settlement).not.toBeNull();
  const path: AssemblyCohortLossScenario = { pathId: 'certain-supply', probability: 1,
    before: { status: 'ready', tick: 0 }, after: { status: 'ready', tick: 0 },
    beforeSettlement: before.settlement!, afterSettlement: after.settlement! };
  return { forecastTick: 0, window: input.request.valuation!.window!, valueCapGold: 833.1630998625288,
    capFactIds: ['new'], scenarios: [path], path, preparation: input };
}

describe('paired assembly cohort continuation losses', () => {
  it('prices the original same-ready six-to-five counterexample at 5.302343 rather than zero or whole cap', () => {
    const { path, preparation, ...input } = paired(), saved = structuredClone(input);
    const value = valueAssemblyCohortLoss(input), before = valueConquestContinuation(path.beforeSettlement!);
    const after = valueConquestContinuation(path.afterSettlement!);
    expect(before.battleProbability).toBeCloseTo(.965242027678565, 13);
    expect(after.battleProbability).toBeCloseTo(.9507024522886348, 13);
    expect(before.utility.score).toBeCloseTo(282.3379172514515, 10);
    expect(after.utility.score).toBeCloseTo(277.03557440745027, 10);
    expect(value.lossUpperGold).toBeCloseTo(5.302342844001203, 10);
    expect(value.paths[0]).toMatchObject({ basis: 'continuation-difference', beforeContinuationGold: before.utility.score,
      afterContinuationGold: after.utility.score, signedDifferenceGold: before.utility.score - after.utility.score });
    expect(value.paths[0]!.components.some(term => term.differenceGold < 0)).toBe(true);
    expect(value.reason.values.fallbackPaths).toBe(0);
    const adapted = adaptAssemblyDelayLoss('new', value);
    expect(adapted).toMatchObject({ status: 'known', bound: { gold: value.lossUpperGold, mode: 'scenario-continuation' } });
    if (adapted.status !== 'known') throw new Error(adapted.reasonCode);
    expect(adapted.bound.components.reduce((sum, term) => sum + term.valueGold, 0)).toBe(adapted.bound.gold);
    expect(quoteOpportunityCost(input.window, [{ objectiveId: 'conquest', committed: true, unitIds: ['member-5'],
      withResourcesGold: adapted.bound.gold, withoutResourcesGold: null, withoutResourcesStatus: 'unknown',
      assemblyDelayUpperBound: adapted.bound }])).toMatchObject({ status: 'known', gold: value.lossUpperGold });
    expect(input).toEqual(saved); expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    expect(value).not.toHaveProperty('snapshot'); expect(adapted.bound).not.toHaveProperty('paths');
  });

  it('combines signed changes under the same joint weights before taking a nonnegative loss', () => {
    const { path, preparation, ...input } = paired();
    const gain = { ...path, pathId: 'gain', probability: .25, beforeSettlement: path.afterSettlement, afterSettlement: path.beforeSettlement };
    const loss = { ...path, pathId: 'loss', probability: .75 };
    const result = valueAssemblyCohortLoss({ ...input, scenarios: [loss, gain] });
    const difference = valueConquestContinuation(path.beforeSettlement!).utility.score - valueConquestContinuation(path.afterSettlement!).utility.score;
    expect(result.lossUpperGold).toBeCloseTo(.5 * difference, 12);
    expect(result.paths[0]!.weightedDifferenceGold).toBeLessThan(0);
    expect(valueAssemblyCohortLoss({ ...input, scenarios: [gain, loss] })).toEqual(result);
    expect(valueAssemblyCohortLoss({ ...input, scenarios: [{ ...gain, probability: 1 }] }).lossUpperGold).toBe(0);
  });

  it('reintegrates each side at its own ready time without discounting an integrated score', () => {
    const { path, preparation, ...input } = paired();
    const later = prepareAssemblyConquestContinuation({ ...preparation, request: { ...preparation.request, unitIds: preparation.request.unitIds.slice(0, -1) },
      cohort: { ...preparation.cohort, pathId: 'late', readyTick: 400,
        units: preparation.cohort.units.filter(unit => preparation.request.unitIds.slice(0, -1).includes(unit.id)),
        realUnitIds: preparation.request.unitIds.slice(0, -1) } });
    expect(later.settlement).not.toBeNull();
    const result = valueAssemblyCohortLoss({ ...input, scenarios: [{ ...path, after: { status: 'ready', tick: 400 }, afterSettlement: later.settlement }] });
    expect(result.lossUpperGold).toBeCloseTo(Math.max(0, valueConquestContinuation(path.beforeSettlement!).utility.score
      - valueConquestContinuation(later.settlement!).utility.score), 12);
    expect(result.paths[0]!.basis).toBe('continuation-difference');
  });

  it('falls back only for unpriced probability mass and exposes its amount separately', () => {
    const { path, preparation, ...input } = paired(), cap = 100;
    const result = valueAssemblyCohortLoss({ ...input, valueCapGold: cap, scenarios: [{ ...path, pathId: 'known', probability: .5 },
      { ...path, pathId: 'unresolved', probability: .5, afterSettlement: null }] });
    const loss = valueConquestContinuation(path.beforeSettlement!).utility.score - valueConquestContinuation(path.afterSettlement!).utility.score;
    expect(result.lossUpperGold).toBeCloseTo(.5 * loss + .5 * cap, 12);
    expect(result.reason.values).toMatchObject({ fallbackPaths: 1, fallbackProbability: .5 });
    expect(result.paths[1]).toMatchObject({ basis: 'full-cap', weightedDifferenceGold: 50,
      reason: { code: 'assembly-cohort-after-settlement-unquoted' } });
    expect(adaptAssemblyDelayLoss('new', result)).toMatchObject({ status: 'known', bound: { mode: 'whole-value-cap' } });
    expect(valueAssemblyCohortLoss({ ...input, scenarios: [{ ...path, beforeSettlement: null, afterSettlement: null }] }))
      .toMatchObject({ lossUpperGold: input.valueCapGold, reason: { values: { fallbackProbability: 1 } } });
  });

  it('distinguishes known no-fill from unknown continuation and preserves gains', () => {
    const { path, preparation, ...input } = paired(), before = valueConquestContinuation(path.beforeSettlement!).utility.score;
    const noFill = valueAssemblyCohortLoss({ ...input, scenarios: [{ ...path, after: { status: 'not-filled' }, afterSettlement: null }] });
    expect(noFill.lossUpperGold).toBe(before); expect(noFill.paths[0]!.afterContinuationGold).toBe(0);
    expect(noFill.reason.values.fallbackPaths).toBe(0);
    expect(valueAssemblyCohortLoss({ ...input, scenarios: [{ ...path, before: { status: 'not-filled' }, beforeSettlement: null }] }))
      .toMatchObject({ lossUpperGold: 0, reason: { values: { fallbackPaths: 0 } } });
    expect(valueAssemblyCohortLoss({ ...input, scenarios: [{ ...path, after: { status: 'unknown' } }] }))
      .toMatchObject({ lossUpperGold: input.valueCapGold, paths: [{ basis: 'full-cap' }] });
  });

  it('does not convert missing cap, stale epochs, different windows or invalid money into a known zero', () => {
    const { path, preparation, ...input } = paired();
    expect(valueAssemblyCohortLoss({ ...input, valueCapGold: null })).toMatchObject({ status: 'unknown', lossUpperGold: null });
    for (const changed of [
      { ...path.afterSettlement!, delayTicks: 100 },
      { ...path.afterSettlement!, window: valuationWindow(1000) },
      { ...path.afterSettlement!, facts: { ...path.afterSettlement!.facts, unknown: [{ code: 'risk-pending', ids: ['ship'] }] } },
      { ...path.afterSettlement!, facts: { ...path.afterSettlement!.facts, forecast: { ...path.afterSettlement!.facts.forecast, incomeGold: NaN } } },
    ]) expect(valueAssemblyCohortLoss({ ...input, scenarios: [{ ...path, afterSettlement: changed }] }))
      .toMatchObject({ lossUpperGold: input.valueCapGold, paths: [{ basis: 'full-cap' }] });
    expect(valueAssemblyCohortLoss({ ...input, forecastTick: 1 })).toMatchObject({ lossUpperGold: input.valueCapGold });
    expect(valueAssemblyCohortLoss({ ...input, scenarios: [] })).toMatchObject({ lossUpperGold: input.valueCapGold });
    expect(valueAssemblyCohortLoss({ ...input, scenarios: [{ ...path, probability: .5 }] })).toMatchObject({ lossUpperGold: input.valueCapGold });
    expect(valueAssemblyCohortLoss({ ...input, scenarios: Array.from({ length: 65 }, (_, i) => ({ ...path, pathId: String(i), probability: 1 / 65 })) }))
      .toMatchObject({ lossUpperGold: input.valueCapGold });
  });

  it('caps the final value with an exact bound sum and leaves zero-mass missing paths irrelevant', () => {
    const { path, preparation, ...input } = paired();
    const result = valueAssemblyCohortLoss({ ...input, valueCapGold: 1,
      scenarios: [path, { ...path, pathId: 'zero', probability: 0, beforeSettlement: null, afterSettlement: null }] });
    expect(result.lossUpperGold).toBe(1); expect(result.uncappedLossUpperGold).toBeGreaterThan(1);
    expect(result.paths[1]!.basis).toBe('no-delay');
    expect(result.components.reduce((sum, term) => sum + term.valueGold, 0)).toBe(1);
    expect(adaptAssemblyDelayLoss('new', result)).toMatchObject({ status: 'known', bound: { mode: 'whole-value-cap', gold: 1 } });
  });
});
