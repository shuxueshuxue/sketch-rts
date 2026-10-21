import type { GoalPlan } from '../ai/strategy/goal-planner-types';

export type GoalTimeAxis = { from: number; through: number; width: number; left: number; right: number };
export const goalTimeX = (axis: GoalTimeAxis, tick: number) => axis.left
  + (tick-axis.from)/(axis.through-axis.from)*(axis.width-axis.left-axis.right);
export const goalTimeTicks = (axis: GoalTimeAxis) => Array.from({length:5},(_,i)=>axis.from+(axis.through-axis.from)*i/4);

/** One absolute clock for the graph and its gold prefixes. No missing ETA is
 * converted to zero or to a deadline. Minute rounding keeps the window stable. */
export function goalTimeAxis(plan: GoalPlan): GoalTimeAxis {
  const times = [...plan.actions.flatMap(row=>[row.startTick,row.finishTick]),
    ...plan.facts.map(row=>row.observation.availableTick),...plan.resourceTimeline.map(row=>row.tick),plan.completedTick]
    .filter((tick):tick is number=>tick!=null&&Number.isFinite(tick));
  const first = times.length?Math.min(...times):plan.observedTick;
  const from = Math.floor(first/1200)*1200;
  return { from,through:Math.max(from+20,...times),width:1480,left:82,right:82 };
}
