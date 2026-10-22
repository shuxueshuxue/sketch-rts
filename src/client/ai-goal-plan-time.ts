import type { GoalActionNode, GoalFactEffect, GoalPlan, GoalPlanFactNode } from '../ai/strategy/goal-planner-types';

export type GoalTimeAxis = { from: number; through: number; width: number; left: number; right: number };
export const goalTimeX = (axis: GoalTimeAxis, tick: number) => axis.left + (tick-axis.from)/(axis.through-axis.from)*(axis.width-axis.left-axis.right);
export const goalTimeTicks = (axis: GoalTimeAxis) => Array.from({ length: 5 }, (_, i) => axis.from+(axis.through-axis.from)*i/4);

/** Effect activation is independent of the producer's continuing obligation. */
export function goalEffectTime(action:Pick<GoalActionNode,'startTick'|'finishTick'>,effect:GoalFactEffect):number|null {
  return effect.at==='start'?action.startTick:effect.at==='finish'?action.finishTick
    :action.startTick==null?null:action.startTick+effect.at.offsetTicks;
}

/** Use recorded availability first; projected effects retain their declared event time.
 * A missing contributor ETA leaves the condition unscheduled. */
export function goalFactTime(plan: GoalPlan, row: GoalPlanFactNode): number | null {
  const observation = row.observation;
  if (observation.availableTick != null) return observation.availableTick;
  if (observation.state === 'met') return observation.observedTick;
  const producers = plan.actions.filter(action => row.producerActionIds.includes(action.id)
    || action.declaration.effects.some(effect => effect.operation==='establish' && effect.fact.id===observation.fact.id));
  const times = producers.flatMap(action => {
    const effects = action.declaration.effects.filter(effect => effect.operation==='establish' && effect.fact.id===observation.fact.id);
    return effects.length ? effects.map(effect => goalEffectTime(action,effect)) : [action.finishTick];
  });
  return times.length && times.every((tick): tick is number => tick!=null && Number.isFinite(tick)) ? Math.max(...times) : null;
}

/** Shared domain for the graph and money band; unknown ETAs never become zero/deadline. */
export function goalTimeAxis(plan: GoalPlan): GoalTimeAxis {
  const times = [...plan.actions.flatMap(row=>[row.startTick,row.finishTick]),
    ...plan.facts.map(row=>goalFactTime(plan,row)), ...plan.resourceTimeline.map(row=>row.tick), plan.completedTick]
    .filter((tick): tick is number => tick!=null && Number.isFinite(tick));
  const first = times.length ? Math.min(...times) : plan.observedTick;
  const from = Math.floor(first/1200)*1200;
  return { from, through: Math.max(from+20,...times), width: 1480, left: 82, right: 82 };
}
