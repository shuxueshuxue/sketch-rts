import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { FactWorkQueue } from './fact-work';
import { goalFact } from './goal-facts';
import { createGoalGeometryReader } from './goal-geometry-source';
import { createGoalEconomicGrounding } from './goal-economy-grounding';
import { goalEconomyActionProvider } from './goal-economy-provider';
import type { GoalGeometryMemory } from './goal-grounding-ports';
import type { GoalPlanningContext, GoalFactReader } from './goal-planner-types';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import type { Situation } from './types';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';

function fixture() {
  const snapshot = snapshotGame(sketchScene('economic-action-enumeration').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 500 })
    .townHall('us', 400, 400, { id: 'hall' }).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 700, 400, { id: 'barracks' }).worker('us', 900, 900, { id: 'worker' }).build().createGame());
  regionIndex(snapshot.map);
  const landId = landIdAt(snapshot.map, { x: 1000, y: 1000 })!, at = { landId, point: { x: 1000, y: 1000 } };
  const situation: Situation = { owner: 'us', tick: 0, horizonTicks: 2400,
    lands: [{ id: landId, anchor: at.point, unitIds: ['worker'], assetIds: ['hall', 'barracks'], adjacentSeaIds: [], threats: [] }],
    seas: [], assets: [], units: [], opportunities: [], economy: { cashGold: 500, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] }, limitations: [] };
  const readFact: GoalFactReader = fact => ({ fact, state: 'pending', observedTick: snapshot.tick, revision: 'unpublished-route',
    requestId: fact.id, requestedTick: 0, reason: { code: 'shared-route-pending', factIds: [fact.id], values: {} }, evidence: [] });
  let retained: GoalGeometryMemory = { version: 1, entries: [] };
  function think(tick: number) {
    snapshot.tick = tick;
    const work = new FactWorkQueue(tick, 6144), geometry = createGoalGeometryReader({ tick, work, memory: retained });
    const context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick, version: 'v9_summoner', readFact };
    const grounding = createGoalEconomicGrounding(context, { geometry, geometryRevision: 'original-native-bodies',
      regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point) });
    return { context: { ...context, grounding: { ...grounding, transportOptions: () => { throw Error('Economic provider requested private transport'); } } },
      work, finish() { work.flush(); retained = JSON.parse(JSON.stringify(retained)); } };
  }
  const run = <T>(fn: () => T) => withNavigationAudit(event => { throw Error(`Domain used native navigation: ${event.operation}`); },
    () => withNavigationPhase('strategy-planning', fn));
  return { snapshot, at, think, run };
}

it('enumerates one-unit and full-batch native training alternatives without bundling prerequisite actions', () => {
  const { snapshot, at, think, run } = fixture(), before = JSON.stringify(snapshot), frame = think(0);
  const actions = run(() => goalEconomyActionProvider.actionsFor(goalFact({ kind: 'unit-available', unitKind: 'footman', count: 3, at, byTick: 2400 }), frame.context));
  run(() => frame.finish());
  expect(actions.map(action => action.kind)).toEqual(['train', 'train']);
  expect(actions.map(action => action.executor.parameters.count).sort()).toEqual([1, 3]);
  expect(actions.every(action => action.preconditions.some(fact => fact.predicate.kind === 'gold'))).toBe(true);
  expect(actions.every(action => action.preconditions.some(fact => fact.predicate.kind === 'building-complete'))).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(run(() => goalEconomyActionProvider.actionsFor(goalFact({ kind: 'unit-available', unitKind: 'emberRavager', count: 1, at, byTick: 2400 }), frame.context))).toEqual([]);
});

it('exposes build as a production achiever using the published real site and the same output binding', () => {
  const { at, think, run } = fixture();
  let frame = think(0);
  const producer = { kind: 'binding', name: 'requested-stables' } as const;
  const effect = goalFact({ kind: 'production', unitKind: 'knight', producer, at, byTick: 2400 });
  expect(run(() => goalEconomyActionProvider.actionsFor(effect, frame.context))).toEqual([]);
  run(() => frame.finish());
  frame = think(15);
  const actions = run(() => goalEconomyActionProvider.actionsFor(effect, frame.context));
  expect(actions.length).toBeGreaterThan(0); expect(actions.every(action => action.kind === 'build')).toBe(true);
  for (const action of actions) {
    expect(action.duration.state).toBe('pending'); // no made-up builder arrival
    expect(action.effects.some(item => item.fact.predicate.kind === 'production' && item.fact.predicate.unitKind === 'knight'
      && item.fact.predicate.producer?.kind === 'output' && item.fact.predicate.producer.actionId === action.id)).toBe(true);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'production')).toBe(false);
  }
  const selected = actions[0]!, completed = selected.effects.find(item => item.fact.predicate.kind === 'building-complete')!.fact;
  const exact = run(() => goalEconomyActionProvider.actionsFor(completed, frame.context));
  expect(exact.map(action => action.executor.parameters.at)).toEqual([selected.executor.parameters.at]);
  run(() => frame.finish());
});

it('offers finite native capacity contributions instead of claiming one building meets an arbitrary population goal', () => {
  const { think, run } = fixture(), effect = goalFact({ kind: 'supply-cap', minimum: 1000 });
  const first = think(0); run(() => goalEconomyActionProvider.actionsFor(effect, first.context)); run(() => first.finish());
  const second = think(15), actions = run(() => goalEconomyActionProvider.actionsFor(effect, second.context));
  expect(actions.length).toBeGreaterThan(1);
  expect(actions.every(action => action.kind === 'build')).toBe(true);
  expect(actions.some(action => action.executor.parameters.buildingKind === 'farm')).toBe(true);
  expect(actions.every(action => !action.effects.some(item => item.fact.predicate.kind === 'supply-cap' && item.fact.predicate.minimum === 1000))).toBe(true);
  expect(actions.every(action => action.flows.some(flow => flow.resource.kind === 'supply-cap' && flow.delta > 0 && flow.delta < 1000))).toBe(true);
  run(() => second.finish());
});

it('does not claim training can strengthen an already bound cohort or recreate an existing named hull', () => {
  const { at, think, run } = fixture(), frame = think(0);
  expect(run(() => goalEconomyActionProvider.actionsFor(goalFact({ kind: 'force-available', at, minimum: 100,
    metric: 'combat-rating', byTick: 2400, cohort: [{ kind: 'existing', entityId: 'worker' }] }), frame.context))).toEqual([]);
  expect(run(() => goalEconomyActionProvider.actionsFor(goalFact({ kind: 'transport-in', seaId: 'sea:1', capacity: 100,
    byTick: 2400, transport: { kind: 'existing', entityId: 'named-hull' } }), frame.context))).toEqual([]);
});
