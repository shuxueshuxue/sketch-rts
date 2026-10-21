/** JSON output only. Stable row keys keep a moving unit from resending the whole situation. */
export type PlanOutputDelta =
  | { kind: 'replace'; value: unknown }
  | { kind: 'fields'; set: Record<string, PlanOutputDelta>; remove: string[] }
  | { kind: 'rows'; key: RowKey; upsert: { id: string; delta: PlanOutputDelta }[]; remove: string[]; order?: string[] };

type RowKey = 'id' | 'objectiveId' | 'actionId' | 'goalKey';
const rowKeys: readonly RowKey[] = ['id', 'objectiveId', 'actionId', 'goalKey'];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function rowId(value: unknown, key: RowKey): string | undefined {
  if (!record(value)) return undefined;
  const id = key === 'actionId' && record(value.token) ? value.token.actionId : value[key];
  return typeof id === 'string' ? id : undefined;
}

function keyed(rows: readonly unknown[], key: RowKey): Map<string, unknown> | undefined {
  const result = new Map<string, unknown>();
  for (const row of rows) {
    const id = rowId(row, key);
    if (id === undefined || result.has(id)) return undefined;
    result.set(id, row);
  }
  return result;
}

/** Undefined means unchanged; a first observation still travels as a complete baseline. */
export function diffPlanOutput(before: unknown, after: unknown): PlanOutputDelta | undefined {
  if (Object.is(before, after)) return undefined;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === 0 && after.length === 0) return undefined;
    for (const key of rowKeys) {
      const oldRows = keyed(before, key), newRows = keyed(after, key);
      if (!oldRows || !newRows) continue;
      const upsert: { id: string; delta: PlanOutputDelta }[] = [];
      for (const [id, row] of newRows) {
        const delta = diffPlanOutput(oldRows.get(id), row);
        if (delta) upsert.push({ id, delta });
      }
      const remove = [...oldRows.keys()].filter(id => !newRows.has(id));
      const nextOrder = [...newRows.keys()];
      const resultingOrder = [...oldRows.keys()].filter(id => newRows.has(id));
      resultingOrder.push(...nextOrder.filter(id => !oldRows.has(id)));
      const orderChanged = resultingOrder.some((id, index) => id !== nextOrder[index]);
      if (!upsert.length && !remove.length && !orderChanged) return undefined;
      const delta: PlanOutputDelta = { kind: 'rows', key, upsert, remove,
        ...(orderChanged ? { order: nextOrder } : {}) };
      return smaller(delta, after);
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  } else if (record(before) && record(after)) {
    const entries: [string, PlanOutputDelta][] = [];
    for (const [key, value] of Object.entries(after)) {
      const delta = diffPlanOutput(before[key], value);
      if (delta) entries.push([key, delta]);
    }
    const remove = Object.keys(before).filter(key => !Object.hasOwn(after, key));
    if (!entries.length && !remove.length) return undefined;
    return smaller({ kind: 'fields', set: Object.fromEntries(entries), remove }, after);
  }
  return { kind: 'replace', value: after };
}

function smaller(delta: PlanOutputDelta, after: unknown): PlanOutputDelta {
  const replacement: PlanOutputDelta = { kind: 'replace', value: after };
  return JSON.stringify(delta).length < JSON.stringify(replacement).length ? delta : replacement;
}

/** Copy on write: earlier replay frames must never change when the next packet arrives. */
export function applyPlanOutputDelta(before: unknown, delta: PlanOutputDelta): unknown {
  if (delta.kind === 'replace') return delta.value;
  if (delta.kind === 'fields') {
    if (!record(before)) return undefined;
    const result = { ...before };
    for (const key of delta.remove) delete result[key];
    for (const [key, change] of Object.entries(delta.set)) {
      const value = applyPlanOutputDelta(before[key], change);
      if (value === undefined) return undefined;
      Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  if (!Array.isArray(before)) return undefined;
  const rows = keyed(before, delta.key);
  if (!rows) return undefined;
  for (const id of delta.remove) rows.delete(id);
  for (const { id, delta: change } of delta.upsert) {
    const row = applyPlanOutputDelta(rows.get(id), change);
    if (rowId(row, delta.key) !== id) return undefined;
    rows.set(id, row);
  }
  if (!delta.order) return [...rows.values()];
  if (delta.order.length !== rows.size || new Set(delta.order).size !== rows.size
    || delta.order.some(id => !rows.has(id))) return undefined;
  return delta.order.map(id => rows.get(id));
}
