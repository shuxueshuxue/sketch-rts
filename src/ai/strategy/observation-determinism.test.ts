import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { observationMemory, retainObservationHistory, OBSERVATION_BYTE_LIMIT } from './observation-memory';
import { buildStrategyPlanTrace } from './plan';

const cases = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
const scene = cases.find((scene: { event: string }) => scene.event === 'E05') as { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory };
function processRun(extra: Record<string, unknown> = {}) {
  return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/observation-worker.ts', import.meta.url))], {
    input: JSON.stringify({ ...scene, steps: 12, dropHallId: 'building-p0-townHall-8744', ...extra }),
    maxBuffer: 64 * 1024 * 1024, encoding: 'utf8',
  })) as { rows: string[]; saved: string[] };
}
describe('serialized strategy publication independent of process caches', () => {
  it('keeps even saturated observation history below the explicit serialization cap', () => {
    const frame = structuredClone(scene);
    const plan = buildStrategyPlanTrace(frame.snapshot, frame.owner, { memory: frame.memory });
    const state = observationMemory(frame.snapshot, frame.owner, frame.memory), prototype = plan.objectives[0]!;
    const objectives = Array.from({ length: 300 }, (_, index) => ({ ...prototype, id: `objective-${index}-${'x'.repeat(1000)}` }));
    retainObservationHistory(state, plan.situation, objectives);
    expect(Buffer.byteLength(JSON.stringify({ observation: state }))).toBeLessThanOrEqual(OBSERVATION_BYTE_LIMIT);
    expect(state.truncated).toBe(true);
    expect(state.landBodies.length).toBeLessThan(32);
  });
  it('matches every trace and observation byte in cold, other-owner-warm and reverse-target-warm processes', () => {
    const cold = processRun(), warm = processRun({ warm: 'other-owner' }), reverse = processRun({ warm: 'reverse' });
    expect(warm).toEqual(cold); expect(reverse).toEqual(cold);
    const history = JSON.parse(cold.saved.at(-1)!).strategy.observation.history;
    expect(history.lostSites.length).toBeGreaterThan(0);
    expect(history.objectives.length).toBeGreaterThan(0);
  }, 60000);
  it('restarts from the serialized mid-frame memory without a previous trace and reproduces the continuation exactly', () => {
    const continuous = processRun(), memory = JSON.parse(continuous.saved[5]!);
    const fork = processRun({ memory, start: 6, steps: 6 });
    expect(fork.rows).toEqual(continuous.rows.slice(6));
    expect(fork.saved).toEqual(continuous.saved.slice(6));
  }, 60000);
  it('reconstructs a published crossing table after process restart without changing ETA provenance', () => {
    const continuous = processRun({ tiny: true, steps: 20 }), memory = JSON.parse(continuous.saved[9]!);
    expect(memory.strategy.observation.crossings.length).toBeGreaterThan(0);
    const warm = processRun({ tiny: true, steps: 20, warm: 'reverse' });
    expect(warm).toEqual(continuous);
    const fork = processRun({ tiny: true, memory, start: 10, steps: 10 });
    expect(fork.rows).toEqual(continuous.rows.slice(10)); expect(fork.saved).toEqual(continuous.saved.slice(10));
  }, 60000);
  it('preserves decision projections and saved history in independent warm processes and a restarted process', () => {
    const continuous = processRun({ decision: true });
    expect(processRun({ decision: true, warm: 'other-owner' })).toEqual(continuous);
    expect(processRun({ decision: true, warm: 'reverse' })).toEqual(continuous);
    const fork = processRun({ decision: true, memory: JSON.parse(continuous.saved[5]!), start: 6, steps: 6 });
    expect(fork.rows).toEqual(continuous.rows.slice(6)); expect(fork.saved).toEqual(continuous.saved.slice(6));
  }, 60000);
  it('keeps unobserved decision facts and observation history deterministic without collecting trace projections', () => {
    const observed = processRun({ decision: true }), continuous = processRun({ factsOnly: true });
    const strip = (key: string, value: unknown) => ['evidence', 'detail', 'explanation'].includes(key) ? undefined : value;
    expect(continuous.rows).toEqual(observed.rows.map(row => JSON.stringify(JSON.parse(row), strip)));
    expect(continuous.saved).toEqual(observed.saved);
    expect(processRun({ factsOnly: true, warm: 'other-owner' })).toEqual(continuous);
    expect(processRun({ factsOnly: true, warm: 'reverse' })).toEqual(continuous);
    const fork = processRun({ factsOnly: true, memory: JSON.parse(continuous.saved[5]!), start: 6, steps: 6 });
    expect(fork.rows).toEqual(continuous.rows.slice(6)); expect(fork.saved).toEqual(continuous.saved.slice(6));
  }, 60000);
});
