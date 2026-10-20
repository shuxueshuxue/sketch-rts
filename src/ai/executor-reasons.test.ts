import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from './memory';
import { planAiOwnerCommandEntries } from './planner-context';
import { buildAiPlanTrace } from './plan-trace';
import { applyAiPlanDelta, diffAiPlan } from './plan-stream';
import { beginExecutorReasons, executorReasonsAt } from './executor-reasons';
import { executorBehaviorMemory } from './executor-reasons.test-utils';
import { bootstrapPolicyContext } from './bootstrap_1/policy';
import { assessBootstrapCamp } from './bootstrap_1/camp-geometry';
import { continueV7Creep, creepForce, forceFor, neutralCamps } from './policy/v7/creep';
import { readV6Intel } from './policy/v6/intel';

const saved = JSON.parse(gunzipSync(readFileSync(new URL('./bootstrap_1/fixtures/executor-broken-sea-9585.json.gz', import.meta.url))).toString());
function frame() {
  const snapshot = structuredClone(saved.snapshot) as GameSnapshot, memory = structuredClone(saved.beforeMemory) as AiPolicyMemory;
  return { snapshot, memory };
}

it('reports the real broken-sea geometry blocker with enough force and byte-identical commands and behavior memory', () => {
  const { snapshot, memory } = frame(), entities = JSON.stringify([snapshot.units, snapshot.buildings]);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_knight', memory }, { ...(snapshot.teams ? { teams: snapshot.teams } : {}) });
  expect(JSON.stringify(entries)).toBe(JSON.stringify(saved.expectedEntries));
  expect(createHash('sha256').update(JSON.stringify(executorBehaviorMemory(memory))).digest('hex')).toBe(saved.expectedBehaviorMemorySha256);
  expect(JSON.stringify([snapshot.units, snapshot.buildings])).toBe(entities);
  expect(memory.naval!.conquests!['gold-mainland-0']!.reason).toBe('blocked:clearing-geometry-blocked');
  const trace = buildAiPlanTrace(snapshot, 'p0', memory, 'v9_knight');
  const reason = trace.executorReasons!.find(reason => reason.outcome === 'blocked' && reason.executor === 'creep.selection')!;
  expect(reason).toMatchObject({ reason: 'clearing-geometry-blocked', taskId: 'island:gold-mainland-0:3060' });
  const camp = neutralCamps(snapshot).find(camp => camp.creeps.some(unit => unit.id === 'guard-0-0'))!;
  const fighters = snapshot.units.filter(unit => reason.unitIds!.includes(unit.id));
  expect(fighters).toHaveLength(6);
  expect(creepForce(fighters, camp)).toBeGreaterThan(forceFor(camp));
  expect(applyAiPlanDelta(undefined, diffAiPlan(undefined, trace, 1))).toEqual(trace);
  expect(JSON.stringify(memory)).not.toContain('executorReasons');
});

it('distinguishes insufficient force before attempting geometry', () => {
  const { snapshot } = frame(), memory = createAiPolicyMemory();
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory, ...(snapshot.teams ? { teams: snapshot.teams } : {}) });
  options.executorReason = beginExecutorReasons(memory, snapshot.tick);
  const camp = neutralCamps(snapshot).find(camp => camp.creeps.some(unit => unit.id === 'guard-0-0'))!;
  const unit = snapshot.units.find(unit => unit.id === 'unit-p0-emberRavager-1097')!;
  const assessment = assessBootstrapCamp(unit, snapshot, [unit], neutralCamps(snapshot), [camp], options, camp.center);
  expect(assessment).toEqual({ reason: 'insufficient-clearing-force' });
  expect(executorReasonsAt(memory, snapshot.tick)!.every(reason => reason.reason === 'insufficient-clearing-force')).toBe(true);
});

it('reports a real defense claim as recall instead of death or combat wear', () => {
  const { snapshot } = frame(), memory = createAiPolicyMemory();
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory, ...(snapshot.teams ? { teams: snapshot.teams } : {}) });
  options.executorReason = beginExecutorReasons(memory, snapshot.tick);
  const camp = neutralCamps(snapshot).find(camp => camp.creeps.some(unit => unit.id === 'guard-0-0'))!;
  const fighters = snapshot.units.filter(unit => ['unit-p0-emberRavager-1097', 'unit-p0-emberRavager-1117', 'unit-p0-emberRavager-1141'].includes(unit.id));
  const hall = snapshot.buildings.find(building => building.owner === 'p0' && building.kind === 'townHall')!;
  for (const unit of fighters) memory.unitClaims[unit.id] = { kind: 'mineRally', targetId: hall.id, x: hall.x, y: hall.y,
    sinceTick: snapshot.tick, expiresTick: snapshot.tick + 1000 };
  memory.v6!.creep = { center: camp.center, reach: camp.reach, staging: fighters[0]!, stage: 'gather', since: snapshot.tick - 501, group: fighters.map(unit => unit.id) };
  const intel = readV6Intel(snapshot, 'p0', options);
  expect(continueV7Creep(snapshot, 'p0', [], neutralCamps(snapshot), intel, options)).toBeUndefined();
  expect(executorReasonsAt(memory, snapshot.tick)).toContainEqual(expect.objectContaining({ reason: 'defense-task-recall' }));
  expect(memory.v6!.creep).toBeUndefined();
});

it('keeps branch evidence outside serialized memory, copies it, and expires it at the next think', () => {
  const memory = createAiPolicyMemory(), before = JSON.stringify(memory), record = beginExecutorReasons(memory, 10);
  record({ executor: 'test', outcome: 'blocked', reason: 'clearing-geometry-blocked', targetIds: ['guard'] });
  const exported = executorReasonsAt(memory, 10)!;
  exported[0]!.targetIds!.push('other');
  expect(executorReasonsAt(memory, 10)![0]!.targetIds).toEqual(['guard']);
  expect(JSON.stringify(memory)).toBe(before);
  expect(executorReasonsAt(JSON.parse(before), 10)).toBeUndefined();
  beginExecutorReasons(memory, 11);
  expect(executorReasonsAt(memory, 10)).toBeUndefined();
  expect(executorReasonsAt(memory, 11)).toBeUndefined();
});

it('does not hide retry counters, timestamps, stages or interruption reasons in the audit allowlist', () => {
  const memory = { landExpansion: { stage: 'assemble', reason: 'old', interruptions: [{ reason: 'home-threat' }] },
    naval: { ferryFailures: { boat: { mine: { reason: 'landing-defense', attempts: 2, tick: 10 } } } } };
  const same = structuredClone(memory);
  same.landExpansion.reason = 'clearing-geometry-blocked';
  same.naval.ferryFailures.boat.mine.reason = 'no-physical-progress';
  expect(executorBehaviorMemory(same)).toEqual(executorBehaviorMemory(memory));
  for (const mutate of [
    (value: typeof memory) => { value.landExpansion.stage = 'clear'; },
    (value: typeof memory) => { value.landExpansion.interruptions[0]!.reason = 'mine-threat'; },
    (value: typeof memory) => { value.naval.ferryFailures.boat.mine.attempts++; },
    (value: typeof memory) => { value.naval.ferryFailures.boat.mine.tick++; },
  ]) {
    const changed = structuredClone(memory); mutate(changed);
    expect(executorBehaviorMemory(changed)).not.toEqual(executorBehaviorMemory(memory));
  }
});
