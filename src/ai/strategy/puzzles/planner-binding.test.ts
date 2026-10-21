import { expect, it } from 'vitest';
import { snapshotGame } from '../../../shared/sim';
import { goalCampId, goalFact, resolveGoalCamp } from '../goal-facts';
import { planGoals } from '../goal-planner';
import { optionalFunction, publicPuzzlePlanner } from './planner-binding';
import { shipAwayScene } from './scenes';

it('binds the public puzzle entry to the real shared planGoals export', () => {
  expect(publicPuzzlePlanner.planGoals).toBe(planGoals);
});

it('loads the actual shared TypeScript entry and keeps native camp identity canonical', async () => {
  const world = shipAwayScene(), members = world.guards.map(u => u.id);
  const loaded = await optionalFunction<typeof goalCampId>('../goal-facts.ts', 'goalCampId');
  expect(loaded.unavailable).toBeUndefined();
  const id = loaded.value!(members);
  expect(id).toBe(goalCampId([...members].reverse()));
  const resolved = resolveGoalCamp(snapshotGame(world.game), id);
  expect(resolved.status).toBe('present');
  if (resolved.status !== 'present') throw new Error('Native puzzle camp is missing');
  expect([...resolved.exposure.memberIds].sort()).toEqual([...members].sort());
  expect(goalFact({ kind: 'camp-cleared', campId: id })).toEqual(goalFact({ kind: 'camp-cleared', campId: goalCampId(members) }));
});
