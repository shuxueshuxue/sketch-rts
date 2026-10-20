import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildStrategyDecision } from './decision';
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
const snapshot = snapshotGame(sketchScene('rescue-two-independent-hulls').map('bareDuel').replaceDefaults().player('us').player('foe')
  .building('us', 'townHall', 1200, 1200, { id: 'source' })
  .building('us', 'townHall', 2400, 2400, { id: 'shelter' })
  .unit('us', 'worker', 1200, 1500, { id: 'worker-a' })
  .unit('us', 'worker', 1200, 1550, { id: 'worker-b' })
  .unit('us', 'transport', 1300, 1600, { id: 'ship-a' })
  .unit('us', 'transport', 1400, 1600, { id: 'ship-b' })
  .unit('foe', 'footman', 1550, 1200, { id: 'threat' }).build().createGame());
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
    roles: [unit.kind === 'worker' ? 'worker' : unit.kind === 'footman' ? 'frontline' : 'transport'], expiresTick: null, commitments: [],
    arrivals: [{ targetId: actionId, arrival }] })),
  assets: snapshot.buildings.map(building => ({ id: building.id, owner: 'us', kind: 'hall', target: target(building.id),
    hp: building.hp, complete: true, replacementGold: 400, remainingGold: 0, incomeGoldPerTick: 0, discountedValueGold: 400 })),
  lands: [{ id: from.landId, anchor: from.point, assetIds: ['source', 'shelter'], unitIds: snapshot.units.map(unit => unit.id), adjacentSeaIds: [], threats: [{ siteId: from.entityId,
    horizonTicks: 2400, arrivedStrength: 1, incomingStrength: 0, friendlyOnStationStrength: 0, firstArrivalTicks: 0, lossProbability: 1,
    attackers: [{ unitId: 'threat', arrival: { ...arrival, ticks: 0 }, strength: 1,
      intent: { kind: 'actual-intrusion', actualSiteId: from.entityId, redirectGroupId: 'threat', basis: 'hostile-presence' } }] }] }] };
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

function safeOrigin(input: AllocationMethodQuoteInput): AllocationMethodQuoteInput {
  return { ...input, snapshot: { ...input.snapshot, units: input.snapshot.units.filter(unit => unit.id !== 'threat') },
    situation: { ...input.situation, units: input.situation.units.filter(unit => unit.id !== 'threat'),
      lands: input.situation.lands.map(land => ({ ...land, unitIds: land.unitIds.filter(id => id !== 'threat'),
        threats: land.threats.map(threat => ({ ...threat, attackers: [], arrivedStrength: 0, incomingStrength: 0,
          firstArrivalTicks: null, lossProbability: 0 })) })) } };
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
  expect(partial.reason.values.rescueArrivalProbability).toBeCloseTo((.5 * .8 + .8) / 2);
  const refuge = input.method.actions.at(-1)!.target;
  const situation = { ...input.situation, units: input.situation.units.map(unit => unit.id === 'worker-b'
    ? { ...unit, location: { kind: 'land' as const, landId: refuge.landId!, point: refuge.point } } : unit) };
  const snapshot = { ...input.snapshot, units: input.snapshot.units.map(unit => unit.id === 'worker-b'
    ? { ...unit, x: refuge.point.x, y: refuge.point.y } : unit) };
  const arrived = defenseMethodProvider.quote({ ...input, snapshot, situation, voyageRisks: risks });
  expect(arrived.status).toBe('feasible'); if (arrived.status !== 'feasible') return;
  expect(arrived.reason.values.rescueArrivalProbability).toBeCloseTo((.5 * .8 + 1) / 2);
});

it('gives no saving gain to the already safe idle worker in the real gull 3630 frame', () => {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/gullIsland-control-3630.json.gz', import.meta.url))).toString());
  const snapshot = frame.snapshot as AllocationMethodQuoteInput['snapshot'];
  const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-1012')!;
  expect(worker.order.type).toBe('idle');
  expect(snapshot.buildings.find(building => building.id === 'building-p0-townHall-1167')?.complete).toBe(true);
  const decision = buildStrategyDecision(snapshot, frame.owner, { memory: frame.memory });
  const situation = frame.quoteSituation as AllocationMethodQuoteInput['situation'];
  expect(frame.quoteFactsReceipt.matchesOriginalContinuousThink).toBe(true);
  const objective = decision.objectives.find(objective => objective.id === 'DefendSite:p0:building-p0-townHall-1167')!;
  const method = defenseMethodProvider.buildMethods({ snapshot, situation, objective,
    previous: null, executions: [], blocked: [] }).find(method => method.kind === 'evacuation')!;
  const quote = defenseMethodProvider.quote({ snapshot, situation, objective, method,
    unitIds: [worker.id], budgets: [], executions: [], responseEligibleUnitIds: [] });
  expect(quote.status).toBe('feasible'); if (quote.status !== 'feasible') return;
  expect(quote.utility.score).toBeLessThanOrEqual(0);
  expect(quote.reason.values.inPlaceSurvivalProbability).toBe(1);
  expect(snapshot.units.find(unit => unit.id === worker.id)!.order.type).toBe('idle');
});

it('keeps a negative survival delta when evacuation is riskier than staying', () => {
  const input = safeOrigin(rescueInput());
  const quote = defenseMethodProvider.quote(input);
  expect(quote.status).toBe('feasible'); if (quote.status !== 'feasible') return;
  expect(quote.reason.values.inPlaceSurvivalProbability).toBe(1);
  expect(quote.utility.benefit[0]!.value).toBeCloseTo(discountedValue(150 * (.8 - 1), 100, valuationWindow(100)));
  expect(quote.utility.score).toBeLessThan(0);
});

it('charges the whole-bundle work opportunity even when a safe walk gains no survival', () => {
  const input = safeOrigin(rescueInput());
  const quote = defenseMethodProvider.quote({ ...input, unitIds: ['worker-a', 'worker-b'],
    method: { ...input.method, voyagePlans: [] }, valuation: { phase: 'net', opportunity: request => ({ status: 'known',
      gold: 10, basis: 'feasible-bundle-quotes', alternatives: [], window: request.window }) } });
  expect(quote.status).toBe('feasible'); if (quote.status !== 'feasible') return;
  expect(quote.utility.benefit[0]!.value).toBe(0);
  expect(quote.utility.score).toBe(-10);
});

it('keeps unknown original-site enemy arrivals instead of turning them into zero threat', () => {
  const input = rescueInput(), situation = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land,
    threats: land.threats.map(threat => ({ ...threat, attackers: threat.attackers.map(attacker => ({ ...attacker,
      arrival: { status: 'unknown' as const, reason: { code: 'geometry-refresh-pending' } } })) })) })) };
  const quote = defenseMethodProvider.quote({ ...input, situation });
  expect(quote.status).toBe('blocked');
  expect(quote.missingPreconditions.some(condition => condition.reason.code === 'evacuation-in-place-survival-unknown'
    && condition.status === 'unknown')).toBe(true);
});
