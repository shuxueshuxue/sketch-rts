import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import type { GameSnapshot } from '../../shared/types';
import { retainGoalCohortCommitments, type GoalCohortCommitments } from './goal-cohort-commitments';

it('recovers the actually started four-person group after terminal GC and persists it across later larger-group history', () => {
  const frame: { snapshot: GameSnapshot; memoryBefore: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/goal-refinement-near-12ec-t1800.json.gz', import.meta.url))).toString());
  const before = JSON.stringify(frame), commitments: GoalCohortCommitments = {};
  retainGoalCohortCommitments(commitments, frame.memoryBefore.strategyAllocation, frame.snapshot, 'planner');
  const group = commitments['ConquerIsland:planner:resource-1']!;
  expect(group.cohort).toHaveLength(4);
  expect(group.cohort.every(ref => ref.kind === 'existing' && ref.entityId.includes('footman'))).toBe(true);
  const restored: GoalCohortCommitments = JSON.parse(JSON.stringify(commitments));
  retainGoalCohortCommitments(restored, frame.memoryBefore.strategyAllocation, frame.snapshot, 'planner');
  expect(restored).toEqual(commitments);
  expect(JSON.stringify(frame)).toBe(before);
  const foreign: GoalCohortCommitments = {};
  retainGoalCohortCommitments(foreign, frame.memoryBefore.strategyAllocation, frame.snapshot, 'pressure');
  expect(foreign).toEqual({});
});
