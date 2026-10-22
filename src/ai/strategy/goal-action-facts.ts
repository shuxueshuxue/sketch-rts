import { goalFact } from './goal-facts';
import type { GoalActionDeclaration, GoalFact } from './goal-planner-types';

/** Replace world proofs and all their IDs together, including estimate,
 * resource and explanation references. A proof's clock is not action identity. */
export function replaceGoalActionFacts(action: GoalActionDeclaration, facts: ReadonlyMap<string, GoalFact>): GoalActionDeclaration {
  if (!facts.size) return action;
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return facts.get(value)?.id ?? value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (typeof object.id === 'string' && object.predicate && facts.has(object.id)) return facts.get(object.id)!;
      return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, visit(item)]));
    }
    return value;
  };
  return { ...visit(action) as GoalActionDeclaration, id: action.id };
}

/** Only explicitly relative admission proofs move with the schedule. Goal
 * deadlines, hold obligations and persistent effects retain their own clocks. */
export function retimeGoalActionPreconditions(action: GoalActionDeclaration, finishTick: number): GoalActionDeclaration | null {
  if (!action.preconditionWindows?.length) return action;
  if (!Number.isFinite(finishTick)) return null;
  const facts = new Map<string, GoalFact>();
  for (const window of action.preconditionWindows) {
    const fact = action.preconditions.find(fact => fact.id === window.factId);
    if (!fact || window.through !== 'finish' || !('throughTick' in fact.predicate)) return null;
    const retimed = goalFact({ ...fact.predicate, throughTick: finishTick });
    if (retimed.id !== fact.id) facts.set(fact.id, retimed);
  }
  return { ...replaceGoalActionFacts(action, facts), effects: action.effects,
    ...(action.regeneration ? { regeneration: { ...action.regeneration, finishTick } } : {}) };
}
