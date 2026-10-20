import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { UNIT_DEFS } from '../../shared/catalog';
import type { Arrival, Situation } from './types';
import { arrivalColumns, withUnitArrivals } from './unit-arrivals';
import { miningCapacity } from './mining-capacity';
import { discountedMiningSegments, forecastMiningWorkforce, type MiningForecastInput } from './mining-forecast';
import { valuationWindow, discountedFlow } from './utility';
import { createOpportunityOracle } from './opportunity-oracle';
import { productionUsesOverlap } from './production-use';

const calibration = { id: 'test-measured-services', dispatchTicks: 28, localBirthToEntryTicks: 102,
  firstDeliveryTicks: 105, workerCountMae: 1, workerCountP90Error: 2 };
function example(spare = 5): MiningForecastInput {
  let scene = sketchScene('mining-forecast').map('openClaims').replaceDefaults()
    .player('us').playerState('us', { gold: 1000 })
    .townHall('us', 300, 300, { id: 'home' }).goldMine('old', 300, 510, 10000).goldMine('new', 1400, 600, 10000);
  for (let i = 0; i < 5; i++) scene = scene.worker('us', 300, 460, { id: `old-${i}`,
    order: { type: 'mine', resourceId: 'old', phase: 'toMine', timer: 0 } });
  for (let i = 0; i < spare; i++) scene = scene.worker('us', 1200, 600, { id: `spare-${i}` });
  const snapshot = snapshotGame(scene.build().createGame());
  snapshot.players.us!.supplyCap = 40;
  const situation = { tick: snapshot.tick, owner: 'us', assets: [
    { id: 'new', kind: 'mine', owner: 'neutral', target: {landId:'same'}, miningCapacity: miningCapacity([]) },
    { id: 'home', kind: 'hall', owner: 'us', target: {landId:'same'} },
    { id: 'old', kind: 'mine', owner: 'us', target: {landId:'same'}, incomeGoldPerTick: 1 / 3 }],
    units: snapshot.units.map(unit => ({ id: unit.id, owner: unit.owner, location: { kind: 'land', landId: 'same' }, commitments: [],
      arrivals: [{ targetId: 'new', arrival: { status: 'reachable', ticks: unit.id.startsWith('old') ? 500 : 50, crossings: [] } }] })) } as unknown as Situation;
  return { snapshot, situation, mineId: 'new', hallReadyTicks: 0, engineerId: spare ? 'spare-0' : null,
    window: valuationWindow(0), calibration };
}

it('values a safe, nearby, full empty mine positively with spare workers without assuming instant full income', () => {
  const input = example(), before = JSON.stringify(input), result = forecastMiningWorkforce(input);
  expect(result.status).toBe('estimated');
  expect(result.workers).toHaveLength(5);
  expect(result.trainingGold).toBe(0);
  expect(result.incomeGold).toBeGreaterThan(0);
  const instant = discountedFlow({ goldPerTick: 1 / 3, remainingGold: 10000, startsInTicks: 0, window: input.window });
  expect(result.incomeGold).toBeLessThan(instant);
  expect(result.segments[0]!.workerCount).toBe(0);
  expect(result.workers[4]!.arrivalTicks - result.workers[0]!.arrivalTicks).toBe(120);
  expect(JSON.stringify(input)).toBe(before);
});

it('preserves the old mine workforce and declares new recruitment money and queue occupancy', () => {
  const input = example(1), result = forecastMiningWorkforce(input);
  expect(result.workers.some(w => w.unitId.startsWith('old-'))).toBe(false);
  expect(result.training.filter(t => !t.paid)).toHaveLength(4);
  expect(result.trainingGold).toBe(4 * UNIT_DEFS.worker.cost);
  expect(result.queueTicks).toBe(4 * UNIT_DEFS.worker.trainTime);
  expect(result.training.every(t => t.completesInTicks - t.startsInTicks === t.queueTicks)).toBe(true);
  expect(result.presentTrainingGold).toBeLessThanOrEqual(result.trainingGold);
});

it('keeps paid worker queues free of a second recruitment charge', () => {
  const input = example(4), home = input.snapshot.buildings.find(h => h.id === 'home')!;
  home.queue.push({ id: 'already-paid', unitKind: 'worker', remaining: 70, paidGold: 75 });
  const result = forecastMiningWorkforce(input), paid = result.training.find(t => t.id === 'already-paid')!;
  expect(paid).toMatchObject({ paid: true, gold: 0, producerId: 'home', completesInTicks: 70 });
  expect(result.trainingGold).toBe(0);
  expect(result.workers.find(w => w.unitId === paid.id)!.arrivalTicks).toBe(paid.onStationTicks);
});

it('does not count ungranted mainland workers as island mining income', () => {
  const input = example();
  const result = forecastMiningWorkforce({ ...input, explicitWorkerIds: ['spare-0'] });
  expect(result.surplusWorkerIds).toEqual([]);
  expect(result.workers.filter(w => !w.producerId).map(w => w.unitId)).toEqual(['spare-0']);
  expect(result.trainingGold).toBe(300);
});

it('keeps absent capacity and unknown worker travel explicit', () => {
  const input = example(1);
  const missing = { ...input, situation: { ...input.situation,
    assets: input.situation.assets.map(({ miningCapacity: _capacity, ...asset }) => asset) } };
  expect(forecastMiningWorkforce(missing)).toMatchObject({ status: 'unknown', incomeGold: null,
    unknown: [{ code: 'mining-capacity-missing', entityIds: ['new'] }] });
  const unknown = { ...input, situation: { ...input.situation, units: input.situation.units.map(u => ({ ...u,
    arrivals: [{ targetId: 'new', arrival: { status: 'unknown' as const, reason: { code: 'field-pending', detail: '', evidence: [] } } }] })) } };
  const result = forecastMiningWorkforce({ ...unknown, availableGold: 0 });
  expect(result.unknown).toContainEqual({ code: 'worker-arrival-unknown', entityIds: ['spare-0'] });
  expect(result.workers.some(w => w.unitId === 'spare-0')).toBe(false);
});

it('uses the actual hall readiness while pricing the requesting objective window', () => {
  const input = example(), result = forecastMiningWorkforce({ ...input, hallReadyTicks: 1000 });
  expect(result.workers.every(w => w.arrivalTicks >= 1000)).toBe(true);
  expect(result.segments.every(s => s.fromTicks >= 1000)).toBe(true);
  expect(input.window.taskTicks).toBe(0);
});

it('depletes ore before tax and integrates discontinuous segments using the common discount', () => {
  const window = valuationWindow(0), segments = [{ fromTicks: 0, untilTicks: 100, workerCount: 1, productiveWorkerCount: 1,
    grossGoldPerTick: 1, incomeGoldPerTick: .5 }, { fromTicks: 100, untilTicks: 200, workerCount: 2, productiveWorkerCount: 2,
    grossGoldPerTick: 2, incomeGoldPerTick: 1 }];
  expect(discountedMiningSegments(segments, 150, window)).toBeCloseTo(
    discountedFlow({ goldPerTick: .5, remainingGold: 50, startsInTicks: 0, window })
    + discountedFlow({ goldPerTick: 1, remainingGold: 25, startsInTicks: 100, window }));
  expect(() => discountedMiningSegments([{ ...segments[0]!, untilTicks: Infinity }], 100, window)).toThrow();
});

it('keeps an adjacent hall across water out of local production and never borrows an ungranted crossing worker', () => {
  const input = example(2);
  const situation = { ...input.situation, assets: input.situation.assets.map(a => a.id === 'home'
    ? { ...a, target: { ...a.target, landId: 'land:2' as const } } : a),
    units: input.situation.units.map(u => u.id === 'spare-1' ? { ...u, arrivals: [{ targetId: 'new',
      arrival: { status: 'conditional' as const, ticks: 50, landTicks: 10, crossings: [], unmet: [], evidence: [] } }] } : u) };
  const result = forecastMiningWorkforce({ ...input, situation });
  expect(result.workers.some(w => w.unitId === 'spare-1')).toBe(false);
  expect(result.training.every(t => t.producerId === 'planned-hall:new')).toBe(true);
  expect(result.unknown).toContainEqual({ code: 'worker-transport-ungranted', entityIds: ['spare-1'] });
});

it('appends to real paid training jobs while research advances in its independent native lane', () => {
  const input = example(1), home = input.snapshot.buildings.find(h => h.id === 'home')!;
  home.queue.push({ id: 'paid-old-worker', unitKind: 'worker', remaining: 90, paidGold: 75 });
  const original = forecastMiningWorkforce(input);
  home.researchQueue.push({ upgradeKind: 'buildingDurability', targetLevel: 1, remaining: 2000 });
  const concurrent = forecastMiningWorkforce(input);
  expect(concurrent.training).toEqual(original.training);
  expect(concurrent.training.find(t => t.id === 'paid-old-worker')).toMatchObject({ jobId: 'paid-old-worker', lane: 'training', gold: 0 });
  expect(concurrent.training.filter(t => t.producerId === 'home' && !t.paid).every(t => t.startsInTicks >= 90)).toBe(true);
  home.queue[0] = { unitKind: 'worker', remaining: 90, paidGold: 75 };
  const previous = forecastMiningWorkforce(input);
  expect(previous.unknown).toContainEqual({ code: 'paid-worker-job-id-unknown', entityIds: ['home'] });
  expect(previous.training.every(t => !t.paid)).toBe(true);
});

it('reads compact decision facts without constructing explanations or compatibility arrival arrays', () => {
  const input = example(), columns = arrivalColumns(['new']);
  const units = input.situation.units.map(unit => {
    const { arrivals, ...facts } = unit;
    const compact = withUnitArrivals(facts, { columns, values: arrivals.map(row => row.arrival as Arrival), count: 1 });
    Object.defineProperty(compact, 'arrivals', { get() { throw Error('Compatibility array must stay cold'); } });
    return compact;
  });
  const first = forecastMiningWorkforce(input);
  expect(forecastMiningWorkforce({ ...input, situation: { ...input.situation, units } })).toEqual(first);
});

it('can finance later recruits from explicitly forecast new-mine income without inventing free workers', () => {
  const input = example(1);
  const situation = { ...input.situation, assets: input.situation.assets.map(asset => asset.id === 'old'
    ? { ...asset, incomeGoldPerTick: 0 } : asset) };
  const result = forecastMiningWorkforce({ ...input, situation, availableGold: 0 });
  expect(result.training.length).toBeGreaterThan(0);
  expect(result.training.every(t => t.gold === 75 && t.startsInTicks > 105)).toBe(true);
  expect(result.trainingGold).toBe(result.training.length * 75);
  expect(result.workers.every(w => w.source !== 'train-worker' || result.training.some(t => t.id === w.unitId))).toBe(true);
});

it('repays declared ship and hall capital shortfall before financing optional worker training', () => {
  const input = example(1);
  input.snapshot.players.us!.gold = 424;
  const availableGold = 424 - 240 - 400;
  const result = forecastMiningWorkforce({ ...input, availableGold });
  const first = result.training.find(t => !t.paid)!;
  expect(availableGold).toBe(-216);
  expect(first).toBeDefined();
  // The engineer first delivers at tick 183: 61 old-mine gold before that,
  // then (75 + 216 - 61) / (1/3 + 1/15) = 575 more ticks to fund recruitment.
  expect(first.startsInTicks).toBeCloseTo(758);
  expect(first.startsInTicks).toBeGreaterThan(forecastMiningWorkforce({ ...input, availableGold: 0 }).training[0]!.startsInTicks);
  expect(result.trainingGold).toBe(result.training.length * 75);
  expect(() => forecastMiningWorkforce({ ...input, availableGold: -Infinity })).toThrow(/available gold/);
  expect(() => forecastMiningWorkforce({ ...input, availableGold: NaN })).toThrow(/available gold/);
});

it('does not book an established miner as expansion income before the actual new hall can be ready', () => {
  const input = example(1), worker = input.snapshot.units.find(u => u.id === 'spare-0')!;
  worker.order = { type: 'mine', resourceId: 'new', phase: 'gather', timer: 60 }; worker.mineSlot = 'new';
  const forecast = forecastMiningWorkforce({ ...input, hallReadyTicks: input.window.horizonTicks + 1 });
  expect(forecast.workers.find(w => w.unitId === worker.id)?.source).toBe('stationed');
  expect(forecast.segments).toEqual([]);
  expect(forecast.incomeGold).toBe(0);
});

it('does not finance recruitment with new-mine income before the actual hall readiness', () => {
  const input = example(1), worker = input.snapshot.units.find(u => u.id === 'spare-0')!;
  worker.order = { type: 'mine', resourceId: 'new', phase: 'gather', timer: 60 }; worker.mineSlot = 'new';
  const situation = { ...input.situation, assets: input.situation.assets.map(asset => asset.id === 'old'
    ? { ...asset, incomeGoldPerTick: 0 } : asset) };
  const result = forecastMiningWorkforce({ ...input, situation, hallReadyTicks: 2000, window: valuationWindow(2000), availableGold: 0 });
  expect(result.training.length).toBeGreaterThan(0);
  expect(result.training.every(t => t.startsInTicks > 2000)).toBe(true);
});

it('keeps recruitment inside the allowed production cohort, including a proposed hall', () => {
  const input = example(1), allowedProduction = [{ buildingId: 'home', lane: 'training' as const }];
  const result = forecastMiningWorkforce({ ...input, allowedProduction });
  expect(result.training).toHaveLength(4);
  expect(result.training.every(t => t.producerId === 'home')).toBe(true);
  expect(result.production.every(use => use.buildingId === 'home' && use.lane === 'training')).toBe(true);
  const excluded = forecastMiningWorkforce({ ...input, allowedProduction: [{ buildingId: 'home', lane: 'research' }] });
  expect(excluded.training).toEqual([]);
  expect(excluded.workers.map(w => w.unitId)).toEqual(['spare-0']);
  expect(excluded.unknown).toContainEqual({ code: 'worker-production-not-allowed', entityIds: ['planned-hall:new'] });
});

it('waits for contiguous free training time while independent research and touching slots do not conflict', () => {
  const input = example(4), allowedProduction = [{ buildingId: 'planned-hall:new', lane: 'training' as const }];
  const unavailableProduction = [
    { buildingId: 'planned-hall:new', lane: 'training' as const, fromTicks: 0, throughTicks: 140 },
    { buildingId: 'planned-hall:new', lane: 'training' as const, fromTicks: 200, throughTicks: 400 }];
  const before = JSON.stringify(input);
  const result = forecastMiningWorkforce({ ...input, allowedProduction, unavailableProduction });
  expect(result.training).toHaveLength(1);
  expect(result.training[0]).toMatchObject({ startsInTicks: 400, completesInTicks: 540, gold: 75 });
  expect(result.production).toEqual([{ buildingId: 'planned-hall:new', lane: 'training', fromTicks: 400, throughTicks: 540 }]);
  expect(productionUsesOverlap(result.production, unavailableProduction)).toBe(false);
  expect(forecastMiningWorkforce({ ...input, allowedProduction,
    unavailableProduction: [{ buildingId: 'planned-hall:new', lane: 'training', fromTicks: 140, throughTicks: 400 }] })
    .training[0]).toMatchObject({ startsInTicks: 0, completesInTicks: 140 });
  expect(forecastMiningWorkforce({ ...input, allowedProduction,
    unavailableProduction: unavailableProduction.map(use => ({ ...use, lane: 'research' })) }))
    .toEqual(forecastMiningWorkforce({ ...input, allowedProduction }));
  expect(JSON.stringify(input)).toBe(before);
});

it('does not shift, cancel or adopt a real paid job when its queue use is removed from the offer', () => {
  const input = example(4), home = input.snapshot.buildings.find(h => h.id === 'home')!;
  home.queue.push({ id: 'already-paid', unitKind: 'worker', remaining: 70, paidGold: 75 });
  const before = JSON.stringify(input), allowedProduction = [{ buildingId: 'home', lane: 'training' as const }];
  const normal = forecastMiningWorkforce({ ...input, allowedProduction });
  expect(normal.production).toEqual([{ buildingId: 'home', lane: 'training', fromTicks: 0, throughTicks: 70 }]);
  const removed = forecastMiningWorkforce({ ...input, allowedProduction,
    unavailableProduction: [{ buildingId: 'home', lane: 'training', fromTicks: 0, throughTicks: 70 }] });
  expect(removed.workers.some(w => w.unitId === 'already-paid')).toBe(false);
  expect(removed.training).toHaveLength(1);
  expect(removed.training[0]).toMatchObject({ paid: false, startsInTicks: 70, gold: 75 });
  expect(removed.unknown).toContainEqual({ code: 'paid-worker-production-unavailable', entityIds: ['home', 'already-paid'] });
  expect(JSON.stringify(input)).toBe(before);
});

it('lets the whole-bundle oracle price the mining income lost to overlapping production without recruiting replacements', () => {
  const input = example(4), allowedProduction = [{ buildingId: 'planned-hall:new', lane: 'training' as const }];
  const original = forecastMiningWorkforce({ ...input, allowedProduction });
  const calls: number[] = [];
  const oracle = createOpportunityOracle([{ id: 'expansion-method', objectiveId: 'expansion', unitIds: [],
    production: original.production, effectKeys: ['mining:new'], committed: false, quote: (_ids, window, unavailableProduction) => {
      const forecast = forecastMiningWorkforce({ ...input, allowedProduction, unavailableProduction: unavailableProduction ?? [], window });
      calls.push(forecast.training.length);
      return { status: 'feasible', score: forecast.incomeGold! - forecast.presentTrainingGold, coverage: 'known-effects' };
    } }], { effectKeysFor: () => ['other-production'] });
  const quote = oracle({ objectiveId: 'other', methodId: 'occupy-queue', unitIds: [], window: input.window,
    production: [{ buildingId: 'planned-hall:new', lane: 'training', fromTicks: 0, throughTicks: input.window.horizonTicks }] });
  expect(quote.status).toBe('known');
  expect(quote.status === 'known' && quote.gold).toBeGreaterThan(0);
  expect(calls).toEqual([1, 0]);
});
