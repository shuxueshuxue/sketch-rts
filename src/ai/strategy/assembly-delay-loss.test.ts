import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { allocatedVoyageValue } from './allocated-voyage-value';
import type { AllocationMethodQuoteInput } from './allocation-types';
import { valueAssemblyDelayLoss, type AssemblyDelayScenario } from './assembly-delay-loss';
import { conquestFacts } from './conquest-facts';
import { conquestMethodProvider } from './conquest-methods';
import { valueConquestContinuation } from './conquest-value';
import { buildStrategyDecision } from './decision';
import { landIdAt } from './regions';
import { discountedValue } from './utility';

/** Native scene facts provide an actual shared cash-flow schedule. These tests
 * exercise monetary bounds only, not a natural grant or a physical preemption. */
function example() {
  let scene = sketchScene('assembly-delay-cash-flows').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 2000 })
    .goldMine('new', 1400, 1400, 10000).townHall('us', 400, 400).townHall('foe', 4000, 4000)
    .worker('us', 1450, 1400, { id: 'engineer' });
  for (let index = 0; index < 5; index++) scene = scene.unit('us', 'emberRavager', 1450, 1400 + index * 10, { id: `guard-${index}` });
  const snapshot = snapshotGame(scene.build().createGame());
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const decision = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity);
  const objective: AllocationMethodQuoteInput['objective'] = { id: 'conquest', kind: 'ConquerIsland', owner: 'us',
    target: { entityId: 'new', point: { x: 1400, y: 1400 }, landId: landIdAt(snapshot.map, { x: 1400, y: 1400 })! },
    effects: [{ kind: 'mining-established', mineId: 'new', completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'candidate', sinceTick: 0, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  const skeleton = conquestMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective,
    previous: null, executions: [], blocked: [] })[0]!;
  const input: AllocationMethodQuoteInput = { snapshot, situation: decision.situation, objective, method: skeleton,
    budgets: [], executions: [], unitIds: snapshot.units.filter(unit => unit.owner === 'us').map(unit => unit.id) };
  const method = conquestMethodProvider.materialize!(input), concrete = { ...input, method }, facts = conquestFacts(concrete);
  const plan = { readyTick: 100, coverage: 'complete' as const, input: { facts, method, voyages: allocatedVoyageValue(concrete),
    remainingOre: 10000, persistenceBonus: 0, realUnitIds: snapshot.units.map(unit => unit.id) } };
  const path = (pathId: string, probability: number, tick: number): AssemblyDelayScenario => ({ pathId, probability,
    before: { status: 'ready', tick: 100 }, after: { status: 'ready', tick }, plan });
  return { forecastTick: 0, window: facts.window, valueCapGold: 10000, capFactIds: ['new'], scenarios: [path('one', 1, 500)], path };
}

describe('formal assembly delay monetary loss upper bounds', () => {
  it('reintegrates original cash flows in the same window and ignores deferred-payment savings', () => {
    const { path, ...input } = example(), beforeInput = JSON.stringify(input), result = valueAssemblyDelayLoss(input);
    expect(result.status).toBe('known'); expect(result.paths[0]!.basis).toBe('cash-flow-delay');
    const plan = input.scenarios[0]!.plan!.input;
    const before = valueConquestContinuation(plan).utility, after = valueConquestContinuation({ ...plan, delayTicks: 400 }).utility;
    const income = result.paths[0]!.components.find(component => component.code === 'staffed-island-income')!;
    expect(income.beforePresentGold).toBe(before.benefit[0]!.value * before.successProbability);
    expect(income.afterPresentGold).toBe(after.benefit[0]!.value * after.successProbability);
    expect(income.lossUpperGold).toBeGreaterThan(0);
    const training = result.paths[0]!.components.find(component => component.code === 'mining-worker-recruitment')!;
    expect(training.differenceGold).toBeLessThan(0); expect(training.lossUpperGold).toBe(0);
    expect(result.lossUpperGold!).toBeGreaterThanOrEqual(Math.max(0, before.score - after.score));
    expect(result.lossUpperGold).not.toBeCloseTo(before.score - discountedValue(before.score, 400, input.window), 6);
    expect(result.components.reduce((sum, component) => sum + component.valueGold, 0)).toBe(result.lossUpperGold);
    expect(JSON.stringify(input)).toBe(beforeInput);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('pairs each scenario time before summing rather than using one mean delay', () => {
    const { path, ...input } = example();
    const paths = [path('fast', .25, 200), path('slow', .75, 1100)];
    const result = valueAssemblyDelayLoss({ ...input, scenarios: paths });
    const fast = valueAssemblyDelayLoss({ ...input, scenarios: [path('fast', 1, 200)] });
    const slow = valueAssemblyDelayLoss({ ...input, scenarios: [path('slow', 1, 1100)] });
    expect(result.lossUpperGold).toBeCloseTo(.25 * fast.lossUpperGold! + .75 * slow.lossUpperGold!);
    const mean = valueAssemblyDelayLoss({ ...input, scenarios: [path('mean', 1, .25 * 200 + .75 * 1100)] });
    expect(result.lossUpperGold).not.toBeCloseTo(mean.lossUpperGold!, 6);
    expect(valueAssemblyDelayLoss({ ...input, scenarios: [...paths].reverse() })).toEqual(result);
  });

  it('uses the explicit whole cap for unresolved tails and distinguishes known no-fill before removal', () => {
    const { path, ...input } = example(), cap = 1000;
    const result = valueAssemblyDelayLoss({ ...input, valueCapGold: cap, scenarios: [path('known', .5, 200),
      { ...path('tail', .5, 200), after: { status: 'unknown' } }] });
    expect(result.status).toBe('known'); expect(result.lossUpperGold).toBeLessThanOrEqual(cap);
    expect(result.paths.find(path => path.pathId === 'tail')).toMatchObject({ basis: 'full-cap', lossUpperGold: cap,
      weightedLossUpperGold: 500, reason: { code: 'assembly-delay-after-unquoted' } });
    const priorNoFill = valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('no-fill', 1, 200), before: { status: 'not-filled' } }] });
    expect(priorNoFill).toMatchObject({ status: 'known', lossUpperGold: 0, paths: [{ basis: 'no-prior-fill' }] });
    const unknownBefore = valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('tail', 1, 200), before: { status: 'unknown' } }] });
    expect(unknownBefore).toMatchObject({ status: 'known', lossUpperGold: input.valueCapGold });
  });

  it('keeps missing money unknown but lets a proven finite cap replace missing or incomplete cash plans', () => {
    const { path, ...input } = example();
    expect(valueAssemblyDelayLoss({ ...input, valueCapGold: null })).toMatchObject({ status: 'unknown', lossUpperGold: null,
      reason: { code: 'assembly-delay-value-cap-unquoted' } });
    expect(valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('missing', 1, 500), plan: null }] }))
      .toMatchObject({ status: 'known', lossUpperGold: input.valueCapGold, paths: [{ reason: { code: 'assembly-delay-cash-flows-unquoted' } }] });
    const partial = { ...input.scenarios[0]!.plan!, coverage: 'known-effects' as const };
    expect(valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('partial', 1, 500), plan: partial }] }))
      .toMatchObject({ status: 'known', lossUpperGold: input.valueCapGold, paths: [{ reason: { code: 'assembly-delay-cash-flows-incomplete' } }] });
  });

  it('caps the recomputed loss and returns a usable cap when scenario or timing facts are absent', () => {
    const { path, ...input } = example();
    const wholePlanValue = valueConquestContinuation(input.scenarios[0]!.plan!.input).utility.score;
    const smallCap = valueAssemblyDelayLoss({ ...input, valueCapGold: wholePlanValue,
      scenarios: [path('outside-window', 1, 100 + input.window.horizonTicks + 1)] });
    expect(wholePlanValue).toBeGreaterThan(0);
    expect(smallCap).toMatchObject({ status: 'known', lossUpperGold: wholePlanValue });
    expect(smallCap.paths[0]!.rawLossUpperGold).toBeGreaterThan(wholePlanValue);
    expect(valueAssemblyDelayLoss({ ...input, scenarios: [] })).toMatchObject({ status: 'known', lossUpperGold: input.valueCapGold,
      reason: { code: 'assembly-delay-scenarios-unquoted' } });
    expect(valueAssemblyDelayLoss({ ...input, scenarios: Array.from({ length: 65 }, (_, i) => path(`path-${i}`, 1 / 65, 500)) }))
      .toMatchObject({ status: 'known', lossUpperGold: input.valueCapGold, reason: { code: 'assembly-delay-scenario-limit' } });
    const afterWindow = valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('late', 1, 500), after: { status: 'not-filled' } }] });
    expect(afterWindow).toMatchObject({ status: 'known', lossUpperGold: input.valueCapGold });
    expect(afterWindow.paths[0]!.reason.code).toBe('assembly-delay-after-window-not-filled');
  });

  it('preserves zero delay and actual schedules despite a missing or irrelevant future plan', () => {
    const { path, ...input } = example();
    const result = valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('same', .5, 100), plan: null },
      { ...path('earlier', .5, 50), plan: null }, { ...path('zero-mass', 0, 500), plan: null }] });
    expect(result).toMatchObject({ status: 'known', lossUpperGold: 0 });
    expect(result.paths.every(path => path.basis === 'no-delay')).toBe(true);
    const laterPlan = { ...input.scenarios[0]!.plan!, readyTick: 200 };
    expect(valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('mismatched', 1, 500), plan: laterPlan }] }).paths[0]!.reason.code)
      .toBe('assembly-delay-plan-epoch-mismatch');
  });

  it('uses the proven cap when a purported complete monetary schedule is nonfinite instead of turning it into zero', () => {
    const { path, ...input } = example(), source = input.scenarios[0]!.plan!;
    const invalid = { ...source, input: { ...source.input, facts: { ...source.input.facts,
      forecast: { ...source.input.facts.forecast, incomeGold: NaN } } } };
    const result = valueAssemblyDelayLoss({ ...input, scenarios: [{ ...path('invalid-money', 1, 500), plan: invalid }] });
    expect(result).toMatchObject({ status: 'known', lossUpperGold: input.valueCapGold,
      paths: [{ basis: 'full-cap', reason: { code: 'assembly-delay-cash-flow-evaluation-unquoted' } }] });
  });
});
