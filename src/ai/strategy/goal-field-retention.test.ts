import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { observationMemory } from './observation-memory';
import { withGoalPlannerInput } from './goal-planner-input';
import { FactWorkQueue, withFactWork } from './fact-work';
import { createPlanningDistanceQuery, planningFieldKey } from './distance-fields';
import { goalFact } from './goal-facts';
import type { GoalPlan, GoalRequest } from './goal-planner-types';

for (const mover of ['land', 'sea'] as const) it(`refreshes selected ${mover} field overflow in a later epoch and releases it through JSON`, () => {
  // Cache/source-retention contract from the independent 488c probe. These
  // 65 dependency keys assert no physical route or field publication result.
  const game = sketchScene('field-cache-pressure-contract').map('bareDuel').replaceDefaults().player('us').player('foe')
    .townHall('us', 350, 350).townHall('foe', 4000, 4000).build().createGame();
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot), id = 'capacity-contract';
  let memory = createAiPolicyMemory();
  const state = observationMemory(snapshot, 'us', memory); state.thinkSequence = 1;
  state.fields[mover] = Array.from({ length: 65 }, (_, i) => ({ goal: { x: 1000 + i, y: 1000 }, work: 0,
    readyTick: null, lastUsedThink: 1, planIds: [id] }));
  const queue = new FactWorkQueue(snapshot.tick, 0, undefined, 1);
  withFactWork(queue, () => queue.withConsumer(id, 100, () => createPlanningDistanceQuery(snapshot, 1, mover, state).field(state.fields[mover][0]!.goal)));
  expect(state.cacheCapacities![`field-${mover}`]!.pressure).toMatchObject({ thinkSequence: 1, entries: 65, limitEntries: 64 });
  const keys = state.fields[mover].map(entry => planningFieldKey(mover, entry.goal));
  const goal: GoalRequest = { id, owner: 'us', effects: [goalFact({ kind: 'camp-cleared', campId: 'unobserved-guard' })],
    rewardGold: 100, deadlineTick: 10000, reasons: [] };
  const retain = (factIds: readonly string[]) => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory,
    goals: [goal], precision: 'coarse' }, input => {
    const plan: GoalPlan = { id: `goal-plan:${id}`, goal, observedTick: snapshot.tick, status: 'waiting-facts', facts: [], edges: [],
      actions: [{ id: 'dependency-carrier', state: 'waiting-facts', prerequisiteFactIds: [], dependsOnActionIds: [],
        startTick: null, finishTick: null, reasons: [], declaration: { id: 'dependency-carrier', kind: 'assemble',
          preconditions: [], effects: [], demands: [], flows: [], outputs: [], reasons: [], executor: { executor: 'cache-contract', parameters: {} },
          duration: { state: 'met', value: 0, factIds }, cost: { state: 'met', value: [], factIds: [] },
          successProbability: { state: 'met', value: 1, factIds: [] } } }], subgoals: [], alternatives: [], readyActionIds: [],
      resourceTimeline: [], costGold: null, successProbability: null, valueGold: null, completedTick: null,
      search: { work: 0, expansions: 0, depth: 0, limitReason: null }, reasons: [] };
    input.retainFactRequests!([plan]);
    return { sequence: input.work.receipt.thinkSequence, pressure: input.capacityPressure!(), work: input.work.receipt.used };
  });
  const next = retain(keys);
  expect(next.sequence).toBe(2); expect(next.work).toBe(0);
  expect(next.pressure).toContainEqual(expect.objectContaining({ kind: `field-${mover}`, thinkSequence: 2,
    planIds: [id], entries: 65, limitEntries: 64 }));
  expect(memory.strategy!.observation.fields[mover]).toHaveLength(65);
  memory = JSON.parse(JSON.stringify(memory));
  const released = retain(keys.slice(0, 64));
  expect(released.sequence).toBe(3); expect(released.work).toBe(0);
  expect(released.pressure.some(pressure => pressure.kind === `field-${mover}`)).toBe(false);
  expect(memory.strategy!.observation.fields[mover]).toHaveLength(64);
  expect(JSON.stringify(snapshot)).toBe(before);
});
