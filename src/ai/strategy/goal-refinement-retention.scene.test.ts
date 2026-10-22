import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import type { GameSnapshot } from '../../shared/types';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import { readCachePayload } from './cache-payload';
import { observationJsonBytes } from './observation-json-bytes';

it('stabilizes the original near t1800 refinement without evicting its selected transport quote behind old income prices', () => {
  const compressed = readFileSync(new URL('./fixtures/goal-refinement-near-12ec-t1800.json.gz', import.meta.url));
  expect(createHash('sha256').update(compressed).digest('hex')).toBe('d2d631a35b3bfa094782a52cd55336f8685e35fd1ae8a571fc55940ab8b00b2d');
  const frame: { snapshot: GameSnapshot; memoryBefore: AiPolicyMemory } = JSON.parse(gunzipSync(compressed).toString());
  const snapshotBefore = JSON.stringify(frame.snapshot), memory = JSON.parse(JSON.stringify(frame.memoryBefore)) as AiPolicyMemory;
  const passes: [number, number][] = [];
  const run = () => withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
    () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot: frame.snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
      const refine = input.refineSelected!;
      return planGoals({ ...input, refineSelected(plan) {
        const before = memory.goalPlanning!.refinements!.revision, output = refine(plan);
        passes.push([before, memory.goalPlanning!.refinements!.revision]); return output;
      } });
    })));
  let output = run();
  expect(passes.length).toBeLessThanOrEqual(3);
  expect(passes.at(-1)![0]).toBe(passes.at(-1)![1]);
  expect(output.plans[0]!.actions.filter(row => row.declaration.kind === 'transport-force').every(row =>
    (row.declaration.executor.parameters.cohort as unknown[]).length === 4)).toBe(true);
  expect(output.plans[0]!.status).toBe('ready');
  expect(output.plans[0]!.capacityPressure ?? []).toEqual([]);
  const receipt = memory.strategy!.observation.factWork!;
  expect(receipt.used).toBeLessThanOrEqual(6144);
  expect(receipt.services.reduce((sum, service) => sum + service.work, 0)).toBe(receipt.used);
  expect(observationJsonBytes(output.cache)).toBeLessThanOrEqual(256 * 1024);
  expect(readCachePayload(JSON.parse(JSON.stringify(output.cache)))).toEqual(readCachePayload(output.cache));
  for (let next = 0; next < 2; next++) {
    memory.goalPlanning!.cache = output.cache;
    Object.assign(memory, JSON.parse(JSON.stringify(memory)));
    output = run();
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
  }
  const ready = output.readyActions.find(row => row.action.declaration.kind === 'transport-force')!.action;
  expect(ready).toBeDefined();
  expect(ready.declaration.executor.parameters.cohort).toHaveLength(4);
  expect(ready.startTick).toBe(frame.snapshot.tick);
  for (const window of ready.declaration.preconditionWindows!) {
    const fact = ready.declaration.preconditions.find(fact => fact.id === window.factId)!;
    expect(fact.predicate).toMatchObject({ throughTick: ready.finishTick });
  }
  expect(output.plans[0]!.actions.find(row => row.declaration.kind === 'assemble')).toMatchObject({
    state: 'world-effects-met', startTick: frame.snapshot.tick, finishTick: frame.snapshot.tick,
    declaration: { flows: expect.arrayContaining([expect.objectContaining({ delta: -4,
      resource: expect.objectContaining({ kind: 'force', scope: 'pool', metric: 'combat-rating' }) }),
      expect.objectContaining({ delta: 4, resource: expect.objectContaining({ kind: 'force', scope: 'post', metric: 'combat-rating' }) })]) },
  });
  expect(output.plans[0]!.resourceTimeline.every(event => event.after >= 0)).toBe(true);
  expect(passes.at(-1)![0]).toBe(passes.at(-1)![1]);
  expect(JSON.stringify(frame.snapshot)).toBe(snapshotBefore);
}, 30000);
