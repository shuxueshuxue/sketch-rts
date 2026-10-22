import { observationJsonBytes } from './observation-json-bytes';

export type CacheUse = { lastUsedThink?: number; planIds?: string[] };
export type CachePressure = Readonly<{ kind: string; thinkSequence: number; bytes: number; limitBytes: number;
  entries?: number; limitEntries?: number; planIds: readonly string[]; requestIds: readonly string[]; overflowCount: number }>;
export type CacheCapacity = { overflowCount: number; pressure?: CachePressure };

/** Cache policy only. Owners supply identities, references and payload sizing;
 * the helper neither reads world facts nor runs work. Pins may exceed a limit,
 * but must survive with an explicit pressure receipt instead of being restarted. */
export function boundCache<T>(input: Readonly<{
  kind: string; entries: readonly T[]; id: (entry: T) => string; lastUsed: (entry: T) => number;
  plans: (entry: T) => readonly string[]; maxEntries?: number; maxBytes?: number;
  bytes?: (entries: readonly T[]) => number; thinkSequence: number; capacity?: CacheCapacity | undefined;
}>) {
  const maxEntries = input.maxEntries ?? Number.MAX_SAFE_INTEGER, maxBytes = input.maxBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw Error('Invalid bounded cache capacity');
  const size = input.bytes ?? observationJsonBytes, entries = [...input.entries];
  const pins = entries.filter(entry => input.plans(entry).length > 0);
  const victims = entries.filter(entry => !input.plans(entry).length).sort((a, b) => input.lastUsed(a) - input.lastUsed(b)
    || (input.id(a) < input.id(b) ? -1 : input.id(a) > input.id(b) ? 1 : 0));
  const evicted: T[] = [];
  let bytes = size(entries);
  while ((entries.length > maxEntries || bytes > maxBytes) && victims.length) {
    const entry = victims.shift()!; entries.splice(entries.indexOf(entry), 1); evicted.push(entry); bytes = size(entries);
  }
  const pinnedBytes = pins.length === entries.length ? bytes : size(pins), prior = input.capacity;
  const overflow = pins.length > maxEntries || pinnedBytes > maxBytes;
  const overflowCount = (prior?.overflowCount ?? 0) + (overflow && !prior?.pressure ? 1 : 0);
  const pressure: CachePressure | undefined = overflow ? { kind: input.kind, thinkSequence: input.thinkSequence,
    bytes: pinnedBytes, limitBytes: maxBytes, entries: pins.length, limitEntries: maxEntries,
    planIds: [...new Set(pins.flatMap(entry => [...input.plans(entry)]))].sort(), requestIds: pins.map(input.id).sort(), overflowCount } : undefined;
  const capacity: CacheCapacity = { overflowCount, ...(pressure ? { pressure } : {}) };
  return { entries, evicted, pins, bytes, pinnedBytes, capacity };
}

/** Reads within one publication epoch share their references. A new epoch
 * replaces the old readers; an unread entry can still be retained explicitly
 * by the selected graph at the end of the pass. */
export function touchCache(use: CacheUse, sequence: number, planIds: readonly string[]) {
  use.planIds = [...new Set([...(use.lastUsedThink === sequence ? use.planIds ?? [] : []), ...planIds])].sort();
  use.lastUsedThink = sequence;
}
export function retainCachePins<T extends CacheUse>(entries: readonly T[], references: ReadonlyMap<string, ReadonlySet<string>>,
  id: (entry: T) => string, sequence: number) {
  for (const entry of entries) {
    const explicit = [...references].filter(([, ids]) => ids.has(id(entry))).map(([plan]) => plan);
    const current = entry.lastUsedThink === sequence ? (entry.planIds ?? []).filter(plan => references.has(plan)) : [];
    entry.planIds = [...new Set([...explicit, ...current])].sort();
    if (!entry.planIds.length) delete entry.planIds;
  }
}

/** Recomputable process-local projections have no retained evidence slots:
 * values are copied into their consumers. Their LRU still uses this policy. */
export function retainCacheMap<K extends string | number, V>(values: Map<K, V>, key: K, value: V, limit: number) {
  values.delete(key); values.set(key, value);
  if (values.size <= limit) return;
  const result = boundCache({ kind: 'projection', entries: [...values].map(([id, value], lastUsed) => ({ id, value, lastUsed })),
    id: entry => String(entry.id), lastUsed: entry => entry.lastUsed, plans: () => [], maxEntries: limit, thinkSequence: 0 });
  for (const entry of result.evicted) values.delete(entry.id);
}
export function readCacheMap<K extends string | number, V>(values: Map<K, V>, key: K): V | undefined {
  const value = values.get(key);
  if (values.has(key)) { values.delete(key); values.set(key, value!); }
  return value;
}
