import { unitMover } from '../../shared/catalog';
import { goalFact } from './goal-facts';
import { strategyIsOpponent } from './ownership';
import type { GoalActionCost, GoalActionDeclaration, GoalActionKind, GoalEntityReference, GoalEstimate, GoalFact, GoalPlanningContext } from './goal-planner-types';
import type { Target } from './types';

/** Physical estimates and routes come from the shared fact/assessment ports.
 * No action here selects an army, evaluates a second battle or chooses the
 * preceding train/assemble/transport actions. */
export type GoalLandCombatGrounding = Readonly<{
  target: Target; cohort: readonly GoalEntityReference[]; requiredForce: number; byTick: number;
  duration: GoalEstimate<number>; cost: GoalEstimate<readonly GoalActionCost[]>; successProbability: GoalEstimate<number>;
  preconditions?: readonly GoalFact[];
}>;
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
  if (!input.target.landId || !validEstimates(input)) return null;
  const force = goalFact({ kind: 'force-at', at: input.target, minimum: input.requiredForce,
    byTick: input.byTick, metric: 'combat-rating', cohort: input.cohort });
  if (force.predicate.kind !== 'force-at') return null;
  const cohort = force.predicate.cohort ?? [];
  if (!cohort.length) return null;
  const unitIds = cohort.flatMap(ref => ref.kind === 'existing' ? [ref.entityId] : []);
  const units = unitIds.map(id => context.snapshot.units.find(unit => unit.id === id));
  if (units.some(unit => !unit || unit.owner !== context.owner || unit.hp <= 0 || unitMover(unit.kind) !== 'land')) return null;
  const preconditions = [...new Map([force, ...(input.preconditions ?? []), ...extra].map(fact => [fact.id, fact])).values()]
    .sort((a, b) => order(a.id, b.id));
  return {
    id: `action:${kind}:${JSON.stringify([effect.id, preconditions.map(fact => fact.id)])}`,
    kind, preconditions, effects: [{ fact: effect, operation: 'establish', at: 'finish' }],
    demands: cohort.map(entity => ({ resource: { kind: 'entity-control', entity }, quantity: 1, from: 'start', until: 'finish' })),
    flows: [], duration: input.duration, cost: input.cost, successProbability: input.successProbability,
    executor: { executor: `goal.${kind}`, parameters: { cohort, target: input.target,
      ...(effect.predicate.kind === 'route-controlled' || effect.predicate.kind === 'harassment-ended'
        ? { throughTick: effect.predicate.throughTick } : {}) } },
    outputs: [], reasons: [],
  };
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
export function declareGoalEngageUnits(input: GoalLandCombatGrounding & Readonly<{ throughTick: number }>,
  context: GoalPlanningContext): GoalActionDeclaration | null {
  if (!Number.isFinite(input.throughTick) || input.throughTick < context.tick) return null;
  return declare(input, context, 'engage-units', goalFact({ kind: 'harassment-ended', site: input.target, throughTick: input.throughTick }),
    [goalFact({ kind: 'interception-capability', site: input.target, throughTick: input.throughTick, cohort: input.cohort })]);
}
