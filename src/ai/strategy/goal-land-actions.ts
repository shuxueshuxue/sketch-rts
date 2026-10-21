import { unitMover } from '../../shared/catalog';
import { goalFact } from './goal-facts';
import { strategyIsOpponent } from './ownership';
import { withGoalSafetyPreconditionWindows } from './goal-safety-preconditions';
import type { GoalActionDeclaration, GoalActionKind, GoalActionProvider, GoalCombatOption, GoalFact, GoalPlanningContext } from './goal-planner-types';

/** Physical estimates and routes come from the shared fact/assessment ports.
 * No action here selects an army, evaluates a second battle or chooses the
 * preceding train/assemble/transport actions. */
export type GoalLandCombatGrounding = Omit<GoalCombatOption, 'id' | 'factIds' | 'preconditions'>
  & Readonly<{ preconditions?: readonly GoalFact[] }>;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function validEstimates(input: GoalLandCombatGrounding): boolean {
  return Number.isFinite(input.requiredForce) && input.requiredForce >= 0 && Number.isFinite(input.byTick)
    && (input.duration.state !== 'met' || Number.isFinite(input.duration.value) && input.duration.value >= 0)
    && (input.successProbability.state !== 'met' || Number.isFinite(input.successProbability.value)
      && input.successProbability.value >= 0 && input.successProbability.value <= 1)
    && (input.cost.state !== 'met' || input.cost.value.every(term => Number.isFinite(term.gold) && term.gold >= 0));
}
function declare(input: GoalLandCombatGrounding, context: GoalPlanningContext,
  kind: Extract<GoalActionKind, 'destroy-target' | 'hold-position' | 'engage-units'>,
  effect: GoalFact, extra: readonly GoalFact[] = []): GoalActionDeclaration | null {
  const post = input.post ?? input.target;
  if (!input.target.landId || !post.landId || post.landId !== input.target.landId || !validEstimates(input)) return null;
  if (kind === 'hold-position' && (post.point.x !== input.target.point.x || post.point.y !== input.target.point.y)) return null;
  const force = goalFact({ kind: 'force-at', at: post, minimum: input.requiredForce,
    byTick: input.byTick, metric: 'combat-rating', cohort: input.cohort });
  if (force.predicate.kind !== 'force-at') return null;
  const cohort = force.predicate.cohort ?? [];
  if (!cohort.length) return null;
  const unitIds = cohort.flatMap(ref => ref.kind === 'existing' ? [ref.entityId] : []);
  const units = unitIds.map(id => context.snapshot.units.find(unit => unit.id === id));
  if (units.some(unit => !unit || unit.owner !== context.owner || unit.hp <= 0 || unitMover(unit.kind) !== 'land')) return null;
  const preconditions = [...new Map([force, ...(input.preconditions ?? []), ...extra].map(fact => [fact.id, fact])).values()]
    .sort((a, b) => order(a.id, b.id));
  return withGoalSafetyPreconditionWindows({
    id: `action:${kind}:${JSON.stringify([effect.id, preconditions.map(fact => fact.id)])}`,
    // Holding has an exact on-post force precondition. Control begins when
    // that precondition is satisfied, while the cohort stays leased through
    // the full holding interval. Destruction and interception finish later.
    kind, preconditions, effects: [{ fact: effect, operation: 'establish', at: kind === 'hold-position' ? 'start' : 'finish' }],
    demands: cohort.map(entity => ({ resource: { kind: 'entity-control', entity }, quantity: 1, from: 'start', until: 'finish' })),
    flows: [], duration: input.duration, cost: input.cost, successProbability: input.successProbability,
    executor: { executor: `goal.${kind}`, parameters: { cohort, target: input.target,
      ...(effect.predicate.kind === 'route-controlled' || effect.predicate.kind === 'harassment-ended'
        ? { throughTick: effect.predicate.throughTick } : {}),
      ...(kind === 'hold-position' ? { protectionWindowTicks: context.situation.horizonTicks } : {}),
      ...(effect.predicate.kind === 'harassment-ended' && effect.predicate.unitIds
        ? { threatUnitIds: effect.predicate.unitIds } : {}) } },
    outputs: [], reasons: [],
  }, context.tick, context.situation.horizonTicks);
}

/** A hostile target's destruction is a world effect, not an expansion recipe.
 * Clearing neutral camps remains the one shared clear-camp declaration. */
export function declareGoalDestroyTarget(input: GoalLandCombatGrounding,
  context: GoalPlanningContext): GoalActionDeclaration | null {
  const target = [...context.snapshot.buildings, ...context.snapshot.units].find(entity => entity.id === input.target.entityId);
  if (!target || target.hp <= 0 || target.owner === 'neutral' || !strategyIsOpponent(context.snapshot, context.owner, target.owner)) return null;
  return declare(input, context, 'destroy-target', goalFact({ kind: 'enemy-site-destroyed', site: input.target }));
}

/** Holding consumes this cohort for the declared control window. A zero-time
 * action cannot promise control through a future threat window. */
export function declareGoalHoldPosition(input: GoalLandCombatGrounding & Readonly<{ throughTick: number }>,
  context: GoalPlanningContext): GoalActionDeclaration | null {
  if (!Number.isFinite(input.throughTick) || input.throughTick < context.tick
    || input.duration.state === 'met' && input.duration.value < input.throughTick - context.tick) return null;
  return declare(input, context, 'hold-position', goalFact({ kind: 'route-controlled', at: input.target, throughTick: input.throughTick }));
}

/** A pool containing a counter elsewhere cannot satisfy this selected group's
 * capability. The reader checks the same bound cohort's speed/range/firepower. */
export function declareGoalEngageUnits(input: GoalLandCombatGrounding & Readonly<{ throughTick: number; unitIds?: readonly string[] }>,
  context: GoalPlanningContext): GoalActionDeclaration | null {
  if (!Number.isFinite(input.throughTick) || input.throughTick < context.tick) return null;
  return declare(input, context, 'engage-units', goalFact({ kind: 'harassment-ended', site: input.target, throughTick: input.throughTick,
    ...(input.unitIds ? { unitIds: [...new Set(input.unitIds)].sort() } : {}) }),
    [goalFact({ kind: 'interception-capability', site: input.target, throughTick: input.throughTick, cohort: input.cohort })]);
}

/** Candidate membership, battle estimates and counter capability are chosen
 * by the one shared source. This provider only declares the matching atomic
 * world effect, preserving every selected cohort and pending assessment. */
export const goalLandActionProvider: GoalActionProvider = {
  id: 'goal:land-combat',
  actionsFor(effect, context) {
    const predicate = effect.predicate;
    if (predicate.kind !== 'enemy-site-destroyed' && predicate.kind !== 'route-controlled' && predicate.kind !== 'harassment-ended') return [];
    const candidates = context.grounding?.combatOptions?.(effect);
    if (!candidates || candidates.state !== 'met') return [];
    const actions = candidates.candidates.map(option => predicate.kind === 'enemy-site-destroyed'
      ? declareGoalDestroyTarget(option, context)
      : predicate.kind === 'route-controlled' ? declareGoalHoldPosition({ ...option, throughTick: predicate.throughTick }, context)
      : declareGoalEngageUnits({ ...option, throughTick: predicate.throughTick, ...(predicate.unitIds ? { unitIds: predicate.unitIds } : {}) }, context));
    return [...new Map(actions.filter((action): action is GoalActionDeclaration => !!action
      && action.effects.some(result => result.fact.id === effect.id)).map(action => [action.id, action])).values()]
      .sort((a, b) => order(a.id, b.id));
  },
};
