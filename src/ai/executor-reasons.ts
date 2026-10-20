import type { AiPolicyMemory } from './memory';

/** Observed decision branches, not new orders or a planner's inferred prerequisites. */
export type ExecutorReason = {
  executor: string;
  outcome: 'candidate-rejected' | 'blocked' | 'abandoned' | 'paused';
  reason: string;
  taskId?: string;
  targetIds?: string[];
  unitIds?: string[];
};
export type ExecutorReasonSink = (reason: ExecutorReason) => void;
type Context = { tick: number; reasons: ExecutorReason[] };
const contexts = new WeakMap<AiPolicyMemory, Context>();

/** One completed think at most, outside policy memory and simulation state.
 * Nested mission contexts inherit this sink, even when their combat memory is private. */
export function beginExecutorReasons(memory: AiPolicyMemory, tick: number): ExecutorReasonSink {
  const frame: Context = { tick, reasons: [] };
  contexts.set(memory, frame);
  return reason => frame.reasons.push(structuredClone(reason));
}

export function recordExecutorReason(options: { executorReason?: ExecutorReasonSink; executorTaskId?: string }, reason: ExecutorReason) {
  if (options.executorReason) options.executorReason({
    ...(options.executorTaskId ? { taskId: options.executorTaskId } : {}), ...reason,
  });
}

export function executorReasonsAt(memory: AiPolicyMemory, tick: number): ExecutorReason[] | undefined {
  const frame = contexts.get(memory);
  return frame?.tick === tick && frame.reasons.length ? structuredClone(frame.reasons) : undefined;
}
