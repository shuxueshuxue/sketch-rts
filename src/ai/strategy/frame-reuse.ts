// Raw snapshots and per-candidate assessments are useful only inside one
// synchronous assessment. Do not leave them in process-wide ephemeron tables:
// their graphs would then depend on a later GC to end their lifetime.
let current: Map<symbol, Map<object, unknown>> | undefined;

export function withStrategyFrame<T>(run: () => T): T {
  const previous = current; current = new Map();
  try { return run(); }
  finally { current = previous; }
}

export function frameMemo<T>(domain: symbol, key: object, compute: () => T): T {
  if (!current) return compute();
  let entries = current.get(domain);
  if (!entries) current.set(domain, entries = new Map());
  if (!entries.has(key)) entries.set(key, compute());
  return entries.get(key) as T;
}
