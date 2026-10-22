import { describe, expect, it } from 'vitest';
import { assessColdSemantic, countSemanticSwitches, semanticIdentity, semanticStepKey, validateSemanticFrames,
  type SemanticFrame, type SemanticIncumbent, type SemanticStep } from './goal-semantic-judgment';

function plan(): SemanticIncumbent {
  return { goalId: 'island', condition: { state: 'valid' }, ready: ['yard'], steps: [
    { id: 'yard', selector: { provider: 'economy', kind: 'build', grounding: { buildingKind: 'shipyard', x: 1, y: 2 } },
      bindings: { worker: { kind: 'existing', entityId: 'worker-1' } }, dependsOn: [] },
    { id: 'ship', selector: { provider: 'economy', kind: 'train', grounding: { unitKind: 'transport', count: 1 } },
      bindings: { producer: { kind: 'step-output', step: 'yard', output: 'building' } }, dependsOn: ['yard'] },
  ] };
}
function row(think: number, incumbent: SemanticIncumbent | null = plan(), extra: Partial<SemanticFrame> = {}): SemanticFrame {
  return { run: 'run-1', seat: 'owner', goalId: 'island', tick: think * 15, think, incumbent,
    complete: incumbent !== null, puzzleCheck: 'passed', allocation: 'observed', ...extra };
}
const twenty = (make = (i: number) => row(i)) => Array.from({ length: 20 }, (_, i) => make(i + 1));
const cold = (rows: readonly SemanticFrame[]) => assessColdSemantic(rows, { k: 20, tail: 3, requireAllocation: true });
const switches = (rows: readonly SemanticFrame[]) => countSemanticSwitches(rows, { startTick: 1, ticksPerMinute: 1200 });

describe('frozen semantic identities', () => {
  it('matches the agreed full global key without local labels or truncated hashes', () => {
    const selector = plan().steps[0]!.selector;
    expect(semanticStepKey('island', selector)).toBe('goal-step:1:["island","economy","build",[["buildingKind","shipyard"],["x",1],["y",2]]]');
    expect(semanticStepKey('other', selector)).not.toBe(semanticStepKey('island', selector));
    expect(semanticStepKey('island', { ...selector, provider: 'naval' })).not.toBe(semanticStepKey('island', selector));
    expect(semanticStepKey('island', { ...selector, grounding: { y: 2, x: 1, buildingKind: 'shipyard' } })).toBe(semanticStepKey('island', selector));
  });
  it('survives JSON, local renumbering, field/array order and quote/clock changes', () => {
    const before = plan(), unchanged = JSON.stringify(before);
    const after = JSON.parse(JSON.stringify(before)) as SemanticIncumbent;
    const steps = [...after.steps].reverse().map(s => ({ ...s, id: `new-${s.id}`, dependsOn: s.dependsOn.map(x => `new-${x}`),
      startOffsetTicks: 500, finishOffsetTicks: 600, scheduledAtTick: 999, quote: { costGold: 1000, basis: 'forecast' },
      bindings: s.id === 'ship' ? { producer: { kind: 'step-output', step: 'new-yard', output: 'building' } } : s.bindings }));
    expect(semanticIdentity({ ...after, steps, ready: ['new-yard'] }).decision).toBe(semanticIdentity(before).decision);
    expect(JSON.stringify(before)).toBe(unchanged);
  });
  it('keeps local future output conditional and agrees with globalized output', () => {
    const before = plan(), key = semanticStepKey('island', before.steps[0]!.selector);
    const after = { ...before, steps: before.steps.map(s => s.id === 'ship' ? { ...s,
      bindings: { producer: { kind: 'output', actionId: key, output: 'building' } } } : s) };
    expect(semanticIdentity(after).plan).toBe(semanticIdentity(before).plan);
    expect(semanticIdentity(before).plan).not.toContain('"entityId":"goal-step:');
  });
  it('counts provider, grounding, actual/conditional binding and topology changes', () => {
    const before = plan(), original = semanticIdentity(before).plan;
    const edit = (change: (s: SemanticStep) => SemanticStep) => semanticIdentity({ ...before, steps: before.steps.map(s => s.id === 'yard' ? change(s) : s) }).plan;
    expect(edit(s => ({ ...s, selector: { ...s.selector, provider: 'other' } }))).not.toBe(original);
    expect(edit(s => ({ ...s, selector: { ...s.selector, grounding: { ...s.selector.grounding, x: 2 } } }))).not.toBe(original);
    expect(edit(s => ({ ...s, bindings: { worker: { kind: 'existing', entityId: 'worker-2' } } }))).not.toBe(original);
    const noBinding = { ...before, steps: before.steps.map(s => s.id === 'ship' ? { ...s, bindings: {}, dependsOn: [] } : s) };
    expect(semanticIdentity(noBinding).plan).not.toBe(original);
  });
  it('compares the ready frontier for convergence but not for plan switching', () => {
    const before = plan(), after = { ...before, ready: ['ship'] };
    expect(semanticIdentity(before).plan).toBe(semanticIdentity(after).plan);
    expect(semanticIdentity(before).decision).not.toBe(semanticIdentity(after).decision);
    expect(switches([row(1, before), row(2, after)]).minutes[0]!.switches).toBe(0);
  });
  it('rejects malformed selectors and ambiguous or broken causal graphs', () => {
    for (const grounding of [{ x: Infinity }, { id: 'goal-v123' }, { nested: {} }])
      expect(() => semanticStepKey('island', { provider: 'x', kind: 'build', grounding: grounding as any })).toThrow();
    expect(() => semanticIdentity({ ...plan(), ready: ['missing'] })).toThrow('ready');
    expect(() => semanticIdentity({ ...plan(), steps: [...plan().steps, plan().steps[0]!] })).toThrow('Duplicate');
    expect(() => semanticIdentity({ ...plan(), steps: plan().steps.map(s => ({ ...s, dependsOn: ['ship'] })) })).toThrow('cyclic');
    expect(() => semanticIdentity({ ...plan(), steps: plan().steps.map(s => ({ ...s, dependsOn: [] })) })).toThrow('causal producer');
  });
});

describe('convergence and solving are independent gates', () => {
  it('reports a stable absent or empty plan as converged and unsolved', () => {
    for (const incumbent of [null, { ...plan(), steps: [], ready: [] }]) {
      const result = cold(twenty(i => row(i, incumbent)));
      expect(result.convergence.passed).toBe(true); expect(result.solving.passed).toBe(false);
      expect(result.solving.firstComplete).toBeNull(); expect(result.solving.firstReady).toBeNull();
    }
    expect(semanticIdentity(null).state).toBe('no-plan');
  });
  it('records first complete and first ready separately, without a think1 proxy', () => {
    const result = cold(twenty(i => i < 3 ? row(i, null) : row(i, { ...plan(), ready: i < 5 ? [] : ['yard'] })));
    expect(result.solving.passed).toBe(true); expect(result.convergence.passed).toBe(true);
    expect(result.solving.firstComplete).toEqual({ think: 3, tick: 45 });
    expect(result.solving.firstReady).toEqual({ think: 5, tick: 75 });
  });
  it('never invents causal completeness or actual allocation', () => {
    const unknown = cold(twenty(i => row(i, plan(), { complete: null })));
    expect(unknown.solving.firstComplete).toBeNull(); expect(unknown.solving.passed).toBe(false);
    const noAllocation = cold(twenty(i => row(i, plan(), { allocation: 'missing' })));
    expect(noAllocation.solving.readyByK).toBe(true); expect(noAllocation.solving.passed).toBe(false);
    expect(noAllocation.solving.missingAllocationThinks).toHaveLength(20);
  });
  it('retains original checker failures even when a complete ready graph exists', () => {
    const result = cold(twenty(i => row(i, plan(), { puzzleCheck: 'failed' })));
    expect(result.solving.readyByK).toBe(true); expect(result.solving.passed).toBe(false);
    expect(result.solving.originalPuzzleChecks.every(x => x.state === 'failed')).toBe(true);
  });
  it('cannot count think21 or missing middle observations as K20 proof', () => {
    const rows = [...twenty(i => row(i, null)), row(21)];
    expect(cold(rows).solving.passed).toBe(false); expect(cold(rows).solving.firstReady).toBeNull();
    expect(cold(twenty().filter(x => x.think !== 7)).coverageComplete).toBe(false);
    expect(cold(twenty().slice(0, 19)).convergence.passed).toBe(false);
  });
  it('keeps the early-ready metric but fails if the selected plan later disappears or is invalidated', () => {
    const invalid: SemanticIncumbent = { ...plan(), condition: { state: 'invalid', step: 'yard', reason: 'lost-proof' } };
    for (const last of [null, invalid]) {
      const result = cold(twenty(i => row(i, i < 10 ? plan() : last)));
      expect(result.solving.firstReady).toEqual({ think: 1, tick: 15 });
      expect(result.convergence.passed).toBe(true); expect(result.solving.passed).toBe(false);
      expect(result.solving.verifiedReadyRetainedAtK).toBe(false);
    }
  });
  it('requires the frozen tail N decisions and preserves publication explanations', () => {
    const changed = twenty(i => row(i, { ...plan(), ready: i === 19 ? ['ship'] : ['yard'] },
      i === 19 ? { publications: [{ key: 'point-route', revision: 'v2' }] } : {}));
    const result = cold(changed);
    expect(result.solving.passed).toBe(true); expect(result.convergence.passed).toBe(false);
    expect(result.convergence.identities[1]!.publications).toEqual([{ key: 'point-route', revision: 'v2' }]);
  });
  it('keeps a retained invalid incumbent separate from no-plan and never ready', () => {
    const invalid: SemanticIncumbent = { ...plan(), condition: { state: 'invalid', step: 'yard', reason: 'worker-dead' } };
    const result = cold(twenty(i => row(i, invalid)));
    expect(result.convergence.passed).toBe(true); expect(result.solving.passed).toBe(false);
    expect(semanticIdentity(invalid).state).toBe('invalid'); expect(semanticIdentity(invalid).decision).not.toBe(semanticIdentity(null).decision);
  });
});

describe('real-game switching by observed seat and game minute', () => {
  it('does not reset the last choice across absent/invalid intervals', () => {
    const a = plan(), b = { ...plan(), steps: plan().steps.map(s => ({ ...s,
      selector: { ...s.selector, grounding: { ...s.selector.grounding, alternative: true } } })) };
    const invalid: SemanticIncumbent = { ...a, condition: { state: 'invalid', step: 'yard', reason: 'dead' } };
    const result = switches([row(1, a), row(2, null), row(3, invalid), row(4, invalid), row(5, b, { reason: 'replacement' }), row(6, b)]);
    expect(result.minutes[0]).toMatchObject({ switches: 1, noPlanSamples: 1, invalidSamples: 2, invalidations: 1, repairs: 1 });
    expect(result.events.filter(x => x.kind === 'switch')).toHaveLength(1);
    expect(result.events.find(x => x.kind === 'switch')!.reason).toBe('replacement');
  });
  it('counts recovery to the same plan as repair, not a switch', () => {
    const invalid: SemanticIncumbent = { ...plan(), condition: { state: 'invalid', step: 'yard', reason: 'cash' } };
    expect(switches([row(1), row(2, invalid), row(3)]).minutes[0]).toMatchObject({ switches: 0, repairs: 1 });
  });
  it('uses fixed minute boundaries and isolates goals, seats and runs', () => {
    const b = { ...plan(), steps: plan().steps.map(s => ({ ...s, bindings: {} })) };
    const result = switches([row(1, plan(), { tick: 1200 }), row(2, b, { tick: 1201 }),
      row(1, b, { seat: 'other', tick: 1201 }), row(1, b, { run: 'other-run', tick: 1201 })]);
    expect(result.minutes.find(x => x.run === 'run-1' && x.seat === 'owner' && x.minute === 0)!.switches).toBe(0);
    expect(result.minutes.find(x => x.run === 'run-1' && x.seat === 'owner' && x.minute === 1)!.switches).toBe(1);
    expect(result.minutes.filter(x => x.run !== 'run-1' || x.seat !== 'owner').every(x => x.switches === 0)).toBe(true);
  });
  it('marks observation gaps and refuses duplicated/out-of-order or missing wire', () => {
    expect(switches([row(1), row(3)]).minutes[0]!.observationGaps).toBe(1);
    expect(() => validateSemanticFrames([row(1), row(1)])).toThrow('Duplicate');
    expect(() => validateSemanticFrames([{ ...row(1), incumbent: undefined } as any])).toThrow();
    expect(() => validateSemanticFrames([row(1, { ...plan(), goalId: 'other' })])).toThrow('different goal');
  });
});
