import { goalFact, goalResourceKey, goalValueKey, semanticGoalPredicate } from './goal-facts';
import { replaceGoalActionFacts } from './goal-action-facts';
import type { GoalActionDeclaration, GoalEntityReference, GoalFact, GoalFactPredicate, GoalResource } from './goal-planner-types';

export type GoalBindings = Readonly<Record<string, GoalEntityReference>>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reference = (value: unknown): value is GoalEntityReference => object(value)
  && (value.kind === 'existing' && typeof value.entityId === 'string'
    || value.kind === 'output' && typeof value.actionId === 'string' && typeof value.output === 'string'
    || value.kind === 'binding' && typeof value.name === 'string'
    || value.kind === 'pool-member' && typeof value.unitKind === 'string' && typeof value.slot === 'string' && object(value.at));

/** Bindings remain references to real entities or planned output slots. This
 * substitution never invents an entity ID or mutates a domain declaration. */
export function bindGoalValue<T>(value: T, bindings: GoalBindings): T {
  const visit = (item: unknown, seen = new Set<string>()): unknown => {
    if (reference(item) && item.kind === 'binding' && bindings[item.name] && !seen.has(item.name))
      return visit(bindings[item.name], new Set([...seen, item.name]));
    if (Array.isArray(item)) return item.map(value => visit(value, seen));
    if (object(item)) return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, visit(value, seen)]));
    return item;
  };
  return visit(value) as T;
}
export const bindGoalFact = (fact: GoalFact, bindings: GoalBindings) => goalFact(bindGoalValue(fact.predicate, bindings));
export function bindGoalAction(action: GoalActionDeclaration, bindings: GoalBindings): GoalActionDeclaration {
  const result = bindGoalValue(action, bindings);
  const facts = new Map([...result.preconditions, ...result.effects.map(effect => effect.fact)]
    .map(fact => [fact.id, goalFact(fact.predicate)] as const).filter(([id, fact]) => id !== fact.id));
  const bound = replaceGoalActionFacts(result, facts);
  return action.regeneration && Object.keys(bindings).length ? { ...bound, regeneration: {
    ...action.regeneration, bindings: { ...action.regeneration.bindings, ...bindings } } } : bound;
}

/** Structural entailment, with numeric/deadline relations handled explicitly.
 * ignoreQuantity is only for discovering partial contributors, never proof
 * that one contributor satisfies a requested total. */
export function matchGoalFacts(produced: GoalFact, required: GoalFact, input: GoalBindings = {}, ignoreQuantity = false): GoalBindings | null {
  const bindings: Record<string, GoalEntityReference> = { ...input };
  const compare = (left: unknown, right: unknown, key = ''): boolean => {
    left = bindGoalValue(left, bindings); right = bindGoalValue(right, bindings);
    if (reference(right) && right.kind === 'binding' && reference(left)) { bindings[right.name] = left; return true; }
    if (reference(left) && left.kind === 'binding' && reference(right)) { bindings[left.name] = right; return true; }
    if (key === 'byTick') return true; // availability is checked against the action schedule
    if (['minimum', 'count', 'capacity'].includes(key) && typeof left === 'number' && typeof right === 'number')
      return ignoreQuantity || left + 1e-9 >= right;
    if (key === 'throughTick' && typeof left === 'number' && typeof right === 'number') return left >= right;
    if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length && right.every((value, index) => compare(left[index], value));
    if (object(left) && object(right)) return Object.entries(right).every(([name, value]) => value === undefined || compare(left[name], value, name));
    return left === right;
  };
  // Canonical pool predicates ignore same-region point aliases. Exact post
  // predicates retain their actual point, cohort and physical metric.
  const semantic = (fact: GoalFact) => semanticGoalPredicate(fact.predicate);
  return compare(semantic(produced), semantic(required)) ? bindings : null;
}

export function goalQuantity(fact: GoalFact): Readonly<{ resource: GoalResource; minimum: number }> | null {
  const p = fact.predicate;
  switch (p.kind) {
    case 'gold': return { resource: { kind: 'gold' }, minimum: p.minimum };
    case 'population-room': return { resource: { kind: 'population-room' }, minimum: p.minimum };
    case 'supply-cap': return { resource: { kind: 'supply-cap' }, minimum: p.minimum };
    case 'unit-available': return { resource: { kind: 'unit-pool', at: p.at, unitKind: p.unitKind }, minimum: p.count };
    case 'worker-at': return !p.worker ? { resource: { kind: 'unit-pool', at: p.at, unitKind: 'worker' }, minimum: p.count } : null;
    case 'force-at': case 'force-available': return p.metric === 'combat-rating'
      ? { resource: { kind: 'force', at: p.at, metric: p.metric, scope: p.kind === 'force-at' ? 'post' : 'pool' }, minimum: p.minimum } : null;
    case 'transport-in': return { resource: { kind: 'transport-capacity', seaId: p.seaId, ...(p.transport ? { transport: p.transport } : {}) }, minimum: p.capacity };
    default: return null;
  }
}

export function goalActionContributes(action: GoalActionDeclaration, fact: GoalFact): boolean {
  if (action.effects.some(effect => effect.operation === 'establish' && matchGoalFacts(effect.fact, fact, {}, true))) return true;
  const quantity = goalQuantity(fact);
  return !!quantity && action.flows.some(flow => flow.delta > 0 && goalResourceKey(flow.resource) === goalResourceKey(quantity.resource));
}

export function goalBindingsKey(bindings: GoalBindings) { return goalValueKey(bindings); }
