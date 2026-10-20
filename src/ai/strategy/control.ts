import type { AiPolicyMemory } from '../memory';
import type { PlayerId } from '../../shared/types';
import type { ActionToken, StrategyAllocationMemory } from './allocation-types';

export type StrategyLeaseActor = Readonly<{ action: ActionToken }>
  | Readonly<{ source: string; taskId?: string }>;

export function sameAction(left: ActionToken, right: ActionToken): boolean {
  return left.actionId === right.actionId && left.generation === right.generation;
}

export function createStrategyAllocationMemory(owner: PlayerId, tick: number): StrategyAllocationMemory {
  return { version: 1, owner, evaluatedTick: tick - 1, revision: 0, nextActionGeneration: 1, nextEventSequence: 1,
    objectives: {}, executions: {}, leases: {}, assignments: {}, budgets: {}, voyages: {}, vacancies: {},
    issuedOrders: {}, issuedCommands: {}, blocked: {}, unmet: [], events: [] };
}

/** Selection admission, before a task writes membership or claims. Command
 * admission still checks the same authority at the final common gateway. */
export function strategyLeaseAllows(memory: Pick<AiPolicyMemory, 'strategyAllocation'>, unitId: string,
  actor?: StrategyLeaseActor): boolean {
  const lease = memory.strategyAllocation?.leases[`unit:${unitId}`];
  if (!lease) return true;
  if (!actor) return false;
  if ('action' in actor) return sameAction(lease.action, actor.action);
  return lease.origin === 'imported-task' && lease.incumbentTask !== null
    && lease.incumbentTask.source === actor.source
    && (actor.taskId === undefined || lease.incumbentTask.taskId === actor.taskId);
}

/** Bounds are on live control state, not an archive. Reaching a bound is an
 * explicit fault, never permission to drop an active lease or pending handoff. */
export const STRATEGY_ALLOCATION_LIMITS = Object.freeze({
  bytes: 256 * 1024,
  objectives: 64,
  executions: 256,
  leases: 512,
  assignments: 512,
  budgets: 128,
  voyages: 64,
  vacancies: 128,
  issuedOrders: 512,
  issuedCommands: 256,
  blocked: 64,
  unmet: 256,
  events: 256,
  recentEvents: 128,
});

/** Validate before publishing/persisting a transaction. The recursive pass
 * rejects values which JSON would silently coerce (nonfinite, undefined),
 * callbacks, class instances and reference cycles. No world graph is allowed. */
export function assertStrategyAllocationBounds(memory: StrategyAllocationMemory): number {
  for (const key of ['objectives', 'executions', 'leases', 'assignments', 'budgets', 'voyages', 'vacancies',
    'issuedOrders', 'issuedCommands', 'blocked', 'unmet', 'events'] as const) {
    const count = Array.isArray(memory[key]) ? memory[key].length : Object.keys(memory[key]).length;
    if (count > STRATEGY_ALLOCATION_LIMITS[key]) throw new Error(`Strategy allocation ${key} limit exceeded: ${count}`);
  }
  const active = new Set<object>();
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Nonfinite strategy allocation value at ${path}`);
      return;
    }
    if (typeof value !== 'object') throw new Error(`Non-JSON strategy allocation value at ${path}`);
    if (active.has(value)) throw new Error(`Cyclic strategy allocation value at ${path}`);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new Error(`Non-JSON strategy allocation object at ${path}`);
    active.add(value);
    for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
    active.delete(value);
  };
  visit(memory, 'strategyAllocation');
  const bytes = new TextEncoder().encode(JSON.stringify(memory)).byteLength;
  if (bytes > STRATEGY_ALLOCATION_LIMITS.bytes) throw new Error(`Strategy allocation byte limit exceeded: ${bytes}`);
  return bytes;
}
