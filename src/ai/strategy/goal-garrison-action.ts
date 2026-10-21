import { declareGoalDefense } from './goal-naval-actions';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalActionDeclaration } from './goal-planner-types';
import type { Target } from './types';

export type GoalGarrisonInput = Omit<Parameters<typeof declareGoalDefense>[0], 'site'> & Readonly<{
  mineId: string;
  /** Logical mine/hall binding, separate from the exact safe guard post. */
  at: Target;
  post: Target;
}>;
/** One sustained defend obligation, not a hall-completion alias. The central
 * world reader validates the actual hall, present exact cohort and formal
 * lease through throughTick before accepting this independent world effect. */
export function declareGoalGarrison(input: GoalGarrisonInput): GoalActionDeclaration | null {
  if (!input.mineId || !input.at.landId || input.post.landId !== input.at.landId
    || input.at.entityId !== undefined && input.at.entityId !== input.mineId) return null;
  const base = declareGoalDefense({ ...input, site: input.post });
  if (!base) return null;
  const hall = goalFact({ kind: 'hall-complete', mineId: input.mineId, at: input.at });
  const ready = goalFact({ kind: 'garrison-ready', mineId: input.mineId, at: input.at });
  const activation = base.effects.find(effect => effect.fact.predicate.kind === 'site-safe')!.at;
  const parameters = { ...base.executor.parameters, garrisonMineId: input.mineId, garrisonAt: input.at };
  return { ...base, id: `goal-action:defend:${goalValueKey(parameters)}`,
    preconditions: [...new Map([...base.preconditions, hall].map(fact => [fact.id, fact])).values()]
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    effects: [...base.effects, { fact: ready, operation: 'establish', at: activation }],
    executor: { ...base.executor, parameters }, reasons: [...base.reasons, {
      code: 'formal-garrison-obligation-required', factIds: [hall.id, ready.id],
      values: { throughTick: input.throughTick, commandAcknowledgementIsProof: false },
    }] };
}
