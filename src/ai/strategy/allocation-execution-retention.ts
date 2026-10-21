import type { StrategyAllocationMemory } from './allocation-types';

/** A goal bundle replaces its ready frontier while the objective stays live.
 * Terminal atoms outside that frontier are history, not continuing authority.
 * Keep every graph/proof/resource reference; recent events are standalone
 * diagnostics and do not keep an obsolete execution graph alive. */
export function retainAllocationExecutions(memory: StrategyAllocationMemory): StrategyAllocationMemory {
  const retained = new Set<string>();
  const visit = (id: string): void => {
    if (retained.has(id)) return;
    const execution = memory.executions[id];
    if (!execution) return;
    retained.add(id);
    for (const parent of execution.dependsOn) visit(parent);
  };
  for (const execution of Object.values(memory.executions)) {
    // Old method families retain their terminal handoff semantics. Goal outputs
    // remain available to the central binding validator after their atom ends.
    if (!['complete', 'failed', 'abandoned'].includes(execution.status)
      || execution.intent.kind !== 'goal-action' || execution.intent.outputs.length) visit(execution.token.actionId);
  }
  for (const method of Object.values(memory.methods)) for (const action of method.actions) {
    visit(action.id);
    for (const parent of action.dependsOn) visit(parent);
  }
  for (const objective of Object.values(memory.objectives)) for (const id of objective.actionIds) visit(id);
  for (const records of [memory.leases, memory.assignments, memory.budgets, memory.voyages, memory.vacancies,
    memory.issuedOrders, memory.issuedCommands]) for (const record of Object.values(records)) visit(record.action.actionId);
  for (const quote of Object.values(memory.blocked)) visit(quote.parent.actionId);
  for (const job of memory.goalTraining?.jobs ?? []) visit(job.action.actionId);
  for (const event of memory.events) if (event.kind === 'preempted' && event.handoff === 'pending') visit(event.action.actionId);
  return { ...memory, executions: Object.fromEntries(Object.entries(memory.executions).filter(([id]) => retained.has(id))) };
}
