import type { StrategyAllocationMemory } from './allocation-types';
import { reserveAllocationSpends } from './allocation-ledger';
import { continueGoalMethod } from './goal-execution-continuation';
import { readGoalIntent, storeGoalMethod } from './goal-authority-references';
import { goalPlanCapital } from './goal-plan-capital';
import type { GoalPlan } from './goal-planner-types';

/** A granted chain keeps saving while its next exact facts are pending. This
 * also adopts a saved in-progress chain that predates whole-plan earmarks.
 * No new execution, lease or purchasing grant is created by registration. */
export function reserveAdmittedGoalCapital(memory: StrategyAllocationMemory, plans: readonly GoalPlan[], cashGold: number,
  tick: number): StrategyAllocationMemory {
  for (const plan of plans) {
    if (['complete', 'blocked'].includes(plan.status) || !plan.actions.length) continue;
    const objective = memory.objectives[plan.goal.id], method = objective && memory.methods[objective.methodId];
    if (!objective || ['complete', 'failed', 'abandoned'].includes(objective.status) || method?.kind !== 'goal-plan'
      || !method.actions.some(action => memory.executions[action.id]
        && ['ready', 'active', 'blocked', 'complete'].includes(memory.executions[action.id]!.status))) continue;
    const capital = goalPlanCapital(plan);
    if (capital.pending.length) continue; // An unresolved purchase cannot erase an existing earmark.
    const used = new Set(method.actions.flatMap(action => action.spendIds));
    const spends = [...method.spends.filter(spend => used.has(spend.spendId)),
      ...capital.spends.map(({ paymentSchedule: _evidence, ...spend }) => spend)];
    const actions = method.actions.map(action => {
      if (action.intent.kind !== 'goal-action' || action.intent.actionKind !== 'build' || !action.spendIds.length) return action;
      const parameters = readGoalIntent(memory, action.intent).parameters, at = parameters.at;
      const matches = plan.actions.filter(node => node.declaration.kind === 'build'
        && node.declaration.executor.parameters.buildingKind === parameters.buildingKind
        && JSON.stringify(node.declaration.executor.parameters.at) === JSON.stringify(at));
      const spendId = matches.length === 1 && capital.byAction.get(matches[0]!.id);
      return spendId ? { ...action, spendIds: [spendId] } : action;
    });
    const packed = storeGoalMethod(memory, continueGoalMethod({ ...method, actions, spends }, memory));
    memory = { ...packed.memory, methods: { ...packed.memory.methods, [method.id]: packed.method } };
    memory = reserveAllocationSpends({ memory, method: packed.method, actions: Object.values(memory.executions), cashGold, tick }).memory;
  }
  return memory;
}
