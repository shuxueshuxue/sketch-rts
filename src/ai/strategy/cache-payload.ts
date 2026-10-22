import { deflateSync, inflateSync, strFromU8, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { observationJsonBytes } from './observation-json-bytes';
import { readGoalSearchRecords, storeGoalSearchRecords } from './goal-search-record';
import type { GoalFactReader, GoalPlanCacheEntry } from './goal-planner-types';

type Node = { value: string | number | boolean | null } | { array: number[] } | { object: [string, number][] };
export type CachePayload<T> = { entries: readonly T[]; packedEntries?: { encoding: 'json-deflate-v1' | 'json-dag-deflate-v2'; data: string };
  referenceEncoding?: 'goal-definitions-v1'; references?: GoalPlanningReferences; searchRecordVersion?: 1 };
export function storeGoalCachePayload<T>(entries: readonly T[]): CachePayload<T> {
  const search = entries.every(entry => !!entry && typeof entry === 'object' && 'plan' in entry);
  const rows = search ? storeGoalSearchRecords(entries as unknown as readonly GoalPlanCacheEntry[]) as readonly T[] : entries;
  const encoded = encodeGoalPlanningValue(rows), references = goalPlanningStandaloneReferences();
  return { entries: encoded, referenceEncoding: 'goal-definitions-v1', ...(search ? { searchRecordVersion: 1 as const } : {}),
    ...(references ? { references: retainGoalPlanningReferences(references, encoded) } : {}) };
}
/** Only serialization changes. Large declarative continuations contain many
 * repeated fact IDs; lossless storage keeps their real working set inside the
 * existing byte quota without dropping a selected plan or its alternatives. */
export function storeCachePayload<T>(entries: readonly T[]): CachePayload<T> {
  const json = JSON.stringify(entries);
  if (json.length < 16 * 1024) return { entries };
  const nodes: Node[] = [], seen = new Map<string, number>();
  const visit = (value: any): number => {
    const node: Node = Array.isArray(value) ? { array: value.map(visit) } : value && typeof value === 'object'
      ? { object: Object.entries(value).map(([key, item]) => [key, visit(item)]) } : { value };
    const key = JSON.stringify(node), old = seen.get(key);
    if (old !== undefined) return old;
    const id = nodes.length; seen.set(key, id); nodes.push(node); return id;
  };
  const root = visit(JSON.parse(json));
  const bytes = deflateSync(strToU8(JSON.stringify({ root, nodes }))), parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192) parts.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  const packed = { entries: [], packedEntries: { encoding: 'json-dag-deflate-v2' as const, data: btoa(parts.join('')) } };
  return observationJsonBytes(packed) < observationJsonBytes({ entries }) ? packed : { entries };
}
export function readCachePayload<T>(payload: CachePayload<T>, readFact?: GoalFactReader): readonly T[] {
  if (payload.referenceEncoding === 'goal-definitions-v1') {
    if (payload.searchRecordVersion && !readFact && payload.entries.some(entry =>
      (entry as unknown as GoalPlanCacheEntry).continuation?.demandDriven))
      throw Error('A selected goal cache requires current fact observations');
    const references = payload.references ?? currentGoalPlanningReferences();
    if (!references) throw Error('Goal cache requires its seat reference table');
    return withGoalPlanningReferences(references, () => {
      const entries = hydrateGoalPlanningValue(payload.entries);
      return payload.searchRecordVersion ? readGoalSearchRecords(entries as readonly GoalPlanCacheEntry[], readFact) as readonly T[] : entries;
    });
  }
  if (!payload.packedEntries) return payload.entries;
  const bytes = Uint8Array.from(atob(payload.packedEntries.data), character => character.charCodeAt(0));
  const stored = JSON.parse(strFromU8(inflateSync(bytes)));
  const restore = (id: number): unknown => {
    const node = stored.nodes[id] as Node;
    // Restore independent JSON objects, not shared mutable DAG aliases.
    return 'value' in node ? node.value : 'array' in node ? node.array.map(restore)
      : Object.fromEntries(node.object.map(([key, value]) => [key, restore(value)]));
  };
  const result: unknown = payload.packedEntries.encoding === 'json-dag-deflate-v2' ? restore(stored.root)
    : payload.packedEntries.encoding === 'json-deflate-v1' ? stored : undefined;
  if (!Array.isArray(result)) throw Error('Invalid cache entries');
  return result as T[];
}
import { currentGoalPlanningReferences, encodeGoalPlanningValue, goalPlanningStandaloneReferences,
  hydrateGoalPlanningValue, retainGoalPlanningReferences, withGoalPlanningReferences,
  type GoalPlanningReferences } from './goal-planning-references';
