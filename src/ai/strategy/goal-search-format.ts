import type { GameSnapshot } from '../../shared/types';
import type { GoalActionDeclaration, GoalActionKind, GoalEntityReference, GoalFactObservation } from './goal-planner-types';

/** Domain fields, not serialized declarations, predicates or quotation IDs.
 * Flat named fields prevent a producer's declaration being copied recursively
 * into its consumers. A provider owns the meaning of each field name. */
export type GoalGrounding = Readonly<Record<string, string | number | boolean | null>>;
export type GoalStepSelector = Readonly<{
  provider: string; kind: GoalActionKind; grounding: GoalGrounding;
}>;
export type GoalLocalOutput = Readonly<{ kind: 'step-output'; step: string; output: string }>;
export type GoalSearchBinding = GoalEntityReference | GoalLocalOutput;
export type GoalSearchDependency = Readonly<{
  kind: 'fact' | 'candidates'; key: string; revision: string;
}>;
export type GoalSearchQuote = Readonly<{
  basis: 'published' | 'forecast'; durationTicks: number; costGold: number; successProbability: number;
  dependencies: readonly GoalSearchDependency[];
}>;
export type GoalIncumbentStep = Readonly<{
  /** A preserved local label. It is never an authority or output identity. */
  id: string; selector: GoalStepSelector; bindings: Readonly<Record<string, GoalSearchBinding>>;
  dependsOn: readonly string[]; startOffsetTicks: number; finishOffsetTicks: number;
  quote: GoalSearchQuote;
}>;
export type GoalIncumbent = Readonly<{
  goalId: string; scheduledAtTick: number; steps: readonly GoalIncumbentStep[]; ready: readonly string[];
  condition: Readonly<{ state: 'valid' }> | Readonly<{ state: 'invalid'; step: string; reason: string }>;
}>;
export type GoalSearchCursor = Readonly<{
  /** Frames retain selectors and the next alternative, never an achiever list. */
  scheduledAtTick: number; stack: readonly Readonly<{ requirement: GoalGrounding; nextAlternative: number }>[];
  prefix: readonly GoalIncumbentStep[];
  challenger?: GoalIncumbent;
  dependencies: readonly GoalSearchDependency[];
  exhausted: boolean;
}>;
export type GoalSearchMemory = {
  version: 1;
  goals: Record<string, { incumbent?: GoalIncumbent; cursor?: GoalSearchCursor }>;
};

/** Regeneration reads a projected causal prefix and published world inputs.
 * Scheduling/resource replay is supplied explicitly; this interface has no
 * allocator, SDK, reservation or publication mutation port. */
export type GoalRegenerateInput = Readonly<{
  snapshot: GameSnapshot; goalId: string; selector: GoalStepSelector;
  /** Actual proposed start after causal/resource release, not world time. */
  startTick?: number;
  bindings: Readonly<Record<string, GoalSearchBinding>>;
  prefix: readonly Readonly<{ selector: GoalStepSelector; action: GoalActionDeclaration;
    startTick: number; finishTick: number; dependsOn?: readonly string[] }>[];
  readPublished: (key: string) => GoalFactObservation | undefined;
}>;
export type GoalRegenerateResult = Readonly<{ state: 'known'; action: GoalActionDeclaration }>
  | Readonly<{ state: 'pending'; requestIds: readonly string[]; reason: string }>
  | Readonly<{ state: 'invalid'; reason: string; step: string }>
  | Readonly<{ state: 'requote'; reason: string; step: string }>;
export type GoalRegenerate = (input: GoalRegenerateInput) => GoalRegenerateResult;

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const actionKinds: readonly GoalActionKind[] = ['assemble', 'transport-force', 'transport-worker', 'position-transport',
  'clear-camp', 'clear-shore', 'defend', 'evacuate', 'train', 'build', 'wait-income', 'destroy-target', 'hold-position', 'engage-units'];
export const isGoalSearchActionKind = (kind: unknown): kind is GoalActionKind => typeof kind === 'string' && actionKinds.includes(kind as GoalActionKind);
export function goalGroundingKey(fields: GoalGrounding): string {
  if (!fields || Object.getPrototypeOf(fields) !== Object.prototype && Object.getPrototypeOf(fields) !== null)
    throw Error('Goal grounding must be a flat plain selector');
  const descriptors = Object.getOwnPropertyDescriptors(fields);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) throw Error('Invalid goal grounding key');
  const entries = Object.entries(descriptors).sort(([a], [b]) => order(a, b));
  for (const [key, descriptor] of entries) {
    if (!text(key) || !('value' in descriptor) || !descriptor.enumerable) throw Error('Invalid goal grounding field');
    const value: unknown = descriptor.value;
    if (!(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
      || typeof value === 'string' && !/^(goal-v[1-9][0-9]*$|(?:fact|goal-action|action|goal-step):)/.test(value)))
      throw Error('Goal grounding fields must be finite atoms, not definitions or version references');
  }
  return JSON.stringify(entries.map(([key, descriptor]) => [key, descriptor.value]));
}

/** A global key is full canonical content, never a truncated hash or a local
 * enumeration number. Its grounding fields contain no nested step bodies. */
export function goalGlobalStepKey(goalId: string, selector: GoalStepSelector): string {
  if (!text(goalId) || !text(selector.provider) || !isGoalSearchActionKind(selector.kind)) throw Error('Invalid goal step selector');
  return `goal-step:1:${JSON.stringify([goalId, selector.provider, selector.kind, JSON.parse(goalGroundingKey(selector.grounding))])}`;
}

export function readGoalGlobalStepKey(key: string): Readonly<{ goalId: string; selector: GoalStepSelector }> {
  if (!key.startsWith('goal-step:1:')) throw Error('Invalid global goal step key');
  const body: unknown = JSON.parse(key.slice('goal-step:1:'.length));
  if (!Array.isArray(body) || body.length !== 4 || !body.slice(0, 3).every(text) || !Array.isArray(body[3])
    || body[3].some(row => !Array.isArray(row) || row.length !== 2 || !text(row[0]))) throw Error('Invalid global goal step key');
  const selector: GoalStepSelector = { provider: body[1] as string, kind: body[2] as GoalActionKind,
    grounding: Object.fromEntries(body[3]) as GoalGrounding };
  const goalId = body[0] as string;
  if (goalGlobalStepKey(goalId, selector) !== key) throw Error('Noncanonical global goal step key');
  return { goalId, selector };
}

export function goalGlobalOutput(goalId: string, steps: readonly GoalIncumbentStep[], output: GoalLocalOutput):
  Extract<GoalEntityReference, { kind: 'output' }> {
  const matches = steps.filter(step => step.id === output.step);
  if (matches.length !== 1 || !text(output.output)) throw Error('Unresolved or ambiguous local goal output');
  return { kind: 'output', actionId: goalGlobalStepKey(goalId, matches[0]!.selector), output: output.output };
}

/** This is a boundary conversion, not resolution. A future output remains an
 * output and never gains an entity ID, a lease or command authority. */
export function globalizeGoalBindings(plan: GoalIncumbent): Readonly<Record<string, Readonly<Record<string, GoalEntityReference>>>> {
  const result: Record<string, Record<string, GoalEntityReference>> = {};
  for (const step of plan.steps) {
    if (Object.hasOwn(result, step.id)) throw Error('Duplicate local goal step');
    result[step.id] = Object.fromEntries(Object.entries(step.bindings).map(([slot, binding]) => {
      if (binding.kind === 'output') {
        if (!binding.actionId.startsWith('goal-step:1:')) throw Error('A local output must be globalized before the authority boundary');
        readGoalGlobalStepKey(binding.actionId);
      }
      return [slot, binding.kind === 'step-output' ? goalGlobalOutput(plan.goalId, plan.steps, binding) : binding];
    }));
  }
  return result;
}

/** Dependency order, including equal-finish actions, is semantic. Local
 * labels and array order cannot reverse the same physical causal graph. */
export function goalSemanticPlan(plan: GoalIncumbent): string {
  const bindings = globalizeGoalBindings(plan), byId = new Map(plan.steps.map(step => [step.id, step]));
  const keys = new Map(plan.steps.map(step => [step.id, goalGlobalStepKey(plan.goalId, step.selector)]));
  if (new Set(keys.values()).size !== plan.steps.length) throw Error('Ambiguous goal grounding: distinct steps require distinct domain selectors');
  const states = new Map<string, 1 | 2>();
  const visit = (id: string): void => {
    const step = byId.get(id);
    if (!step || states.get(id) === 1) throw Error('Missing or cyclic goal dependency');
    if (states.get(id) === 2) return;
    states.set(id, 1); step.dependsOn.forEach(visit); states.set(id, 2);
  };
  plan.steps.forEach(step => visit(step.id));
  for (const step of plan.steps) {
    const ancestors = new Set<string>();
    const ancestor = (id: string) => { if (ancestors.has(id)) return; ancestors.add(id); byId.get(id)!.dependsOn.forEach(ancestor); };
    step.dependsOn.forEach(ancestor);
    for (const binding of Object.values(step.bindings)) if (binding.kind === 'step-output' && !ancestors.has(binding.step))
      throw Error('A local output requires its causal producer dependency');
  }
  if (plan.ready.some(id => !byId.has(id))) throw Error('Unknown ready goal step');
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => order(a, b))
      .map(([key, item]) => [key, canonical(item)])) : value;
  const steps = plan.steps.map(step => [keys.get(step.id), canonical(bindings[step.id]),
    [...new Set(step.dependsOn.map(id => keys.get(id)!))].sort()]);
  return JSON.stringify({ goalId: plan.goalId, steps: steps.sort((a, b) => order(JSON.stringify(a), JSON.stringify(b))),
  });
}

export function goalSemanticReady(plan: GoalIncumbent): string {
  const byId = new Map(plan.steps.map(step => [step.id, step.selector]));
  return JSON.stringify([...new Set(plan.ready.map(id => {
    const selector = byId.get(id); if (!selector) throw Error('Unknown ready goal step');
    return goalGlobalStepKey(plan.goalId, selector);
  }))].sort());
}

export function goalSemanticDecision(incumbent: GoalIncumbent | undefined): string {
  return JSON.stringify(incumbent ? { state: incumbent.condition.state, plan: JSON.parse(goalSemanticPlan(incumbent)),
    ready: JSON.parse(goalSemanticReady(incumbent)) } : { state: 'no-plan' });
}
