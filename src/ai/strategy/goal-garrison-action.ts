import { declareGoalHoldPosition, type GoalLandCombatGrounding } from './goal-land-actions';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalActionDeclaration, GoalPlanningContext } from './goal-planner-types';
import type { Target } from './types';
import { withinExpansionGarrisonCoverage } from '../bootstrap_1/expansion-garrison-rules';

export type GoalGarrisonInput = GoalLandCombatGrounding & Readonly<{
  mineId: string;
  /** Logical mine/hall binding; target is the exact shared guard post. */
  at: Target;
  throughTick: number;
  requestedThroughTick?: number;
}>;
/** Maps the common hold-position atom to a mining garrison obligation. Its
 * exact force-at prerequisite owns arrival; the holding effect starts only
 * after that prerequisite and the real hall have been satisfied. */
export function declareGoalGarrison(input: GoalGarrisonInput, context: GoalPlanningContext): GoalActionDeclaration | null {
  if (!input.mineId || !input.at.landId || input.target.landId !== input.at.landId
    || !withinExpansionGarrisonCoverage(input.target.point, input.at.point)
    || input.at.entityId !== undefined && input.at.entityId !== input.mineId) return null;
  const hall = goalFact({ kind: 'hall-complete', mineId: input.mineId, at: input.at });
  const base = declareGoalHoldPosition({ ...input, preconditions: [...(input.preconditions ?? []), hall] }, context);
  if (!base) return null;
  const ready = goalFact({ kind: 'garrison-ready', mineId: input.mineId, at: input.at,
    ...(input.requestedThroughTick === undefined ? {} : { throughTick: input.requestedThroughTick }) });
  const parameters = { ...base.executor.parameters, garrisonMineId: input.mineId, garrisonAt: input.at,
    protectionWindowTicks: context.situation.horizonTicks };
  return { ...base, id: `action:hold-position:${goalValueKey([ready.id, base.id])}`,
    effects: [...base.effects, { fact: ready, operation: 'establish', at: 'start' }],
    executor: { ...base.executor, parameters }, reasons: [...base.reasons, {
      code: 'formal-garrison-obligation-required', factIds: [hall.id, ready.id],
      values: { throughTick: input.throughTick, commandAcknowledgementIsProof: false },
    }] };
}
