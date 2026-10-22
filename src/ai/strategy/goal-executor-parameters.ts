import type { ExecutorInput, IssuedActionCommand } from './allocation-types';
import { grantedUnits, sameAction, validExecutorGrant } from './executor-grants';
import type { GoalExecutableIntent } from './goal-execution-types';
import type { GoalActionKind } from './goal-planner-types';
import type { Point, Target } from './types';
import { readGoalIntent } from './goal-authority-references';

/** Shared decoding only. No output resolution, authority or world entity is
 * invented from a parameter string, action name or predicted factory ID. */
export function goalRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
export function goalPoint(value: unknown): Point | null {
  const point = goalRecord(value);
  return point && typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
    ? { x: point.x, y: point.y } : null;
}
export function goalTarget(value: unknown): Target | null {
  const target = goalRecord(value), point = goalPoint(target?.point);
  if (!target || !point || target.entityId !== undefined && typeof target.entityId !== 'string'
    || target.landId !== undefined && (typeof target.landId !== 'string' || !/^land:\d+$/.test(target.landId))
    || target.seaId !== undefined && (typeof target.seaId !== 'string' || !/^sea:\d+$/.test(target.seaId))) return null;
  return { point, ...(typeof target.entityId === 'string' ? { entityId: target.entityId } : {}),
    ...(typeof target.landId === 'string' ? { landId: target.landId as `land:${number}` } : {}),
    ...(typeof target.seaId === 'string' ? { seaId: target.seaId as `sea:${number}` } : {}) };
}
export function goalEntityId(value: unknown): string | null {
  const reference = goalRecord(value);
  return reference?.kind === 'existing' && typeof reference.entityId === 'string' && reference.entityId.length > 0
    ? reference.entityId : null;
}
export function goalEntityIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map(goalEntityId);
  return ids.some(id => id === null) ? null : [...new Set(ids as string[])].sort();
}
export function goalActionIntent(input: ExecutorInput, kind: GoalActionKind): GoalExecutableIntent | null {
  return validExecutorGrant(input) && input.execution.intent.kind === 'goal-action' && input.execution.intent.actionKind === kind
    && input.execution.intent.goalId === input.objective.id ? readGoalIntent(input, input.execution.intent) : null;
}
export function goalHasLease(input: ExecutorInput, resourceKey: string): boolean {
  return validExecutorGrant(input) && input.grant.leases.some(lease => lease.resourceKey === resourceKey
    && sameAction(lease.action, input.execution.token) && lease.objectiveId === input.objective.id && lease.methodId === input.method.id);
}
export function goalGrantedCohort(input: ExecutorInput, ids: readonly string[]) {
  const units = grantedUnits(input).filter(unit => ids.includes(unit.id) && goalHasLease(input, `unit:${unit.id}`)
    && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
  const missingIds = ids.filter(id => !units.some(unit => unit.id === id));
  return { units, missingIds };
}
export function goalAcceptedCommands(input: ExecutorInput): readonly IssuedActionCommand[] {
  return input.grant.commands.filter(command => sameAction(command.action, input.execution.token)
    && command.executor === input.execution.executor);
}
