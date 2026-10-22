import type { CommandAdmission, StrategyAllocationMemory, StrategyAllocationTrace } from './allocation-types';

const ordered = <T extends { id: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Pure presentation of the existing transaction. It never evaluates a
 * Situation, advances observation progress, or changes allocation authority.
 * Call only when an observer asks; ordinary control need not build this view. */
export function projectStrategyAllocation(memory: StrategyAllocationMemory,
  commandAdmissions?: readonly CommandAdmission[]): StrategyAllocationTrace {
  const budget = ordered(Object.values(memory.budgets));
  return { revision: memory.revision,
    ...(memory.goalReferences ? { goalReferences: memory.goalReferences } : {}),
    ...(memory.decisionCounts ? { decisionCounts: memory.decisionCounts } : {}),
    objectives: Object.values(memory.objectives).sort((a, b) => a.objectiveId < b.objectiveId ? -1 : a.objectiveId > b.objectiveId ? 1 : 0),
    assignments: ordered(Object.values(memory.assignments)),
    executions: Object.values(memory.executions).sort((a, b) => a.token.actionId < b.token.actionId ? -1 : a.token.actionId > b.token.actionId ? 1 : 0),
    budget, voyages: ordered(Object.values(memory.voyages)), vacancies: ordered(Object.values(memory.vacancies)),
    blocked: ordered(Object.values(memory.blocked)), unmet: ordered(memory.unmet), events: [...memory.events],
    ...(commandAdmissions ? { commandAdmissions: [...commandAdmissions] } : {}),
    budgetProjection: budget.map(entry => ({ id: entry.id, objectiveId: entry.objectiveId, methodId: entry.methodId,
      subgoalId: entry.action.actionId, gold: entry.amountGold - entry.paidGold,
      state: entry.state === 'reserved' ? 'reserved' : entry.state === 'spent' ? 'spent' : 'released',
      authority: 'committed', sinceTick: entry.sinceTick, releasedTick: entry.releasedTick,
      releaseWhen: ['spent', 'completed', 'failed', 'abandoned', 'expired'], evidence: [{ source: 'strategyAllocation.budgets',
        tick: memory.evaluatedTick, certainty: 'recorded', detail: 'Projection of the same semantic spend, not additional spendable cash' }] })),
  };
}
