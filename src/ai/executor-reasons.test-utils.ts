/** The only memory leaves allowed to differ in the executor-reason audit.
 * In particular interruptions, counters, retries, claims and every order remain visible. */
export function isExecutorReasonPath(path: readonly string[]) {
  if (path.length === 2) return path[0] === 'landExpansion' && path[1] === 'reason';
  if (path[0] !== 'naval') return false;
  if (path.length === 4 && ['conquests', 'ferryDecisions'].includes(path[1]!)) return path[3] === 'reason';
  if (path.length === 5 && path[1] === 'ferryDecisions') return path[3] === 'lastBlock' && path[4] === 'reason';
  if (path.length === 5 && path[1] === 'ferryFailures') return path[4] === 'reason';
  if (path[1] !== 'firstCombatDelivery') return false;
  return path.length === 5 && path[2] === 'attempts' && path[4] === 'reason'
    || path.length === 4 && path[2] === 'firstMinuteBlock' && path[3] === 'reason';
}

export function executorBehaviorMemory(value: unknown, path: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((child, index) => executorBehaviorMemory(child, [...path, String(index)]));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isExecutorReasonPath([...path, key]))
    .map(([key, child]) => [key, executorBehaviorMemory(child, [...path, key])]));
}

export function executorMemoryReasons(value: unknown, path: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const at = [...path, key];
    return isExecutorReasonPath(at) ? [[JSON.stringify(at), child]] : Object.entries(executorMemoryReasons(child, at));
  }));
}
