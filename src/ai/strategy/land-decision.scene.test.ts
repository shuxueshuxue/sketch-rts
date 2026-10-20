import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { generateLandObjectives, decomposeLandObjective, landIdleForces } from './land-objectives';
import { decisionProjection } from './explanations';
import { buildObservedStrategyDecision, buildStrategyDecision, projectStrategyTrace } from './decision';
import { buildStrategyPlanTrace } from './plan';
import * as utility from './utility';
import { arrivalColumns, unitArrivalFacts, withUnitArrivals } from './unit-arrivals';
import type { PlanningContext, Situation } from './types';
import reference from './fixtures/land-explanation-reference.json';
import collectorReference from './fixtures/control-land-explanation-reference.json';

type Frame = { event: string; context: PlanningContext; situation: Situation };
// Test-only ownership: deliberately mutate cloned inputs after evaluation.
type Mutable<T> = T extends (...args: never[]) => unknown ? T
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
// Only Situation needs a writable view; the snapshot and policy memory already
// permit these mutations. Keep the full planning context's native types intact.
type MutableFrame = Omit<Frame, 'situation'> & { situation: Mutable<Situation> };
const frames: Frame[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/land-objective-event-frames.json.gz', import.meta.url))).toString()).cases;
// The clone owns every nested value. Cross unknown to avoid recursively
// comparing the entire read-only planning/allocation graph for this test cast.
const scene = (event: string) => structuredClone(frames.find(frame => frame.event === event)!) as unknown as MutableFrame;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const numerical = (value: unknown) => JSON.stringify(value, (key, item) => ['evidence', 'detail', 'explanation'].includes(key) ? undefined : item);
function observe({ situation, context }: Frame) {
  const objectives = generateLandObjectives(situation, context);
  return { objectives, methods: objectives.flatMap(goal => decomposeLandObjective(situation, goal, context)),
    idleForces: landIdleForces(situation, objectives) };
}
function verifyFacts(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    expect(['evidence', 'detail', 'explanation']).not.toContain(key);
    verifyFacts(item);
  }
}
function denyExplanations(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (['evidence', 'detail', 'explanation'].includes(key)) Object.defineProperty(value, key, {
      enumerable: true, configurable: true, get() { throw new Error(`Decision read explanation: ${key}`); },
    });
    else denyExplanations((value as Record<string, unknown>)[key]);
  }
}

describe('land numerical decisions and requested explanation projection', () => {
  it('binds the collector fact revision to the unchanged land frames and previous hashes', () => {
    expect(createHash('sha256').update(readFileSync(new URL('./fixtures/land-objective-event-frames.json.gz', import.meta.url))).digest('hex'))
      .toBe(collectorReference.inputSha256);
    for (const row of collectorReference.cases) {
      const previous = reference.cases.find(previous => previous.event === row.event)!;
      expect(row.previousPlanSha256).toBe(previous.planSha256);
      expect(row.previousObservationSha256).toBe(previous.observationSha256);
    }
  });
  it.each(reference.cases)('$event preserves every land explanation byte across cold/warm and decision/observation modes', row => {
    const frame = scene(row.event), expected = observe(structuredClone(frame));
    expect(digest(expected)).toBe(row.landSha256);
    // No reason text, evidence, or label is a numerical dependency, even on a cold build.
    const denied = structuredClone(frame); denyExplanations(denied.situation);
    const coldFacts = decisionProjection(() => observe(denied), false).facts;
    verifyFacts(coldFacts);
    expect(JSON.stringify(coldFacts)).toBe(numerical(expected));
    // Warm from decision-only: cached assessments must contain no readers tied
    // to that non-observed call, and the second evaluation must reuse its work.
    decisionProjection(() => observe(frame), false);
    const work = vi.spyOn(utility, 'forceTimeGold');
    try {
      const projected = decisionProjection(() => observe(frame));
      expect(work).not.toHaveBeenCalled();
      verifyFacts(projected.facts);
      expect(JSON.stringify(projected.explain!())).toBe(JSON.stringify(expected));
      expect(JSON.stringify(decisionProjection(() => observe(frame), false).facts)).toBe(numerical(expected));
    } finally { work.mockRestore(); }
  });

  it.each(reference.cases)('$event consumes compact arrival rows without materializing the public array', row => {
    const frame = scene(row.event), expected = JSON.stringify(observe(structuredClone(frame)));
    const columns = arrivalColumns([...new Set(frame.situation.units.flatMap(unit => unit.arrivals.map(entry => entry.targetId)))]);
    let arrayReads = 0;
    const units = frame.situation.units.map(({ arrivals, ...facts }) => {
      const values = columns.ids.map(targetId => arrivals.find(entry => entry.targetId === targetId)?.arrival);
      const unit = withUnitArrivals(facts, { columns, values, count: arrivals.length });
      Object.defineProperty(unit, 'arrivals', { enumerable: true, get() {
        arrayReads++; throw new Error('Land quotation materialized the compatibility arrival array');
      } });
      return unit;
    });
    const compact: Frame = { ...frame, situation: { ...frame.situation, units } };
    const numericalFacts = decisionProjection(() => observe(compact), false).facts;
    verifyFacts(numericalFacts);
    expect(JSON.stringify(numericalFacts)).toBe(numerical(JSON.parse(expected)));
    const projected = decisionProjection(() => observe(compact));
    expect(JSON.stringify(projected.explain!())).toBe(expected);
    expect(JSON.stringify(decisionProjection(() => observe(compact), false).facts)).toBe(JSON.stringify(numericalFacts));
    expect(arrayReads).toBe(0);
    expect(units.every(unit => !Object.hasOwn(unitArrivalFacts(unit)!, 'rendered'))).toBe(true);
  });

  it('rebinds a warm assessment at the next think and projects the original evaluation after its inputs change', () => {
    const frame = scene('L2');
    decisionProjection(() => observe(frame), false);
    frame.context.snapshot.tick += 15; frame.situation.tick += 15;
    const expected = JSON.stringify(observe(structuredClone(frame)));
    const captured = decisionProjection(() => observe(frame));
    frame.situation.tick += 300;
    for (const unit of frame.situation.units) { unit.id += '-changed'; unit.strength = 0; unit.commitments.length = 0; }
    for (const op of frame.situation.opportunities) { op.id += '-changed'; op.evidence = []; }
    frame.situation.units.length = 0; frame.context.snapshot.units.length = 0;
    frame.context.memory.unitClaims = {};
    expect(JSON.stringify(captured.explain!())).toBe(expected);
    expect(JSON.stringify(captured.explain!())).toBe(expected);
  });

  it.each(collectorReference.cases)('$event retains the audited collector facts with the default land family', row => {
    const frame = scene(row.event), fullContext = structuredClone(frame.context), observedContext = structuredClone(frame.context);
    const build = (context: PlanningContext) => {
      const { snapshot, owner, memory } = context;
      setBuildingBodies(snapshot.map, standingBodies(snapshot));
      return buildStrategyPlanTrace(snapshot, owner, { memory }, undefined, undefined, undefined, Infinity);
    };
    const full = build(fullContext);
    expect(digest(full)).toBe(row.planSha256);
    expect(digest(fullContext.memory.strategy!.observation)).toBe(row.observationSha256);
    const { snapshot, owner, memory } = observedContext;
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const observed = buildObservedStrategyDecision(snapshot, owner, { memory }, undefined, undefined, Infinity);
    verifyFacts(observed);
    expect(JSON.stringify(projectStrategyTrace(observed))).toBe(JSON.stringify(full));
    const factsContext = structuredClone(frame.context);
    setBuildingBodies(factsContext.snapshot.map, standingBodies(factsContext.snapshot));
    const facts = buildStrategyDecision(factsContext.snapshot, owner, { memory: factsContext.memory }, undefined, undefined, Infinity);
    verifyFacts(facts);
    expect(JSON.stringify(facts)).toBe(numerical(full));
    expect(JSON.stringify(memory)).toBe(JSON.stringify(fullContext.memory));
    expect(JSON.stringify(factsContext.memory)).toBe(JSON.stringify(fullContext.memory));
  }, 30000);
});
