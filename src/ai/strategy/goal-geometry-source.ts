import { boundCache } from './bounded-cache';
import { fnv1a } from '../../shared/sim/checksum';
import { factPublicationPending, type FactWorkQueue } from './fact-work';
import { goalValueKey } from './goal-facts';
import type { GoalGeometryMemory, GoalGeometryReader, GoalPublishedValue } from './goal-grounding-ports';
import type { GoalParameter } from './goal-planner-types';
import { observationJsonBytes } from './observation-json-bytes';
import { navigationAuditActive } from '../../shared/navigation-audit';

// Original eleven public cold frames, frozen world/K20/6144, measured on
// a5764f96 (puzzle source b6cb3d85). The full pinned payload including its JSON
// envelope peaks at 16,888 bytes / 19 entries; both capacities retain 2x that
// observed working set. Diagnostics are separate metadata. See PR #585's
// measurement-b6cb3d85/geometry-measurement.json and the source evidence archive.
export const GOAL_GEOMETRY_ENTRIES = 19 * 2;
export const GOAL_GEOMETRY_BYTES = 16888 * 2;
const SLICE = 128;
type Entry = GoalGeometryMemory['entries'][number];
const entryRequestId = (entry: Pick<Entry, 'key' | 'revision'>) => `goal-geometry:${goalValueKey([entry.key, entry.revision])}`;

/** A publication cursor, not a second pathfinder or work allowance. Domains
 * supply finite native checks; only this queue may advance their cursors. */
export function createGoalGeometryReader(input: Readonly<{
  tick: number; work: FactWorkQueue; memory: GoalGeometryMemory;
  /** Diagnostic measurement does not change work limits or publication. */
  measurement?: boolean;
  limits?: Readonly<{ maxBytes: number; maxEntries: number }>;
}>): GoalGeometryReader {
  const { tick, work, memory } = input;
  const sequence = work.receipt.thinkSequence ?? tick;
  const maxBytes = input.measurement ? Number.MAX_SAFE_INTEGER : input.limits?.maxBytes ?? GOAL_GEOMETRY_BYTES;
  const maxEntries = input.measurement ? Number.MAX_SAFE_INTEGER : input.limits?.maxEntries ?? GOAL_GEOMETRY_ENTRIES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1)
    throw Error('Invalid goal geometry capacity');
  const prior = memory.capacity;
  const referenceValues = new Map<string, NonNullable<GoalGeometryMemory['references']>[number]>();
  const retainReferences = (ids: readonly string[] = []) => {
    for (const id of ids) {
      const value = referenceValues.get(id) ?? memory.references?.find(item => item.id === id);
      if (!value) throw Error('Geometry entry references an unknown version');
      if (!memory.references?.some(item => item.id === id)) (memory.references ??= []).push(value);
    }
  };
  memory.capacity = { mode: input.measurement ? 'measurement' : 'bounded', maxBytes, maxEntries, thinkSequence: sequence,
    pinnedBytes: prior?.pinnedBytes ?? 0, pinnedEntries: prior?.pinnedEntries ?? 0,
    peakPinnedBytes: prior?.peakPinnedBytes ?? 0, peakResidentBytes: prior?.peakResidentBytes ?? 0, overflowCount: prior?.overflowCount ?? 0 };
  boundGoalGeometryMemory(memory);
  const pressured = (planIds: readonly string[], requestId: string) => {
    const capacity = memory.capacity!;
    if (!capacity.pressure) return false;
    capacity.pressure = { ...capacity.pressure, planIds: [...new Set([...capacity.pressure.planIds, ...planIds])].sort(),
      requestIds: [...new Set([...capacity.pressure.requestIds, requestId])].sort() };
    return true;
  };
  const read: GoalGeometryReader = request => {
    const requestId = entryRequestId(request);
    work.consume(requestId);
    const plans = work.consumerPlanIds();
    const pending = (code: string, requestedTick = tick): GoalPublishedValue<never> => ({
      state: 'pending', requestIds: [requestId],
      reason: { code, factIds: [requestId], values: { requestedTick, tick } },
    });
    let entry = memory.entries.find(item => item.key === request.key && item.revision === request.revision);
    if (entry) {
      if (request.references?.length) { retainReferences(request.references); entry.references = [...request.references]; }
      entry.lastUsedThink = sequence;
      if (plans.length) entry.planIds = [...new Set([...(entry.planIds ?? []), ...plans])].sort();
      boundGoalGeometryMemory(memory, entry);
    }
    if ((!entry || entry.readyTick === null) && pressured(plans, requestId))
      return pending('goal-geometry-pinned-capacity');
    if (!entry) {
      const state = jsonValue(request.initialState);
      if (state === undefined) return pending('goal-geometry-cursor-invalid');
      retainReferences(request.references);
      entry = { key: request.key, revision: request.revision, state, work: 0, requestedTick: tick, lastUsedThink: sequence,
        ...(request.references?.length ? { references: [...request.references] } : {}),
        ...(plans.length ? { planIds: [...plans] } : {}), readyTick: null, value: null };
      if (!plans.length && observationJsonBytes(entry) > maxBytes / 2) return pending('goal-geometry-cursor-limit');
      memory.entries = memory.entries.filter(item => item.key !== request.key);
      memory.entries.push(entry);
      boundGoalGeometryMemory(memory, entry);
      if (pressured(plans, requestId)) return pending('goal-geometry-pinned-capacity');
    }
    const record = entry;
    if (record.errorCode) return pending(record.errorCode, record.requestedTick);
    if (record.readyTick !== null) {
      if (factPublicationPending(record.readyTick, record.readyThink, tick, work)) return pending('goal-geometry-publication-pending', record.requestedTick);
      // The validated, detached value is returned as a copy: a domain cannot
      // alter a published fact or another counterfactual's cursor through it.
      return { state: 'met', value: structuredClone(record.value) as never, factIds: [requestId] };
    }
    // The full semantic ID remains the task key. The receipt label is only a
    // diagnostic summary, as for native point-route work.
    work.register({ key: requestId, reportKey: `goal-geometry:${fnv1a(requestId)}`, tier: 'background-field', minimum: 1, run: allowance => {
      if (!memory.entries.includes(record)) return { work: 0, done: true };
      if (pressured(record.planIds ?? [], requestId)) return { work: 0, done: true };
      const slice = Math.min(SLICE, allowance);
      let result: ReturnType<typeof request.advance>;
      try { result = request.advance(structuredClone(record.state) as never, slice); }
      catch (error) {
        // Diagnostic observers must still expose forbidden native calls. A
        // domain failure in production cannot terminate the whole AI think.
        if (navigationAuditActive()) throw error;
        record.errorCode = 'goal-geometry-advance-failed'; record.work += slice;
        return { work: slice, done: true }; // conservatively charge the reserved slice
      }
      if (!Number.isSafeInteger(result.work) || result.work < 0 || result.work > slice) {
        record.errorCode = 'goal-geometry-work-invalid';
        return { work: 0, done: true };
      }
      const state = jsonValue(result.state), value = result.done ? jsonValue(result.value) : null;
      record.work += result.work;
      if (state === undefined || value === undefined) record.errorCode = 'goal-geometry-cursor-invalid';
      else {
        record.state = state;
        if (result.done) {
          record.value = value;
          // A completed result is immutable. Its construction cursor can no
          // longer advance and need not duplicate the published payload.
          record.state = null; record.readyTick = tick;
          if (work.receipt.thinkSequence !== undefined) record.readyThink = work.receipt.thinkSequence; else delete record.readyThink;
        }
        if (!record.planIds?.length && observationJsonBytes(record) > maxBytes / 2) {
          record.errorCode = 'goal-geometry-cursor-limit'; record.state = null; record.value = null;
        }
      }
      boundGoalGeometryMemory(memory, record);
      return { work: result.work, done: result.done || !!record.errorCode };
    } });
    return pending('goal-geometry-pending', record.requestedTick);
  };
  read.reference = (namespace, value) => {
    const valid = jsonValue(value);
    if (valid === undefined) throw Error('Invalid referenced geometry');
    // Store canonical bytes, so equality of a version implies byte equality
    // even when a caller constructed equivalent objects in another key order.
    const bytes = goalValueKey(valid);
    const previous = [...(memory.references ?? []), ...referenceValues.values()]
      .find(item => item.namespace === namespace && goalValueKey(item.value) === bytes);
    if (previous) return previous.id;
    const id = `${namespace}:v${memory.nextReference ?? 1}`;
    memory.nextReference = (memory.nextReference ?? 1) + 1;
    referenceValues.set(id, { id, namespace, value: JSON.parse(bytes) as GoalParameter });
    return id;
  };
  return read;
}

/** Limits count the cached payload {version, entries}, including its envelope.
 * Capacity diagnostics are separate metadata, never part of their own byte calculation.
 * Eviction only discards evidence. Re-reading an evicted request is pending,
 * never known-unreachable. Active callbacks verify their entry still exists. */
export function boundGoalGeometryMemory(memory: GoalGeometryMemory, retain?: Entry) {
  const capacity = memory.capacity;
  const maxBytes = capacity?.maxBytes ?? GOAL_GEOMETRY_BYTES, maxEntries = capacity?.maxEntries ?? GOAL_GEOMETRY_ENTRIES;
  const payload = (entries: readonly Entry[]) => {
    const used = new Set(entries.flatMap(entry => entry.references ?? []));
    const references = memory.references?.filter(item => used.has(item.id));
    return { version: memory.version, entries, ...(references?.length ? { references } : {}),
      ...(memory.nextReference === undefined ? {} : { nextReference: memory.nextReference }) };
  };
  const result = boundCache({ kind: 'geometry', entries: memory.entries, id: entryRequestId,
    lastUsed: entry => entry.lastUsedThink ?? entry.requestedTick,
    plans: entry => entry.planIds ?? [],
    maxEntries, maxBytes, bytes: entries => observationJsonBytes(payload(entries)),
    thinkSequence: capacity?.thinkSequence ?? 0, capacity });
  memory.entries = result.entries;
  if (memory.references) {
    const used = new Set(memory.entries.flatMap(entry => entry.references ?? []));
    memory.references = memory.references.filter(item => used.has(item.id));
    if (!memory.references.length) delete memory.references;
  }
  if (!capacity) return;
  capacity.pinnedBytes = result.pinnedBytes; capacity.pinnedEntries = result.pins.length;
  capacity.peakPinnedBytes = Math.max(capacity.peakPinnedBytes, result.pinnedBytes);
  capacity.peakResidentBytes = Math.max(capacity.peakResidentBytes, result.bytes);
  capacity.overflowCount = result.capacity.overflowCount;
  if (result.capacity.pressure) capacity.pressure = result.capacity.pressure;
  else delete capacity.pressure;
}

/** Remove pins only when their owning goal is no longer part of the current
 * planning request. A changed key/revision separately invalidates its entry. */
export function retainGoalGeometryPlans(memory: GoalGeometryMemory, planIds: readonly string[]) {
  const active = new Set(planIds);
  for (const entry of memory.entries) if (entry.planIds) {
    entry.planIds = entry.planIds.filter(id => active.has(id));
    if (!entry.planIds.length) delete entry.planIds;
  }
  boundGoalGeometryMemory(memory);
}

/** A goal can survive many changed actor poses. Pins belong to its current
 * graph and this think's requests, rather than every version it ever queried.
 * A retained declaration/deferred proof can keep a published entry without
 * querying it again; obsolete versions become ordinary LRU candidates. */
export function retainGoalGeometryRequests(memory: GoalGeometryMemory,
  plans: readonly Readonly<{ planId: string; requestIds: readonly string[] }>[], sequence: number) {
  const active = new Map(plans.map(plan => [plan.planId, new Set(plan.requestIds)]));
  for (const entry of memory.entries) if (entry.planIds?.length) {
    const id = entryRequestId(entry);
    entry.planIds = entry.planIds.filter(plan => active.has(plan)
      && (entry.lastUsedThink === sequence || active.get(plan)!.has(id)));
    if (!entry.planIds.length) delete entry.planIds;
  }
  boundGoalGeometryMemory(memory);
}

/** Reject non-JSON/cyclic/non-finite cursors before serialization can turn
 * unknown values into null or silently discard executable state. */
function jsonValue(input: unknown): GoalParameter | undefined {
  const seen = new Set<object>(); let remaining = 4096;
  const visit = (value: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 32) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || seen.has(value)) return false;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    seen.add(value);
    const valid = (Array.isArray(value) ? value : Object.values(value)).every(item => visit(item, depth + 1));
    seen.delete(value); return valid;
  };
  return visit(input, 0) ? structuredClone(input) as GoalParameter : undefined;
}
