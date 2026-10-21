import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { GoalActionDeclaration } from './goal-planner-types';
import { createGoalRefinementRevision } from './goal-refinement-revision';

it('invalidates an unbound pool builder price when an actual eligible worker moves', () => {
  const snapshot: GameSnapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url))).toString());
  const worker = snapshot.units.find(unit => unit.owner === 'planner' && unit.kind === 'worker')!;
  const action: GoalActionDeclaration = { id: 'coarse-pool-build', kind: 'build', precision: 'coarse', preconditions: [],
    effects: [], demands: [], flows: [], outputs: ['building'], reasons: [],
    duration: { state: 'met', value: 560, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
    successProbability: { state: 'met', value: 1, factIds: [] }, executor: { executor: 'goal.build', parameters: {
      worker: { kind: 'pool-member', unitKind: 'worker', at: { landId: 'land:1', point: { x: worker.x, y: worker.y } }, slot: 'builder' },
    } } };
  const first = createGoalRefinementRevision(snapshot, 'planner', 'same-geometry')(action);
  expect(createGoalRefinementRevision({ ...snapshot, tick: snapshot.tick + 15 }, 'planner', 'same-geometry')(action)).toBe(first);
  const moved = structuredClone(snapshot); moved.units.find(unit => unit.id === worker.id)!.x += 64;
  expect(createGoalRefinementRevision(moved, 'planner', 'same-geometry')(action)).not.toBe(first);
});
