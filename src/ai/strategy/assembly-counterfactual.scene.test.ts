import { expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { createUnit } from '../../shared/map';
import { snapshotGame } from '../../shared/sim';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import type { AssemblyFactsRequest } from './assembly-facts';
import { prepareAssemblyConquestContinuation, settlePreparedAssemblyConquestContinuation } from './assembly-conquest-continuation';
import { conquestMethodProvider } from './conquest-methods';
import { valueConquestContinuation } from './conquest-value';
import { buildStrategyDecision } from './decision';
import { landIdAt } from './regions';
import type { AllocationArrivalReader } from './allocation-arrival-query';
import type { AssemblyAssessmentCohort } from './assembly-supply-reader';
import { valuationWindow } from './utility';
import { createAssemblyFactsTransaction } from './assembly-facts-transaction';

// The auditor's original six-to-five native cohort and fixed route-port facts.
// This checks valuation consistency, not a natural allocator grant.
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

it('prices the lost fighting quality when six and five real soldiers are ready at the same tick', () => {
  const input = fixture(), beforeInput = JSON.stringify(input), ids = input.request.unitIds, remaining = ids.slice(0, -1);
  const real = new Set(ids), beforeCohort = { ...input.cohort, pathId: 'certain-supply', readyTick: input.snapshot.tick,
    units: input.cohort.units.filter(unit => real.has(unit.id)), realUnitIds: ids };
  const before = prepareAssemblyConquestContinuation({ ...input, cohort: beforeCohort });
  const after = prepareAssemblyConquestContinuation({ ...input, request: { ...input.request, unitIds: remaining },
    cohort: { ...beforeCohort, units: beforeCohort.units.filter(unit => remaining.includes(unit.id)), realUnitIds: remaining } });
  expect(before.settlement).not.toBeNull(); expect(after.settlement).not.toBeNull();
  const beforeValue = valueConquestContinuation(before.settlement!), afterValue = valueConquestContinuation(after.settlement!);
  expect(beforeValue.battleProbability).toBeGreaterThan(afterValue.battleProbability!);
  const transaction = createAssemblyFactsTransaction({ ...input, version: 'v9_archer', committedRequest: () => input.request,
    prepare: (request, cohort) => prepareAssemblyConquestContinuation({ ...input, request, cohort }),
    settle: settlePreparedAssemblyConquestContinuation });
  transaction.read(input.request);
  const quote = transaction.delayUpperBound({ objectiveId: input.request.objective.id, methodId: input.request.methodId,
    unitIds: ids, remainingUnitIds: remaining, window: input.request.valuation!.window!, unavailableProduction: [] });
  expect(quote.status).toBe('known');
  if (quote.status !== 'known') throw new Error('Expected the two known continuation settlements');
  expect(quote.bound.mode).toBe('scenario-continuation');
  expect(quote.bound.gold).toBeCloseTo(5.302342844001203, 8);
  expect(quote.bound.gold).toBeCloseTo(beforeValue.utility.score - afterValue.utility.score, 8);
  expect(transaction.project().displacementCounts).toMatchObject({ wholeValueCapFallbacks: 0, scenarioContinuations: 1 });
  expect(JSON.stringify(input)).toBe(beforeInput);
});
