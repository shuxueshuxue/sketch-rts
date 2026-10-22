import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import { measureGoalPlanningResidency } from './goal-planning-residency';
import type { GoalPlannerOutput } from './goal-planner-types';
import type { Objective } from './types';

const directory = new URL('./__fixtures__/goal-seat-residency/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as { entries: {
  index: number; file: string; map: string; owner: string; tick: number; version: BootstrapAiVersion;
  goalIds: string[]; gzipSha256: string; plainSha256: string; snapshotSha256: string;
}[] };
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Original maximum-goal frames, including goals missing from the old
 * truncated cache. Both the exact recorded objective input and the ordinary
 * current owner/allocator entry are measured. Commands are never applied. */
it.each(manifest.entries.filter(row => !process.env.SKETCH_GOAL_SEAT_CASE || row.index === Number(process.env.SKETCH_GOAL_SEAT_CASE)))
  ('keeps the complete97f seat resident below half of256KiB: $map/$owner/$tick', row => {
    const compressed = readFileSync(new URL(row.file, directory)), plain = gunzipSync(compressed);
    expect(digest(compressed)).toBe(row.gzipSha256); expect(digest(plain)).toBe(row.plainSha256);
    const frame = JSON.parse(plain.toString()) as { snapshot: GameSnapshot; memoryBefore: AiPolicyMemory | null; objectives: Objective[] };
    const snapshot = JSON.stringify(frame.snapshot); expect(digest(snapshot)).toBe(row.snapshotSha256);
    let memory = structuredClone(frame.memoryBefore ?? createAiPolicyMemory()), ownerMemory = structuredClone(memory), off = structuredClone(memory);
    const rows = [];
    for (let think = 1; think <= 20; think++) {
      planAiOwnerCommandEntries(frame.snapshot, { playerId: row.owner, version: row.version, memory: off }, { strategyControl: false });
      const output = withGoalPlannerInput({ snapshot: frame.snapshot, owner: row.owner, version: row.version, memory, objectives: frame.objectives }, input => {
        const output = planGoals(input); memory.goalPlanning!.cache = output.cache; return output;
      });
      expect(output.plans.map(plan => plan.goal.id).sort()).toEqual([...row.goalIds].sort());
      expect(output.cache.entries).toHaveLength(row.goalIds.length);
      let ordinary: GoalPlannerOutput | undefined;
      planAiOwnerCommandEntries(frame.snapshot, { playerId: row.owner, version: row.version, memory: ownerMemory }, {
        strategyControl: true, observeBootstrapPlan(_context, _commands, output) { ordinary = output?.goalPlanner; },
      });
      if (!ordinary) throw Error('Missing ordinary owner planner output');
      expect(ordinary.cache.entries).toHaveLength(ordinary.plans.length);
      const recorded = measureGoalPlanningResidency(memory, off), owner = measureGoalPlanningResidency(ownerMemory, off);
      rows.push({ think, recorded, owner, originalGoalIds: row.goalIds, ordinaryGoalIds: ordinary.plans.map(plan => plan.goal.id) });
      expect(recorded.chargedTotalBytes, JSON.stringify(rows)).toBeLessThanOrEqual(128 * 1024);
      expect(owner.chargedTotalBytes, JSON.stringify(rows)).toBeLessThanOrEqual(128 * 1024);
      expect(memory.strategy!.observation!.factWork!.used).toBeLessThanOrEqual(6144);
      expect(ownerMemory.strategy!.observation!.factWork!.used).toBeLessThanOrEqual(6144);
      expect(JSON.stringify(frame.snapshot)).toBe(snapshot);
      memory = JSON.parse(JSON.stringify(memory)); ownerMemory = JSON.parse(JSON.stringify(ownerMemory)); off = JSON.parse(JSON.stringify(off));
    }
    if (process.env.SKETCH_GOAL_SEAT_EVIDENCE) {
      mkdirSync(process.env.SKETCH_GOAL_SEAT_EVIDENCE, { recursive: true });
      writeFileSync(`${process.env.SKETCH_GOAL_SEAT_EVIDENCE}/${row.index}.json`, JSON.stringify({ input: row, rows }));
    }
  }, 600_000);
