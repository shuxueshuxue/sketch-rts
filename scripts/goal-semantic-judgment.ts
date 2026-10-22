/** Read-only judgment wire for the selector/incumbent contract agreed in #592.
 * It deliberately imports no planner, allocator, SDK or simulation module.
 * The normal owner must supply completeness/checker/allocation observations;
 * this reader never infers them from a nonempty DAG or projected capital. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type SemanticSelector = Readonly<{
  provider: string; kind: string; grounding: Readonly<Record<string, null | boolean | number | string>>;
}>;
export type SemanticStep = Readonly<{
  id: string; selector: SemanticSelector; bindings: Readonly<Record<string, Readonly<Record<string, Json>>>>;
  dependsOn: readonly string[];
}>;
/** Extra schedule/quote fields on the real incumbent are accepted and ignored. */
export type SemanticIncumbent = Readonly<{
  goalId: string; steps: readonly SemanticStep[]; ready: readonly string[];
  condition: Readonly<{ state: 'valid' }> | Readonly<{ state: 'invalid'; step: string; reason: string }>;
}>;
export type SemanticFrame = Readonly<{
  run: string; seat: string; goalId: string; think: number; tick: number;
  /** Explicit null means no incumbent. Missing input is an error, not no-plan. */
  incumbent: SemanticIncumbent | null;
  /** Normal causal replay/checker observation; null means not exported. */
  complete: boolean | null;
  puzzleCheck: 'passed' | 'failed' | 'unavailable';
  allocation: 'observed' | 'missing' | 'not-required';
  reason?: string;
  publications?: readonly Readonly<{ key: string; revision: string }>[];
}>;
export type SemanticState = 'no-plan' | 'valid' | 'invalid';
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function canonical(value: unknown): Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw Error('Sparse or decorated JSON array');
    return value.map(canonical);
  }
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string')) throw Error('Symbol in JSON input');
    return Object.fromEntries(Object.entries(descriptors).sort(([a], [b]) => order(a, b)).map(([k, d]) => {
      if (!d.enumerable || !('value' in d)) throw Error('Accessor or hidden field in JSON input');
      return [k, canonical(d.value)];
    }));
  }
  throw Error('Expected finite plain JSON input');
}

export function semanticStepKey(goalId: string, selector: SemanticSelector): string {
  if (!nonempty(goalId) || !nonempty(selector.provider) || !nonempty(selector.kind)) throw Error('Missing semantic selector');
  const fields = canonical(selector.grounding);
  if (!fields || Array.isArray(fields) || typeof fields !== 'object') throw Error('Grounding must be a flat atom table');
  const entries = Object.entries(fields);
  if (entries.some(([k, v]) => !nonempty(k) || v !== null && typeof v === 'object'
    || typeof v === 'string' && /^goal-v[1-9][0-9]*$/.test(v))) throw Error('Grounding contains a definition or planner version');
  return `goal-step:1:${JSON.stringify([goalId, selector.provider, selector.kind, entries])}`;
}

function validateGlobalKey(key: unknown): void {
  if (typeof key !== 'string' || !key.startsWith('goal-step:1:')) throw Error('Output is not a global semantic step key');
  const body: unknown = JSON.parse(key.slice('goal-step:1:'.length));
  if (!Array.isArray(body) || body.length !== 4 || !body.slice(0, 3).every(nonempty) || !Array.isArray(body[3])
    || body[3].some(row => !Array.isArray(row) || row.length !== 2 || !nonempty(row[0]))) throw Error('Malformed global step key');
  const expected = semanticStepKey(body[0] as string, { provider: body[1] as string, kind: body[2] as string,
    grounding: Object.fromEntries(body[3]) as SemanticSelector['grounding'] });
  if (key !== expected) throw Error('Noncanonical global step key');
}

export function semanticIdentity(plan: SemanticIncumbent | null): Readonly<{
  state: SemanticState; plan: string | null; ready: string; decision: string; nonempty: boolean;
}> {
  if (plan === null) return { state: 'no-plan', plan: null, ready: '[]', decision: '{"state":"no-plan"}', nonempty: false };
  if (!plan || !nonempty(plan.goalId) || !Array.isArray(plan.steps) || !Array.isArray(plan.ready)
    || !['valid', 'invalid'].includes(plan.condition?.state)) throw Error('Missing semantic incumbent wire');
  if (plan.condition.state === 'invalid' && (!nonempty(plan.condition.step) || !nonempty(plan.condition.reason)))
    throw Error('Missing invalidation cause');
  const sourceSteps: readonly SemanticStep[] = plan.steps, sourceReady: readonly string[] = plan.ready;
  const steps = new Map(sourceSteps.map(s => [s.id, s]));
  if (steps.size !== sourceSteps.length || sourceSteps.some(s => !nonempty(s.id))) throw Error('Duplicate or empty local step');
  const keys = new Map(sourceSteps.map(s => [s.id, semanticStepKey(plan.goalId, s.selector)]));
  if (new Set(keys.values()).size !== steps.size) throw Error('Ambiguous grounding');
  const ancestors = new Map<string, Set<string>>(), visiting = new Set<string>();
  function visit(id: string): Set<string> {
    const cached = ancestors.get(id); if (cached) return cached;
    const step = steps.get(id);
    if (!step || visiting.has(id)) throw Error('Missing or cyclic dependency');
    visiting.add(id); const result = new Set<string>();
    for (const parent of step.dependsOn) { result.add(parent); for (const ancestor of visit(parent)) result.add(ancestor); }
    visiting.delete(id); ancestors.set(id, result); return result;
  }
  sourceSteps.forEach(s => visit(s.id));
  const normalized = sourceSteps.map(step => {
    const bindings = Object.fromEntries(Object.entries(step.bindings).map(([slot, ref]) => {
      let binding: Readonly<Record<string, Json>> = ref;
      if (ref.kind === 'step-output') {
        if (typeof ref.step !== 'string' || !keys.has(ref.step) || !nonempty(ref.output)
          || !ancestors.get(step.id)!.has(ref.step)) throw Error('Missing causal producer for local output');
        binding = { kind: 'output', actionId: keys.get(ref.step)!, output: ref.output };
      } else if (ref.kind === 'output') {
        validateGlobalKey(ref.actionId);
        if (!nonempty(ref.output)) throw Error('Missing output slot');
      } else if (ref.kind === 'existing') {
        if (!nonempty(ref.entityId)) throw Error('Missing real entity binding');
      } else if (ref.kind !== 'binding' && ref.kind !== 'pool-member') throw Error('Unknown binding kind');
      return [slot, canonical(binding)];
    }));
    return [keys.get(step.id)!, canonical(bindings), [...new Set(step.dependsOn.map(id => keys.get(id)!))].sort()];
  });
  const ready = JSON.stringify([...new Set(sourceReady.map(id => {
    const key = keys.get(id); if (!key) throw Error('Unknown ready step'); return key;
  }))].sort());
  const selection = JSON.stringify({ goalId: plan.goalId, steps: normalized.sort((a, b) => order(JSON.stringify(a), JSON.stringify(b))) });
  return { state: plan.condition.state, plan: selection, ready,
    decision: JSON.stringify({ state: plan.condition.state, plan: JSON.parse(selection), ready: JSON.parse(ready) }), nonempty: steps.size > 0 };
}

export function validateSemanticFrames(frames: readonly SemanticFrame[]): void {
  const previous = new Map<string, SemanticFrame>();
  for (const f of frames) {
    if (![f.run, f.seat, f.goalId].every(nonempty) || !Number.isSafeInteger(f.think) || f.think < 1
      || !Number.isSafeInteger(f.tick) || f.tick < 0 || !Object.hasOwn(f, 'incumbent')
      || ![true, false, null].includes(f.complete)
      || !['passed', 'failed', 'unavailable'].includes(f.puzzleCheck)
      || !['observed', 'missing', 'not-required'].includes(f.allocation)) throw Error('Incomplete semantic observation');
    semanticIdentity(f.incumbent);
    if (f.incumbent && f.incumbent.goalId !== f.goalId) throw Error('Incumbent belongs to a different goal');
    const key = JSON.stringify([f.run, f.seat, f.goalId]), old = previous.get(key);
    if (old && (old.think >= f.think || old.tick >= f.tick)) throw Error('Duplicate or unordered observation');
    previous.set(key, f);
  }
}

/** Stability can be true for a stable empty/invalid result; solving is separate. */
export function assessColdSemantic(frames: readonly SemanticFrame[], options: Readonly<{ k: number; tail: number; requireAllocation: boolean }>) {
  validateSemanticFrames(frames);
  if (!Number.isSafeInteger(options.k) || !Number.isSafeInteger(options.tail) || options.tail < 1 || options.k < options.tail)
    throw Error('Freeze positive K and tail N before the run');
  if (new Set(frames.map(f => JSON.stringify([f.run, f.seat, f.goalId]))).size > 1) throw Error('Cold judgment requires one run/seat/goal');
  const within = frames.filter(f => f.think <= options.k);
  const coverageComplete = within.length === options.k && within.every((f, i) => f.think === i + 1);
  const eligible = (f: SemanticFrame) => f.complete === true && f.incumbent !== null
    && f.incumbent.condition.state === 'valid' && f.incumbent.steps.length > 0;
  const complete = within.find(eligible);
  const ready = within.find(f => eligible(f) && f.incumbent!.ready.length > 0);
  const isVerified = (f: SemanticFrame) => eligible(f) && f.incumbent!.ready.length > 0 && f.puzzleCheck === 'passed'
    && (!options.requireAllocation || f.allocation === 'observed');
  const verified = within.find(isVerified), atK = within.find(f => f.think === options.k);
  const tail = within.filter(f => f.think > options.k - options.tail);
  const identities = tail.map(f => ({ think: f.think, tick: f.tick, ...semanticIdentity(f.incumbent), publications: f.publications ?? [] }));
  const tailComplete = tail.length === options.tail && tail.every((f, i) => f.think === options.k - options.tail + i + 1);
  return { k: options.k, tailN: options.tail, coverageComplete,
    convergence: { passed: coverageComplete && tailComplete && new Set(identities.map(x => x.decision)).size === 1,
      identities, note: 'Publications are reported, never used to waive a changed decision or rewrite the frozen tail.' },
    solving: { passed: coverageComplete && atK !== undefined && isVerified(atK),
      readyByK: ready !== undefined, firstComplete: complete ? { think: complete.think, tick: complete.tick } : null,
      firstReady: ready ? { think: ready.think, tick: ready.tick } : null,
      firstVerifiedReady: verified ? { think: verified.think, tick: verified.tick } : null,
      verifiedReadyRetainedAtK: atK !== undefined && isVerified(atK),
      requireAllocation: options.requireAllocation,
      missingCompletenessThinks: within.filter(f => f.complete === null).map(f => f.think),
      missingAllocationThinks: within.filter(f => eligible(f) && f.incumbent!.ready.length > 0 && f.allocation === 'missing').map(f => f.think),
      originalPuzzleChecks: within.map(f => ({ think: f.think, state: f.puzzleCheck })) } };
}

export function countSemanticSwitches(frames: readonly SemanticFrame[], options: Readonly<{ startTick: number; ticksPerMinute: number }>) {
  validateSemanticFrames(frames);
  if (!Number.isSafeInteger(options.startTick) || options.startTick < 0 || !Number.isSafeInteger(options.ticksPerMinute)
    || options.ticksPerMinute < 1 || frames.some(f => f.tick < options.startTick)) throw Error('Invalid frozen game clock');
  type History = { selected: string | null; previousState: SemanticState | null; invalidSince: boolean; lastThink: number };
  const histories = new Map<string, History>();
  const minutes = new Map<string, { run: string; seat: string; minute: number; startTick: number; endTickExclusive: number;
    switches: number; noPlanSamples: number; invalidSamples: number; validSamples: number; emptyValidSamples: number;
    noPlanEntries: number; invalidations: number; repairs: number; observationGaps: number }>();
  const events: { run: string; seat: string; goalId: string; think: number; tick: number; kind: string; reason: string | null;
    publications: SemanticFrame['publications']; from: string | null; to: string | null }[] = [];
  for (const f of frames) {
    const identity = semanticIdentity(f.incumbent), key = JSON.stringify([f.run, f.seat, f.goalId]);
    const history = histories.get(key) ?? { selected: null, previousState: null, invalidSince: false, lastThink: 0 };
    const minute = Math.floor((f.tick - options.startTick) / options.ticksPerMinute), minuteKey = JSON.stringify([f.run, f.seat, minute]);
    const bucket = minutes.get(minuteKey) ?? { run: f.run, seat: f.seat, minute,
      startTick: options.startTick + minute * options.ticksPerMinute, endTickExclusive: options.startTick + (minute + 1) * options.ticksPerMinute,
      switches: 0, noPlanSamples: 0, invalidSamples: 0, validSamples: 0, emptyValidSamples: 0,
      noPlanEntries: 0, invalidations: 0, repairs: 0, observationGaps: 0 };
    const event = (kind: string, from: string | null, to: string | null) => events.push({ run: f.run, seat: f.seat,
      goalId: f.goalId, think: f.think, tick: f.tick, kind,
      reason: f.reason ?? (f.incumbent?.condition.state === 'invalid' ? f.incumbent.condition.reason : null),
      publications: f.publications ?? [], from, to });
    if (history.lastThink && f.think !== history.lastThink + 1) { bucket.observationGaps++; event('observation-gap', null, null); }
    if (identity.state === 'no-plan') {
      bucket.noPlanSamples++;
      if (history.previousState !== 'no-plan') { bucket.noPlanEntries++; event('no-plan', history.selected, null); }
    } else if (identity.state === 'invalid') {
      bucket.invalidSamples++;
      if (history.previousState !== 'invalid') { bucket.invalidations++; event('invalidated', history.selected, identity.plan); }
      history.invalidSince = true;
    } else {
      bucket.validSamples++;
      if (!identity.nonempty) bucket.emptyValidSamples++;
      else {
        if (history.selected !== null && history.selected !== identity.plan) { bucket.switches++; event('switch', history.selected, identity.plan); }
        if (history.invalidSince) { bucket.repairs++; event('repaired', history.selected, identity.plan); history.invalidSince = false; }
        history.selected = identity.plan;
      }
    }
    history.previousState = identity.state; history.lastThink = f.think;
    histories.set(key, history); minutes.set(minuteKey, bucket);
  }
  return { clock: options, minutes: [...minutes.values()].sort((a, b) => order(a.run, b.run) || order(a.seat, b.seat) || a.minute - b.minute), events,
    scope: 'Counts observed decisions per goal, summed by seat/minute. Ready-only progression is not a switch. No-plan/invalid gaps do not reset the last valid choice. Samples are not continuous-time safety or goal completion evidence.' };
}
