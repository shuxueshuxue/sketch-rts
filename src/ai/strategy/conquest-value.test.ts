import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { createAiPolicyMemory } from '../memory';
import { allocatedVoyageValue } from './allocated-voyage-value';
import type { AllocationMethodQuoteInput } from './allocation-types';
import { conquestFacts } from './conquest-facts';
import { conquestMethodProvider } from './conquest-methods';
import { valueConquestContinuation } from './conquest-value';
import { buildStrategyDecision } from './decision';
import { discountedMiningSegments } from './mining-forecast';
import { landIdAt } from './regions';
import { discountedValue } from './utility';

function setup() {
  let scene = sketchScene('conquest-cash-flow-continuation').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 2000 })
    .goldMine('new', 1400, 1400, 10000).townHall('us', 400, 400).townHall('foe', 4000, 4000)
    .worker('us', 1450, 1400, { id: 'engineer' });
  for (let n = 0; n < 5; n++) scene = scene.unit('us', 'emberRavager', 1450, 1400 + n * 10, { id: `guard-${n}` });
  const snapshot = snapshotGame(scene.build().createGame());
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const decision = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity);
  const target = { entityId: 'new', point: { x: 1400, y: 1400 }, landId: landIdAt(snapshot.map, { x: 1400, y: 1400 })! };
  const objective: AllocationMethodQuoteInput['objective'] = { id: 'new-site', kind: 'ConquerIsland', owner: 'us', target,
    effects: [{ kind: 'mining-established', mineId: 'new', completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'candidate', sinceTick: 0, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  const skeleton = conquestMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective, previous: null, executions: [], blocked: [] })[0]!;
  const input: AllocationMethodQuoteInput = { snapshot, situation: decision.situation, objective, method: skeleton, budgets: [], executions: [],
    unitIds: snapshot.units.filter(unit => unit.owner === 'us').map(unit => unit.id) };
  const method = conquestMethodProvider.materialize!(input), concrete = { ...input, method };
  const values = { method, facts: conquestFacts(concrete), voyages: allocatedVoyageValue(concrete), remainingOre: 10000,
    persistenceBonus: 0, realUnitIds: snapshot.units.map(unit => unit.id) };
  return { concrete, values };
}

describe('shared gross conquest continuation settlement', () => {
  it('is the full method gross utility and keeps one same-window opportunity charge outside it', () => {
    const { concrete, values } = setup(), before = JSON.stringify(values);
    const gross = conquestMethodProvider.quote(concrete);
    expect(gross.status).toBe('feasible');
    const settled = valueConquestContinuation(values);
    expect(settled.utility).toEqual(gross.utility);
    expect(settled.utility.cost.some(term => term.code === 'bundle-opportunity')).toBe(false);
    const net = conquestMethodProvider.quote({ ...concrete, valuation: { phase: 'net', opportunity: request => ({
      status: 'known', window: request.window, gold: 120, basis: 'no-positive-feasible-alternative', alternatives: [] }) } });
    expect(net.status).toBe('feasible');
    expect(net.utility!.score).toBeCloseTo(settled.utility.score - 120);
    expect(net.utility!.cost.filter(term => term.code === 'bundle-opportunity')).toEqual([{ code: 'bundle-opportunity', value: 120 }]);
    expect(JSON.stringify(values)).toBe(before);
    expect(valueConquestContinuation({ ...values, window: structuredClone(values.facts.window) })).toEqual(settled);
  });

  it('delays individual income and training cash flows within the same window', () => {
    const { values } = setup(), delayTicks = 400, window = values.facts.window;
    expect(values.facts.forecast.trainingGold).toBeGreaterThan(0);
    const delayed = valueConquestContinuation({ ...values, delayTicks });
    const income = discountedMiningSegments(values.facts.forecast.segments.map(segment => ({ ...segment,
      fromTicks: segment.fromTicks + delayTicks, untilTicks: segment.untilTicks + delayTicks })), values.remainingOre, window);
    expect(delayed.utility.benefit.find(term => term.code === 'staffed-island-income')!.value)
      .toBe(income * values.facts.siteRisk.survivalProbability!);
    expect(delayed.utility.benefit.find(term => term.code === 'mining-worker-recruitment')!.value)
      .toBe(-values.facts.forecast.training.reduce((sum, training) => sum + discountedValue(training.gold, training.startsInTicks + delayTicks, window), 0));
    expect(delayed.utility.benefit.find(term => term.code === 'staffed-island-income')!.value)
      .toBeLessThan(valueConquestContinuation(values).utility.benefit.find(term => term.code === 'staffed-island-income')!.value);
    const outside = valueConquestContinuation({ ...values, delayTicks: window.horizonTicks + 1 });
    expect(outside.utility.benefit.every(term => term.value === 0)).toBe(true);
    expect(outside.utility.cost.every(term => term.value === 0)).toBe(true);
  });

  it('keeps prototype casualty money while withholding a future job entity label', () => {
    const { values } = setup(), actual = values.facts.fighters[0]!, prototype = { ...actual, id: 'paid-job-assessment' };
    const loss = UNIT_DEFS[actual.kind].cost + UNIT_DEFS[prototype.kind].cost;
    const facts = { ...values.facts, fighters: [actual, prototype], battle: { ...values.facts.battle,
      attrition: { ...values.facts.battle.attrition, permanentDeadUnitIds: [actual.id, prototype.id], expectedLossGold: loss } } };
    const valued = valueConquestContinuation({ ...values, facts });
    const casualty = valued.utility.cost.find(term => term.code === 'clearing-attrition-after-force-arrival')!;
    expect(casualty.value).toBe(discountedValue(loss, facts.clearingUntilTicks, facts.window));
    expect(casualty.catalogUnitValues).toEqual([{ unitId: actual.id,
      valueGold: discountedValue(UNIT_DEFS[actual.kind].cost, facts.clearingUntilTicks, facts.window) }]);
    expect(valued.utility.cost.flatMap(term => term.catalogUnitValues ?? []).some(entry => entry.unitId === prototype.id)).toBe(false);
  });
});
