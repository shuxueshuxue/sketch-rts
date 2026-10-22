import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import { readCachePayload } from './cache-payload';
import { withGoalPlanningMemory } from './goal-planning-restore';
import { goalPlanningResidentBytes, hydrateGoalPlanningValue, retainGoalPlanningReferences } from './goal-planning-references';

const directory = new URL('./__fixtures__/goal-search-retention/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
const bytes = readFileSync(new URL('d888-far4500.original.jsonl.gz', directory));
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const original = JSON.parse(gunzipSync(bytes).toString());

it('rebuilds the two original far4500 compared graphs as uncompressed selected records and reference-root GC', () => {
  expect(sha(bytes)).toBe(manifest.gzipSha256); expect(sha(gunzipSync(bytes))).toBe(manifest.plainSha256);
  expect(original.snapshot.tick).toBe(4500);
  const before = readCachePayload(original.memoryAfter.goalPlanning.cache) as readonly any[];
  expect(before.map(entry => entry.continuation.candidates.length)).toEqual([80, 243]);
  const memory: AiPolicyMemory = structuredClone(original.memoryAfter), snapshot = JSON.stringify(original.snapshot);
  withGoalPlanningMemory(memory, () => {
    const cache = memory.goalPlanning!.cache!;
    expect(cache.packedEntries).toBeUndefined();
    const records = hydrateGoalPlanningValue(cache.entries) as readonly any[];
    expect(records).toHaveLength(2);
    expect(records.map(entry => entry.plan.goal.id)).toEqual(before.map(entry => entry.plan.goal.id));
    for (const [index, entry] of records.entries()) {
      const prior = before[index]!;
      expect(entry.plan.actions.map((node: any) => node.declaration.kind)).toEqual(prior.plan.actions.map((node: any) => node.declaration.kind));
      expect(entry.plan.actions.map((node: any) => [node.startTick, node.finishTick])).toEqual(prior.plan.actions.map((node: any) => [node.startTick, node.finishTick]));
      for (const factId of new Set(entry.plan.alternatives.map((alternative: any) => alternative.factId))) {
        const selected = new Set(entry.plan.actions.map((node: any) => node.declaration.id));
        expect(entry.plan.alternatives.filter((alternative: any) => alternative.factId === factId
          && !selected.has(alternative.declaration?.id ?? alternative.actionId)).length).toBeLessThanOrEqual(1);
      }
      expect(entry.continuation.visited).toEqual([]); expect(entry.continuation.regressed).toEqual([]);
    }
    expect(Buffer.byteLength(JSON.stringify(cache))).toBeLessThanOrEqual(262144);
    expect(goalPlanningResidentBytes(cache)).toBeLessThanOrEqual(262144);
  });
  const wire = JSON.parse(JSON.stringify(memory)), references = wire.goalPlanningReferences;
  const reachable = retainGoalPlanningReferences(references, [wire.goalPlanning, wire.strategyAllocation, references.priorDeclarations]);
  expect(Object.keys(reachable.entries).sort()).toEqual(Object.keys(references.entries).sort());
  expect(JSON.stringify(original.snapshot)).toBe(snapshot);
});

it('does not resurrect serialized observations as current world proof', () => {
  const memory: AiPolicyMemory = structuredClone(original.memoryAfter);
  withGoalPlanningMemory(memory, () => {
    const cache = memory.goalPlanning!.cache!;
    expect(() => readCachePayload(cache)).toThrow('current fact observations');
    const record = hydrateGoalPlanningValue(cache.entries)[0]! as any;
    expect(record.plan.facts.every((node: any) => node.fact && !node.observation)).toBe(true);
    expect(record.plan.facts.every((node: any) => !('state' in node))).toBe(true);
  });
});
