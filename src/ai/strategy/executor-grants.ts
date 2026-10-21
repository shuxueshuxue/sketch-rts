import type { Unit } from '../../shared/types';
import type { ExecutorFeedback, ExecutorInput } from './allocation-types';
import { sameAction } from './control';
export { sameAction } from './control';

export function validExecutorGrant(input: ExecutorInput) {
  return sameAction(input.execution.token, input.grant.action)
    && input.execution.objectiveId === input.objective.id && input.grant.objectiveId === input.objective.id
    && input.execution.methodId === input.method.id && input.grant.methodId === input.method.id;
}

/** Leases, rather than former claims or orders, define this executor's pool. */
export function grantedUnits(input: ExecutorInput): Unit[] {
  if (!validExecutorGrant(input)) return [];
  const ids = new Set(input.grant.leases.filter(lease => sameAction(lease.action, input.execution.token)
    && lease.objectiveId === input.objective.id && lease.resourceKey.startsWith('unit:'))
    .map(lease => lease.resourceKey.slice(5)));
  return input.snapshot.units.filter(unit => ids.has(unit.id) && unit.owner === input.owner && unit.hp > 0);
}

export function executorFeedback(input: ExecutorInput): ExecutorFeedback {
  return { action: input.execution.token, allocationRevision: input.grant.revision,
    state: input.execution.state, phase: input.execution.phase, status: input.execution.status,
    commands: [], progress: [], reasons: [], blocked: [], handoffs: [] };
}

export function blockedExecutor(input: ExecutorInput, reason: string, unitIds: string[] = []): ExecutorFeedback {
  return { ...executorFeedback(input), status: 'blocked', reasons: [{ executor: input.execution.executor,
    outcome: 'blocked', reason, taskId: input.execution.token.actionId, unitIds,
    ...(input.execution.target.entityId ? { targetIds: [input.execution.target.entityId] } : {}) }] };
}
