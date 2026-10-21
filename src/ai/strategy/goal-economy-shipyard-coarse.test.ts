import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { goalFact } from './goal-facts';
import { createGoalEconomicGrounding, type GoalEconomicGroundingPorts } from './goal-economy-grounding';
import { goalEconomyActionProvider } from './goal-economy-provider';
import { withGoalPlannerInput } from './goal-planner-input';
import type { GoalPlanningContext } from './goal-planner-types';
import { landIdAt, regionIndex, seaIdAt } from './regions';

function original(run: (frame: {
  context: GoalPlanningContext; regions: NonNullable<GoalEconomicGroundingPorts['regions']>;
  contextWith: (regions: GoalEconomicGroundingPorts['regions'], precision?: 'coarse' | 'exact') => GoalPlanningContext;
  exactRequests: () => number;
}) => void) {
  const snapshot = JSON.parse(gunzipSync(readFileSync(new URL('./__fixtures__/goal-convergence/navy-zero-default.snapshot.json.gz', import.meta.url))).toString()) as GameSnapshot;
  const before = JSON.stringify(snapshot);
  expect(createHash('sha256').update(before).digest('hex')).toBe('8d29faf796809089ee8856f34f49a2c613ed7f04eeaed2c7c549a4a65bf38103');
  let requests = 0;
  withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw Error(`Unexpected native route: ${event.operation}`);
  }, () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight',
    memory: createAiPolicyMemory(), precision: 'coarse', goals: [] }, input => {
    const regions = regionIndex(snapshot.map);
    const contextWith = (coast: GoalEconomicGroundingPorts['regions'], precision: 'coarse' | 'exact' = 'coarse') => {
      const context: GoalPlanningContext = { ...input.context, precision };
      return { ...context, grounding: { ...input.context.grounding!, ...createGoalEconomicGrounding(context, {
        ...(coast ? { regions: coast } : {}), geometryRevision: 'original-prepared-coasts', regionAt: (point, mover) => mover === 'land'
          ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point),
        geometry: request => { requests++; return { state: 'pending', requestIds: [request.key],
          reason: { code: 'shared-geometry-not-published', factIds: [request.key], values: {} } }; },
      }) } };
    };
    run({ context: contextWith(regions), regions, contextWith, exactRequests: () => requests });
    expect(input.work.receipt.used).toBe(0);
  })));
  expect(JSON.stringify(snapshot)).toBe(before);
}

it('regresses original zero-navy recruitment through shoreline producers and build prerequisites without exact work', () => original(frame => {
  const { context } = frame, sea = context.situation.seas[0]!;
  expect(landIdAt(context.snapshot.map, sea.anchor)).toBeUndefined();
  const effect = goalFact({ kind: 'transport-in', seaId: sea.id, capacity: 420, byTick: 12001 });
  const trains = goalEconomyActionProvider.actionsFor(effect, context);
  expect(trains.length).toBeGreaterThan(0);
  for (const train of trains) {
    expect(train.kind).toBe('train'); expect(train.precision).toBe('coarse');
    const at = train.executor.parameters.at as { landId: string; seaId: string; point: { x: number; y: number } };
    expect(at.seaId).toBe(sea.id); expect(at.landId).toBe(landIdAt(context.snapshot.map, at.point));
    const prerequisites = train.preconditions.filter(fact => ['production', 'building-complete'].includes(fact.predicate.kind));
    expect(prerequisites).toHaveLength(2);
    for (const prerequisite of prerequisites) {
      const builds = goalEconomyActionProvider.actionsFor(prerequisite, context);
      expect(builds.length).toBeGreaterThan(0);
      for (const build of builds) {
        expect(build).toMatchObject({ kind: 'build', precision: 'coarse', executor: { parameters: { buildingKind: 'shipyard', at } } });
        expect(build.preconditions.some(fact => fact.predicate.kind === 'worker-at' && fact.predicate.at.landId === at.landId)).toBe(true);
        expect(build.preconditions.some(fact => fact.predicate.kind === 'build-site')).toBe(true);
      }
    }
  }
  expect(goalEconomyActionProvider.actionsFor(goalFact({ kind: 'shipyard-for', seaId: sea.id }), context).length).toBeGreaterThan(0);
  expect(frame.exactRequests()).toBe(0);
}));

it('uses stable cached contact landmarks independent of contact order and duplicates', () => original(frame => {
  const sea = frame.context.situation.seas[0]!, fact = goalFact({ kind: 'shipyard-for', seaId: sea.id });
  const first = goalEconomyActionProvider.actionsFor(fact, frame.context);
  const reverse = frame.contextWith({ ...frame.regions, shores: [...frame.regions.shores, ...frame.regions.shores].reverse() });
  expect(goalEconomyActionProvider.actionsFor(fact, reverse)).toEqual(first);
  expect(first.length).toBe(new Set(frame.regions.shores.filter(shore => shore.seaId === sea.id).map(shore => shore.landId)).size);
  expect(frame.exactRequests()).toBe(0);
}));

it('retains missing or unfinished coast metadata as pending without registering exact geometry', () => original(frame => {
  const sea = frame.context.situation.seas[0]!, near = { seaId: sea.id, point: sea.anchor };
  for (const metadata of [undefined, { ...frame.regions, scannedRows: 0 }]) {
    const context = frame.contextWith(metadata);
    expect(context.grounding!.buildSites('shipyard', near)).toMatchObject({ state: 'pending',
      reason: { code: 'coarse-build-coast-metadata-pending' } });
    expect(context.grounding!.productionOptions('transport', near).state).toBe('pending');
  }
  expect(frame.exactRequests()).toBe(0);
}));

it('preserves explicit land anchors and leaves exact placement pending on the existing geometry port', () => original(frame => {
  const land = frame.context.situation.lands[0]!, near = { landId: land.id, point: land.anchor };
  const withMetadata = frame.context.grounding!.buildSites('farm', near);
  expect(frame.contextWith(undefined).grounding!.buildSites('farm', near)).toEqual(withMetadata);
  const sea = frame.context.situation.seas[0]!, exact = frame.contextWith(frame.regions, 'exact');
  expect(exact.grounding!.buildSites('shipyard', { seaId: sea.id, point: sea.anchor }).state).toBe('pending');
  expect(frame.exactRequests()).toBe(1);
}));
