import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import type { AssemblyFactsRequest } from './assembly-facts';
import type { AllocationArrivalReader } from './allocation-arrival-query';
import { readAssemblySupply } from './assembly-supply-reader';
import { assessAllocatedForce } from './allocated-force';
import { landIdAt } from './regions';
import { strategicTargetCamp } from './target-camp';
import { createAssemblyFactsTransaction, type AssemblyPathPreparation } from './assembly-facts-transaction';
import { conquestMethodProvider } from './conquest-methods';
import { createBuilding, createUnit } from '../../shared/map';
import type { VoyageRiskStages } from './voyage-risk';

function fixture() {
  const snapshot = snapshotGame(sketchScene('assembly-reader-native-queue').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 2000 })
    .townHall('us', 400, 400).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 700, 600, { id: 'producer' })
    .unit('us', 'footman', 1000, 1000, { id: 'member' }).unit('us', 'footman', 1100, 1000, { id: 'not-in-this-bundle' })
    .goldMine('new', 2000, 2000, 10000).unit('neutral', 'ogreWarrior', 2000, 2000)
    .unit('neutral', 'ogreMage', 2050, 2000).build().createGame());
  const producer = snapshot.buildings.find(building => building.id === 'producer')!;
  producer.queue = Array.from({ length: 8 }, (_, index) => ({ id: `paid-${index}`, unitKind: 'footman' as const, remaining: 20 }));
  const situation = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity).situation;
  const target = { entityId: 'new', point: { x: 2000, y: 2000 }, landId: landIdAt(snapshot.map, { x: 2000, y: 2000 })! };
  const camp = strategicTargetCamp(snapshot, target)!;
  const requiredForce = assessAllocatedForce('us', [], { metric: 'camp-force', camp }).requiredForce;
  const request: AssemblyFactsRequest = { objective: { id: 'conquest', kind: 'ConquerIsland', owner: 'us', target,
    effects: [{ kind: 'mining-established', mineId: 'new', completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'candidate', sinceTick: 0, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } },
    methodId: 'conquest/staged-beachhead', campTarget: target, requiredForce, unitIds: ['member'],
    posts: [{ id: 'home', target: { point: { x: 1000, y: 1000 }, landId: target.landId }, unitIds: ['member'] }],
    valuation: { phase: 'gross', window: { taskTicks: 1000, holdingTicks: 1400, horizonTicks: 2400, discountTicks: 2400 } } };
  return { snapshot, situation, request, version: 'v9_archer' as const };
}

it('reads native paid jobs and legal exits into assessment-only cohorts without adopting ungranted live troops', () => {
  const input = fixture(), before = JSON.stringify(input), routeInputs: Parameters<AllocationArrivalReader>[0][] = [];
  const result = readAssemblySupply({ ...input, arrival: unit => { routeInputs.push(unit);
    return { status: 'reachable', ticks: 20, landTicks: 20, crossings: [] }; } });
  expect(result.forecast.completionProbability).toBe(1);
  expect(result.cohorts.length).toBeGreaterThan(0);
  const cohort = result.cohorts[0]!;
  expect(cohort.missing).toEqual([]); expect(cohort.realUnitIds).toEqual(['member']);
  expect(cohort.units.some(unit => unit.id === 'not-in-this-bundle')).toBe(false);
  expect(cohort.units.filter(unit => unit.id !== 'member').every(unit => unit.id.startsWith('assembly-assessment:'))).toBe(true);
  expect(routeInputs.length).toBeGreaterThan(0);
  expect(routeInputs.every(unit => unit.id.startsWith('assembly-route:') && (unit.x !== 700 || unit.y !== 600))).toBe(true);
  expect(cohort.units.every(unit => unit.x === 1000 && unit.y === 1000)).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
  const excluded = readAssemblySupply({ ...input, request: { ...input.request,
    valuation: { ...input.request.valuation!, allowedProduction: [] } }, arrival: () => ({ status: 'reachable', ticks: 20, landTicks: 20, crossings: [] }) });
  expect(excluded.forecast.completionProbability).toBe(0); expect(excluded.cohorts).toEqual([]);
});

it('keeps the physical batch outside repeated quotes and can prove a finite formal cap without an unquoted cash schedule', () => {
  const input = fixture(), before = JSON.stringify(input);
  const method = conquestMethodProvider.buildMethods({ ...input, objective: input.request.objective,
    previous: null, executions: [], blocked: [] })[0]!;
  let prepared = 0, settled = 0, queries = 0;
  const transaction = createAssemblyFactsTransaction<AssemblyPathPreparation>({ ...input,
    arrival: () => { queries++; return { status: 'reachable', ticks: 20, landTicks: 20, crossings: [] }; },
    committedRequest: (_objective, _method, unitIds) => ({ ...input.request, unitIds }),
    prepare(request, cohort) {
      prepared++;
      return { pathId: cohort.pathId, readyTick: cohort.readyTick, method,
        materializedInput: { snapshot: input.snapshot, situation: input.situation, objective: request.objective,
          method, unitIds: request.unitIds, budgets: [], executions: [] }, settlement: null, coverage: 'known-effects',
        completedInTicks: cohort.readyTick + 200,
        missing: [{ id: 'same-stage-risk', kind: 'transport', status: 'unknown',
          reason: { code: 'same-batch-stage-risk-unpublished', factIds: ['physical-voyage'], values: {} }, demand: null, subgoalIds: [] }], assumptions: [] };
    }, settle(value, risks) { settled++; return risks.size ? { ...value, missing: [],
      assumptions: [{ code: 'latest-published-risk', factIds: ['physical-voyage'], values: {} }] } : value; } });
  const first = transaction.read(input.request), prepareCount = prepared, queryCount = queries;
  expect(first.continuation).toBeNull();
  expect(first.missing.some(fact => fact.reason.code === 'same-batch-stage-risk-unpublished')).toBe(true);
  expect(transaction.read(input.request)).toBe(first);
  expect(prepared).toBe(prepareCount); expect(queries).toBe(queryCount);
  expect(transaction.riskMethods()).toEqual([method]);
  transaction.publishRisks(new Map()); transaction.read(input.request);
  expect(settled).toBeGreaterThan(prepareCount); expect(prepared).toBe(prepareCount); expect(queries).toBe(queryCount);
  // The projector reports the same latest settlement the quote consumed.
  const pending = { status: 'unknown' as const, reasonCode: 'test-stage', samples: 0, totalSamples: 0, threatIds: [] };
  transaction.publishRisks(new Map<string, VoyageRiskStages>([['physical-voyage', { approach: pending, loaded: pending }]]));
  transaction.read(input.request);
  expect(transaction.project().requests[0]!.paths.every(path => !path.missing.length)).toBe(true);
  expect(transaction.project().requests[0]!.paths[0]!.assumptions[0]!.code).toBe('latest-published-risk');
  const displacement = transaction.delayUpperBound({ objectiveId: input.request.objective.id,
    methodId: method.id, unitIds: ['member'], remainingUnitIds: [], window: input.request.valuation!.window!, unavailableProduction: [] });
  expect(displacement.status).toBe('known');
  if (displacement.status !== 'known') throw new Error('Expected finite formal value cap');
  expect(displacement.bound.mode).toBe('whole-value-cap');
  expect(displacement.bound.gold).toBe(displacement.bound.continuationUpperGold);
  expect(displacement.bound.components.reduce((sum, component) => sum + component.valueGold, 0)).toBe(displacement.bound.gold);
  expect(prepared).toBe(prepareCount); // The oracle did not open another physical-plan batch.
  expect(JSON.stringify(input)).toBe(before);
});

it('preserves the committed production allowlist and exclusions in both displacement supply paths', () => {
  const input = fixture(), { snapshot } = input;
  snapshot.tick = 2400;
  snapshot.map = { ...snapshot.map, width: 1280, height: 1280,
    terrain: { cell: 32, cols: 40, rows: 40, cells: '.'.repeat(1600) } };
  snapshot.units = [createUnit('member-a', 'us', 'footman', 300, 656), createUnit('member-b', 'us', 'footman', 300, 656),
    createUnit('guard', 'neutral', 'ogreWarrior', 200, 250)];
  snapshot.buildings = ['allowed', 'excluded-b', 'excluded-c'].map((id, index) => createBuilding(id, 'us', 'barracks', 500 + index * 200, 656, true));
  snapshot.buildings[0]!.queue = [{ id: 'ours-1', unitKind: 'footman', remaining: 100 }, { id: 'ours-2', unitKind: 'footman', remaining: 100 }];
  for (const building of snapshot.buildings.slice(1)) building.queue = [{ id: `other-${building.id}`, unitKind: 'footman', remaining: 1 }];
  snapshot.resources = [{ id: 'new', kind: 'goldMine', x: 200, y: 200, amount: 10000, startAmount: 10000 }];
  const landId = landIdAt(snapshot.map, { x: 300, y: 656 })!, target = { entityId: 'new', point: { x: 200, y: 200 }, landId };
  const request: AssemblyFactsRequest = { ...input.request, objective: { ...input.request.objective, target }, campTarget: target,
    unitIds: ['member-a', 'member-b'], posts: [{ id: 'home', target: { point: { x: 300, y: 656 }, landId }, unitIds: ['member-a', 'member-b'] }],
    requiredForce: assessAllocatedForce('us', [], { metric: 'camp-force', camp: strategicTargetCamp(snapshot, target)! }).requiredForce,
    valuation: { ...input.request.valuation!, allowedProduction: [{ buildingId: 'allowed', lane: 'training' }],
      unavailableProduction: [{ buildingId: 'excluded-b', lane: 'training', fromTicks: 0, throughTicks: 2400 }] } };
  const situation = { ...input.situation, tick: snapshot.tick }, arrival: AllocationArrivalReader = () => ({ status: 'reachable', ticks: 0, landTicks: 0, crossings: [] });
  const before = readAssemblySupply({ ...input, snapshot, situation, request, arrival });
  const after = readAssemblySupply({ ...input, snapshot, situation, request: { ...request, unitIds: ['member-a'],
    valuation: { ...request.valuation!, unavailableUnitIds: ['member-b'] } }, arrival });
  expect(before.forecast.readyTick).toBe(2500); expect(after.forecast.readyTick).toBe(2600);
  const transaction = createAssemblyFactsTransaction({ ...input, snapshot, situation, arrival,
    committedRequest: () => request, prepare() { throw new Error('Displacement must not prepare a new physical batch'); }, settle(value) { return value; } });
  const quote = transaction.delayUpperBound({ objectiveId: request.objective.id, methodId: request.methodId,
    unitIds: request.unitIds, remainingUnitIds: ['member-a'], window: request.valuation!.window!, unavailableProduction: [] });
  expect(quote.status).toBe('known');
  if (quote.status !== 'known') throw new Error('Expected a proved cap');
  expect(quote.bound.gold).toBeGreaterThan(0);
  const proof = transaction.project().delayProofs[0]!.quotation.sidecar;
  expect(proof.status).toBe('known');
  if (proof.status === 'known') {
    expect(proof.paths[0]!.before).toEqual({ status: 'ready', tick: 2500 });
    expect(proof.paths[0]!.after).toEqual({ status: 'ready', tick: 2600 });
  }
});

it('does not turn missing paid-job routes into free supply or promise recovery of interrupted members', () => {
  const input = fixture();
  const result = readAssemblySupply({ ...input, request: { ...input.request, interruptedUnitIds: ['member'] },
    arrival: () => ({ status: 'unknown', reason: { code: 'shared-post-route-pending' } }) });
  expect(result.forecast.completionProbability).toBe(0);
  expect(result.forecast.status).toBe('unknown');
  expect(result.forecast.supplies.some(supply => supply.unitId === 'member')).toBe(false);
  expect(result.forecast.missing.some(fact => fact.code === 'assembly-recruit-arrival-unknown')).toBe(true);
  expect(result.missing.some(fact => fact.code === 'assembly-recruit-native-exit-route-pending')).toBe(true);
  expect(result.spawnRequests.length).toBeGreaterThan(0);
  expect(result.spawnRequests.every(request => request.status === 'pending')).toBe(true);
  const next = readAssemblySupply({ ...input, snapshot: { ...input.snapshot, tick: 15 },
    situation: { ...input.situation, tick: 15 }, arrival: () => ({ status: 'unknown', reason: { code: 'shared-post-route-pending' } }) });
  expect(next.spawnRequests.map(request => request.id)).toEqual(result.spawnRequests.map(request => request.id));
  expect(result.cohorts).toEqual([]);
});
