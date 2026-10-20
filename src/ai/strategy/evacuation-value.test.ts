import { expect, it } from 'vitest';
import type { AllocationMethodQuoteInput } from './allocation-types';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { landIdAt } from './regions';
import { defenseMethodProvider } from './defense-methods';
import { discountedValue, valuationWindow } from './utility';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';

// Synthetic quotation-level facts only. This does not claim a native route or
// measured behavior: it tests additive rescued-asset accounting with known risks.
function rescueInput(): AllocationMethodQuoteInput {
const snapshot = snapshotGame(sketchScene('rescue-two-independent-hulls').map('bareDuel').replaceDefaults().player('us')
  .building('us', 'townHall', 1200, 1200, { id: 'source' })
  .building('us', 'townHall', 2400, 2400, { id: 'shelter' })
  .unit('us', 'worker', 1200, 1500, { id: 'worker-a' })
  .unit('us', 'worker', 1200, 1550, { id: 'worker-b' })
  .unit('us', 'transport', 1300, 1600, { id: 'ship-a' })
  .unit('us', 'transport', 1400, 1600, { id: 'ship-b' }).build().createGame());
setBuildingBodies(snapshot.map, standingBodies(snapshot));
const target = (id: string) => {
  const entity = snapshot.buildings.find(building => building.id === id)!;
  return { entityId: id, landId: landIdAt(snapshot.map, entity)!, point: { x: entity.x, y: entity.y } };
};
const from = target('source'), refuge = target('shelter'), goalId = 'rescue', methodId = 'rescue/evacuation', actionId = 'rescue/evacuate';
const arrival = { status: 'reachable', ticks: 100, landTicks: 100, crossings: [] };
const situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, seas: [], opportunities: [], limitations: [],
  economy: { cashGold: 1000, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] },
  units: snapshot.units.map(unit => ({ id: unit.id, owner: unit.owner, kind: unit.kind, hp: unit.hp, maxHp: unit.maxHp,
    location: { kind: 'land', landId: from.landId, point: { x: unit.x, y: unit.y } }, strength: 0,
    roles: [unit.kind === 'worker' ? 'worker' : 'transport'], expiresTick: null, commitments: [],
    arrivals: [{ targetId: actionId, arrival }] })),
  assets: snapshot.buildings.map(building => ({ id: building.id, owner: 'us', kind: 'hall', target: target(building.id),
    hp: building.hp, complete: true, replacementGold: 400, remainingGold: 0, incomeGoldPerTick: 0, discountedValueGold: 400 })),
  lands: [{ id: from.landId, anchor: from.point, assetIds: ['source', 'shelter'], unitIds: snapshot.units.map(unit => unit.id), adjacentSeaIds: [], threats: [] }] };
const objective = { id: goalId, kind: 'Evacuate', owner: 'us', target: from,
  effects: [{ kind: 'assets-evacuated', unitIds: ['worker-a', 'worker-b'], destination: refuge }],
  utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
  status: 'candidate', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [],
  stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } };
const method = { id: methodId, objectiveId: goalId, providerId: defenseMethodProvider.id, preference: 0, kind: 'evacuation',
  actions: [{ id: actionId, executor: 'strategy.evacuate', intent: { kind: 'evacuate' }, target: refuge, unitIds: ['worker-a', 'worker-b'],
    dependsOn: [], demands: [], spendIds: [], completionEffects: objective.effects }], demands: [], preconditions: [], subgoals: [], spends: [],
  estimatedTicks: 100, status: 'candidate', reasons: [],
  voyagePlans: ['a', 'b'].map(suffix => ({ id: `voyage-${suffix}`, actionId: 'deliver', ship: { kind: 'existing', unitId: `ship-${suffix}` },
    unitIds: [`worker-${suffix}`], departure: { point: from.point, seaId: 'sea:1' }, destination: { ...refuge, seaId: 'sea:1' },
    departureGround: from, landingGround: refuge, crossing: { seaId: 'sea:1', shipId: `ship-${suffix}`, requiresNewShip: false }, required: true })) };
(method.actions as unknown as Record<string, unknown>[]).unshift({ id: 'deliver', executor: 'strategy.transport', intent: { kind: 'deliver-workers' }, target: refuge,
  unitIds: ['worker-a', 'worker-b'], dependsOn: [], demands: [], spendIds: [], completionEffects: [] });
(method.actions.at(-1)! as { dependsOn: string[] }).dependsOn = ['deliver'];
const safe = { status: 'known', survivalProbability: 1, expectedDamage: 0, expectedHpLoss: 0, damageErrorBound: 0,
  samples: 0, totalSamples: 0, computedTick: snapshot.tick, basis: 'native-route-exposure', threatIds: [] };
const input = { snapshot, situation, objective, method, unitIds: ['worker-a', 'worker-b', 'ship-a', 'ship-b'], budgets: [], executions: [],
  responseEligibleUnitIds: [], voyageRisks: new Map(['a', 'b'].map(suffix => [`voyage-${suffix}`, { approach: safe, loaded: { ...safe, survivalProbability: .8 } }])) };

return input as unknown as AllocationMethodQuoteInput;
}

it('adds each independent rescue arrival rather than requiring both hulls to survive', () => {
  const input = rescueInput(), before = JSON.stringify(input), quote = defenseMethodProvider.quote(input);
  expect(quote.status).toBe('feasible'); if (quote.status !== 'feasible') return;
  const window = valuationWindow(100);
  expect(quote.utility.successProbability * quote.utility.benefit.reduce((sum, term) => sum + term.value, 0))
    .toBeCloseTo(discountedValue(2 * .8 * 75, 100, window));
  expect(quote.utility.cost.find(term => term.code === 'voyage-hull-and-passengers')!.value)
    .toBeCloseTo(discountedValue(2 * .2 * 240, 100, window));
  expect(quote.utility.score).toBeCloseTo(discountedValue(24, 100, window));
  expect(JSON.stringify(input)).toBe(before);
});

it('uses both legs for shore waiters and independent certainty for people already at the shelter', () => {
  const input = rescueInput(), risks = new Map(input.voyageRisks!);
  const first = risks.get('voyage-a')!;
  risks.set('voyage-a', { ...first, approach: { ...first.approach, status: 'known', survivalProbability: .5 } as typeof first.approach });
  const partial = defenseMethodProvider.quote({ ...input, voyageRisks: risks });
  expect(partial.status).toBe('feasible'); if (partial.status !== 'feasible') return;
  expect(partial.utility.successProbability).toBeCloseTo((.5 * .8 + .8) / 2);
  const refuge = input.method.actions.at(-1)!.target;
  const situation = { ...input.situation, units: input.situation.units.map(unit => unit.id === 'worker-b'
    ? { ...unit, location: { kind: 'land' as const, landId: refuge.landId!, point: refuge.point } } : unit) };
  const snapshot = { ...input.snapshot, units: input.snapshot.units.map(unit => unit.id === 'worker-b'
    ? { ...unit, x: refuge.point.x, y: refuge.point.y } : unit) };
  const arrived = defenseMethodProvider.quote({ ...input, snapshot, situation, voyageRisks: risks });
  expect(arrived.status).toBe('feasible'); if (arrived.status !== 'feasible') return;
  expect(arrived.utility.successProbability).toBeCloseTo((.5 * .8 + 1) / 2);
});
