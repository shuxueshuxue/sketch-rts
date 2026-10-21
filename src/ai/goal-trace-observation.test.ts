import { expect, it } from 'vitest';
import { snapshotGame } from '../shared/sim';
import { sketchScene } from '../sdk/scene';
import { createAiPolicyMemory } from './memory';
import { planAiOwnerCommandEntriesWithTrace } from './plan-trace-planner';
import type { BootstrapStrategyOutput } from './strategy/bootstrap-control';

it('records the exact control-on planner output in the owner observation trace', () => {
  const snapshot = snapshotGame(sketchScene('goal-trace-observation').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us', race: 'grove' }).player('foe', { team: 'foe', race: 'ember' })
    .townHall('us', 700, 1000).townHall('foe', 1050, 1000, { id: 'target', hp: 20 })
    .unit('us', 'footman', 1000, 1000).build().createGame());
  let actual: BootstrapStrategyOutput | undefined;
  const result = planAiOwnerCommandEntriesWithTrace(snapshot,
    { playerId: 'us', version: 'v9_knight', memory: createAiPolicyMemory() },
    { strategyControl: true, observeBootstrapPlan: (_context, _entries, output) => { actual = output; } });
  expect(actual?.goalPlanner).toBeDefined();
  expect(result.trace.goalPlanner).toBe(actual!.goalPlanner);
  expect(result.trace.goalPlanner!.plans.length).toBeGreaterThan(0);
});
