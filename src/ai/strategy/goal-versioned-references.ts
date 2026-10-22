import type { GoalParameter } from './goal-planner-types';

/** Authoritative identities, not an evictable evidence cache. Only explicit
 * reference roots may release an entry; the version counter never rewinds. */
export type GoalReferenceMemory = {
  version: 1;
  nextVersion: number;
  entries: Record<string, { namespace: string; content: GoalParameter }>;
};
const namespacePattern = /^[A-Za-z0-9_-]{1,64}$/;
const referencePattern = /^goal-ref:([A-Za-z0-9_-]{1,64}):v(0|[1-9][0-9]*)$/;
const plain = (value: object) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;

/** Validate before JSON.stringify: JSON would otherwise erase undefined,
 * holes, non-finite numbers, accessors and non-JSON object identities. Shared
 * acyclic input objects are valid; only ancestors constitute a cycle. */
function jsonBytes(value: unknown): string {
  const ancestors = new Set<object>();
  const stack: { value: unknown; exit?: boolean }[] = [{ value }];
  while (stack.length) {
    const current = stack.pop()!, item = current.value;
    if (current.exit) { ancestors.delete(item as object); continue; }
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number' && Number.isFinite(item)) continue;
    if (typeof item !== 'object' || !item || ancestors.has(item)) throw Error('Goal reference content must be finite acyclic plain JSON');
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : !plain(item)) throw Error('Goal reference content must be plain JSON');
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (array && keys.length !== item.length + 1) throw Error('Goal reference arrays must be dense JSON arrays');
    ancestors.add(item); stack.push({ value: item, exit: true });
    for (const key of keys) {
      if (typeof key !== 'string') throw Error('Goal reference content must have JSON string keys');
      if (array && key === 'length') continue;
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) throw Error('Goal reference content must have plain JSON properties');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))
        throw Error('Goal reference arrays must not have extra properties');
      stack.push({ value: descriptor.value });
    }
  }
  return JSON.stringify(value);
}

function checkTable(table: GoalReferenceMemory) {
  if (table.version !== 1 || !Number.isSafeInteger(table.nextVersion) || table.nextVersion < 0
    || !table.entries || !plain(table.entries) || Array.isArray(table.entries)) throw Error('Invalid goal reference table');
  for (const id of Object.keys(table.entries)) {
    const entry = table.entries[id]!, match = referencePattern.exec(id);
    if (!match || id.length > 128 || !entry || entry.namespace !== match[1]
      || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) >= table.nextVersion)
      throw Error('Invalid goal reference identity or version counter');
  }
}

/** Byte identity is the ordinary JSON serialization, including property order.
 * No hash, sorted-key approximation or serialized duplicate is stored. */
export function internGoalReference(table: GoalReferenceMemory, namespace: string, content: GoalParameter): string {
  checkTable(table);
  if (typeof namespace !== 'string' || !namespacePattern.test(namespace)) throw Error('Invalid goal reference namespace');
  const bytes = jsonBytes(content);
  for (const [id, entry] of Object.entries(table.entries))
    if (entry.namespace === namespace && jsonBytes(entry.content) === bytes) return id;
  if (table.nextVersion >= Number.MAX_SAFE_INTEGER) throw Error('Goal reference version counter exhausted');
  const id = `goal-ref:${namespace}:v${table.nextVersion}`;
  // Normalize exactly as a JSON restore (including -0), and detach caller data.
  table.entries[id] = { namespace, content: JSON.parse(bytes) as GoalParameter };
  table.nextVersion++;
  return id;
}

/** Missing references are unknown; a caller never receives a mutable alias
 * into the identity table's authoritative parameters. */
export function readGoalReference(table: GoalReferenceMemory, id: string): GoalParameter | undefined {
  checkTable(table);
  if (!Object.hasOwn(table.entries, id)) return undefined;
  return JSON.parse(jsonBytes(table.entries[id]!.content)) as GoalParameter;
}

/** Exact reference strings in JSON values or object keys are edges. Closure
 * follows existing entries only, including forward edges and reference cycles.
 * Unreachable rows are removed atomically after traversal validates the roots. */
export function retainGoalReferences(table: GoalReferenceMemory, rootIds: readonly string[] | ReadonlySet<string>): void {
  checkTable(table);
  const live = new Set<string>(), pending = [...rootIds];
  while (pending.length) {
    const id = pending.pop()!;
    if (live.has(id) || !Object.hasOwn(table.entries, id)) continue;
    const content = JSON.parse(jsonBytes(table.entries[id]!.content)) as GoalParameter;
    live.add(id);
    const values: GoalParameter[] = [content];
    while (values.length) {
      const value = values.pop()!;
      if (typeof value === 'string') { if (Object.hasOwn(table.entries, value)) pending.push(value); }
      else if (Array.isArray(value)) for (const item of value) values.push(item);
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(table.entries, key)) pending.push(key);
        values.push(item);
      }
    }
  }
  table.entries = Object.fromEntries(Object.entries(table.entries).filter(([id]) => live.has(id)));
}
