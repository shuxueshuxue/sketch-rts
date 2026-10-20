import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntriesWithDecision } from '../strategy-decision-planner';
import { planAiOwnerCommandEntriesWithTrace } from '../plan-trace-planner';
import { buildObservedStrategyDecision, buildStrategyDecision, projectStrategyTrace } from './decision';
import { buildStrategyPlanTrace } from './plan';
import { decisionProjection, deferredEvidence, projectedCopy } from './explanations';
import reference from './fixtures/explanation-reference.json';

type Frame = { event: string; snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory };
const frames: Frame[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
function verifyFacts(value: unknown, path = 'decision', visited = new WeakSet<object>()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const [key, item] of Object.entries(value)) {
    expect(['evidence', 'detail', 'explanation'], `${path}.${key}`).not.toContain(key);
    verifyFacts(item, `${path}.${key}`, visited);
  }
}

describe('decision facts and requested explanations', () => {
  it('does not construct evidence while copying or reading numerical facts', () => {
    let renders = 0;
    const facts = deferredEvidence({ status: 'reachable', ticks: 120 }, () => {
      renders++; return [{ source: 'test', tick: 10, certainty: 'recorded' as const, detail: 'one projection' }];
    });
    const copy = projectedCopy(facts, { ticks: 180 });
    expect(copy.ticks).toBe(180); expect(renders).toBe(0);
    expect(JSON.stringify(copy)).toBe('{"status":"reachable","ticks":180,"evidence":[{"source":"test","tick":10,"certainty":"recorded","detail":"one projection"}]}');
    expect(copy.evidence).toEqual(facts.evidence); expect(renders).toBe(1);
  });
  it('restores the projection boundary after a failed evaluator', () => {
    expect(() => decisionProjection(() => { throw new Error('stop evaluation'); })).toThrow('stop evaluation');
    const trace = deferredEvidence({ ticks: 12 }, () => []);
    expect(Object.hasOwn(trace, 'evidence')).toBe(true);
    expect(JSON.stringify(trace)).toBe('{"ticks":12,"evidence":[]}');
  });
  it.each(['E01', 'E02', 'Nd', 'Ne'])('keeps diagnostic attributes out of the %s decision graph', event => {
    const frame = structuredClone(frames.find(frame => frame.event === event)!);
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    verifyFacts(buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, { healing: [] }, Infinity));
  });

  it.each(reference.cases)('preserves every explanation and memory byte from $event before the split', row => {
    const frame = frames.find(frame => frame.event === row.event)!;
    for (const decision of [false, true]) {
      const bytes = execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/observation-worker.ts', import.meta.url))], {
        input: JSON.stringify({ ...frame, steps: reference.steps, decision, navalOnly: true }), maxBuffer: 64 * 1024 * 1024,
      });
      expect(createHash('sha256').update(bytes).digest('hex'), `decision=${decision}`).toBe(row.sha256);
    }
  }, 60000);

  it('projects the original evaluation after the caller changes its world and memory', () => {
    const frame = structuredClone(frames.find(frame => frame.event === 'E05')!);
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    const expected = JSON.stringify(buildStrategyPlanTrace(frame.snapshot, frame.owner, { memory: structuredClone(frame.memory) },
      undefined, undefined, { healing: [] }, Infinity));
    const decision = buildObservedStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, { healing: [] }, Infinity);
    expect(decision.situation.units.reduce((sum, unit) => sum + unit.strength, 0)).toBeGreaterThan(0);
    const own = decision.situation.units.find(unit => unit.owner === frame.owner && unit.commitments.length)!;
    expect(own.commitments[0]!.source.length).toBeGreaterThan(0);
    const arrival = decision.situation.units.flatMap(unit => unit.arrivals).find(entry => 'ticks' in entry.arrival)!.arrival;
    expect(Object.hasOwn(arrival, 'evidence')).toBe(false);
    expect(Object.hasOwn(own.commitments[0]!, 'evidence')).toBe(false);
    expect(Object.hasOwn(decision.objectives[0]!.utility, 'evidence')).toBe(false);
    verifyFacts(decision);
    frame.snapshot.tick += 300;
    for (const unit of frame.snapshot.units) { unit.id += '-changed'; unit.x += 500; unit.hp = 0; }
    for (const hall of frame.snapshot.buildings) { hall.complete = !hall.complete; hall.hp = 0; }
    frame.snapshot.units.length = 0; frame.snapshot.buildings.length = 0;
    frame.memory.unitClaims = {}; delete frame.memory.naval;
    expect(JSON.stringify(projectStrategyTrace(decision))).toBe(expected);
    expect(JSON.stringify(projectStrategyTrace(decision))).toBe(expected);
  });

  it('uses one ordinary think in either boundary and changes no command or policy field', () => {
    const source = frames.find(frame => frame.event === 'Nd')!, a = structuredClone(source), b = structuredClone(source);
    const request = { playerId: source.owner, source: 'ai' as const, version: 'v9_archer' as const };
    const before = JSON.stringify(a.snapshot);
    const control = planAiOwnerCommandEntriesWithTrace(a.snapshot, { ...request, memory: a.memory });
    const observed = planAiOwnerCommandEntriesWithDecision(b.snapshot, { ...request, memory: b.memory });
    expect(observed.commands).toEqual(control.commands);
    expect(JSON.stringify(b.memory)).toBe(JSON.stringify(a.memory));
    expect(JSON.stringify(b.snapshot)).toBe(before);
    expect(JSON.stringify(observed.decision)).toBe(JSON.stringify(control.trace.strategy,
      (key, value) => ['evidence', 'detail', 'explanation'].includes(key) ? undefined : value));
  });

  it('rebinds changed unit facts and memberships exactly as a cold saved frame does', () => {
    const frame = structuredClone(frames.find(frame => frame.event === 'E05')!);
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    const unit = frame.snapshot.units.find(unit => unit.owner === frame.owner && !unit.deck && !unit.cabin && unit.kind !== 'worker')!;
    const first = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, { healing: [] }, Infinity);
    const initialBytes = JSON.stringify(first);
    const changes = [() => { unit.hp *= .8; }, () => { unit.x += 32; },
      () => { unit.expiresTick = frame.snapshot.tick + 1; },
      () => { const claim = frame.memory.unitClaims[unit.id]; if (claim) claim.targetId += '-changed'; },
      () => { delete frame.memory.unitClaims[unit.id]; unit.hp = 0; }];
    for (const change of changes) {
      change(); frame.snapshot.tick += 15;
      const cold = structuredClone(frame);
      setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
      const warm = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, { healing: [] }, Infinity);
      expect(JSON.stringify(warm)).toBe(JSON.stringify(buildStrategyDecision(cold.snapshot, cold.owner, { memory: cold.memory }, undefined, { healing: [] }, Infinity)));
      expect(JSON.stringify(frame.memory)).toBe(JSON.stringify(cold.memory));
      expect(JSON.stringify(first)).toBe(initialBytes);
    }
  });
});
