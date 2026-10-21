import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import { FactWorkQueue } from './fact-work';
import { goalFact } from './goal-facts';
import { createGoalGeometryReader } from './goal-geometry-source';
import { createGoalMovementProjection } from './goal-movement-projection';
import type { GoalActionDeclaration, GoalPlanningContext } from './goal-planner-types';
import { createGoalFactReader, createGoalWorldFactMemory } from './goal-world-facts';
import { landIdAt, regionIndex, seaIdAt } from './regions';

it('projects only the selected actual cohort at its landing, with future availability and no live-world mutation', () => {
  const snapshot = snapshotGame(sketchScene('movement-projection-contract').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'us' }).player('foe', { race: 'ember', team: 'foe' })
    .townHall('us', 300, 300).unit('us', 'footman', 1000, 1000, { id: 'fighter', hp: 47 })
    .unit('us', 'archer', 1000, 1000, { id: 'unselected' }).worker('us', 1000, 1000, { id: 'builder' })
    .build().createGame());
  regionIndex(snapshot.map);
  const situation = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }).situation;
  const context: GoalPlanningContext = { snapshot, situation, tick: snapshot.tick, owner: 'us', version: 'v9_knight',
    readFact: () => { throw Error('Unexpected live fact request'); } };
  const work = new FactWorkQueue(snapshot.tick, 0);
  const reader = (world: typeof snapshot) => createGoalFactReader({ ...context, snapshot: world, memory: createGoalWorldFactMemory('us'), ports: {
    geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory: { version: 1, entries: [] } }),
    geometryRevision: 'published-shape', reservedGold: 0,
    regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point),
    landRoute: (from, to) => ({ status: 'known', distance: Math.hypot(to.x - from.x, to.y - from.y), points: [from, to] }),
  } });
  const ref = (entityId: string) => ({ kind: 'existing' as const, entityId });
  const at = { landId: landIdAt(snapshot.map, { x: 2000, y: 2000 })!, point: { x: 2000, y: 2000 } };
  const action: GoalActionDeclaration = { id: 'published-transport', kind: 'transport-force', preconditions: [], effects: [], demands: [], flows: [],
    duration: { state: 'met', value: 100, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
    successProbability: { state: 'met', value: 1, factIds: [] }, executor: { executor: 'goal.transport-force', parameters: {
      cohort: [ref('fighter')], dependentUnitIds: ['builder'], landing: { ground: at.point, water: { x: 2100, y: 2000 }, heading: 0 },
    } }, outputs: [], reasons: [] };
  const before = JSON.stringify(snapshot), project = createGoalMovementProjection(context, reader);
  const path = { actions: [{ action, startTick: 0, finishTick: 100 }], bindings: {} };
  const fact = goalFact({ kind: 'force-at', at, minimum: 0, metric: 'combat-rating', cohort: [ref('fighter')], byTick: 200 });
  withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
    () => withNavigationPhase('strategy-planning', () => {
      expect(reader(snapshot)(fact).state).toBe('unmet');
      expect(project(fact, path)).toMatchObject({ state: 'met', entityIds: ['fighter'], availableTick: 100 });
      expect(project(goalFact({ ...fact.predicate as Extract<typeof fact.predicate, { kind: 'force-at' }>, cohort: [ref('unselected')] }), path)).toBeNull();
      expect(project(goalFact({ kind: 'worker-at', at, count: 1, worker: ref('builder'), byTick: 200 }), path))
        .toMatchObject({ state: 'met', entityIds: ['builder'], availableTick: 100 });
      const route = goalFact({ kind: 'route', mover: 'land', actor: ref('fighter'), from: at,
        to: { ...at, point: { x: 2200, y: 2000 } } });
      expect(project(route, path)).toMatchObject({ state: 'met', availableTick: 100, route: { distance: 200 } });
      expect(project(goalFact({ ...route.predicate as Extract<typeof route.predicate, { kind: 'route' }>,
        from: { ...at, point: { x: 1800, y: 2000 } } }), path))
        .toMatchObject({ state: 'unmet', reason: { code: 'projected-route-origin-mismatch' } });
      expect(project(fact, { actions: [], bindings: {} })).toBeNull();
    }));
  expect(work.receipt.used).toBe(0);
  expect(JSON.stringify(snapshot)).toBe(before);
});
