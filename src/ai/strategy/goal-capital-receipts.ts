import { BUILDING_DEFS } from '../../shared/catalog';
import type { GameSnapshot } from '../../shared/types';
import type { ExecutorFeedback, StrategyAllocationMemory } from './allocation-types';
import { admittedCommandSpendIds } from './goal-capital-lineage';
import { applyAllocationPayments } from './allocation-ledger';
import { validateGoalOutputFeedback } from './goal-output-validation';
import { readGoalIntent } from './goal-authority-references';
import { sameAction } from './control';

/** Settle an actually admitted purchase even after the worker/plan advances
 * to another atom. Observation grants no command, worker or forecast cash. */
export function reconcileGoalCapitalReceipts(memory: StrategyAllocationMemory, snapshot: GameSnapshot): StrategyAllocationMemory {
  for (const original of Object.values(memory.issuedCommands)) {
    const build = original.command, before = original.worldBefore;
    const execution = memory.executions[original.action.actionId];
    if (build.type !== 'build' || before?.kind !== 'construction' || original.acceptedTick > snapshot.tick || !execution
      || !sameAction(execution.token, original.action) || execution.intent.kind !== 'goal-action'
      || execution.intent.actionKind !== 'build' || execution.executor !== original.executor) continue;
    const spendIds = admittedCommandSpendIds(memory, original);
    const budgets = Object.values(memory.budgets).filter(budget => budget.objectiveId === execution.objectiveId
      && spendIds.includes(budget.spendId));
    if (budgets.length !== 1) continue;
    const budget = budgets[0]!;
    const buildings = snapshot.buildings.filter(building => building.owner === memory.owner && building.hp > 0
      && building.kind === build.buildingKind && building.x === build.x && building.y === build.y
      && !before.buildingIds.includes(building.id));
    if (buildings.length !== 1) continue;
    const building = buildings[0]!, price = BUILDING_DEFS[building.kind].cost;
    const recorded = budget.nativePayments?.some(payment => payment.commandId === original.id && payment.entityId === building.id);
    if (!recorded && price + budget.paidGold > (budget.plannedGold ?? budget.amountGold)) continue;
    // A restored old budget may already have been trimmed/released after its
    // native purchase. Only this exact foundation proof restores the invoice.
    memory = { ...memory,
      issuedCommands: { ...memory.issuedCommands, [original.id]: { ...original, spendIds } },
      budgets: { ...memory.budgets, [budget.id]: { ...budget, action: original.action, methodId: execution.methodId,
        amountGold: Math.max(budget.amountGold, budget.paidGold + (recorded ? 0 : price)),
        state: recorded && budget.paidGold >= budget.amountGold ? 'spent' : 'reserved', releasedTick: null } } };
    memory = applyAllocationPayments(memory, snapshot, original.action, [{ budgetId: budget.id, amountGold: price,
      proof: { kind: 'foundation', buildingId: building.id, acceptedCommandId: original.id } }]);
    const intent = readGoalIntent(memory, execution.intent);
    const observation: ExecutorFeedback = { action: original.action, allocationRevision: memory.revision,
      status: execution.status, phase: execution.phase, state: execution.state,
      commands: [], progress: [], reasons: [], blocked: [], handoffs: [],
      goalOutputs: intent.outputs.includes('building') ? [{ output: 'building', entityId: building.id,
        observedTick: snapshot.tick, proof: { kind: 'foundation', acceptedCommandId: original.id } }] : [] };
    const validated = validateGoalOutputFeedback(memory, snapshot, observation);
    memory = { ...memory, executions: { ...memory.executions,
      [execution.token.actionId]: { ...execution, state: validated.state } } };
  }
  return memory;
}
