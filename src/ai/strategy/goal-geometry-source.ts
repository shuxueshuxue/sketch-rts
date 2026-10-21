import type { FactWorkQueue } from './fact-work';
import { goalValueKey } from './goal-facts';
import type { GoalGeometryMemory, GoalGeometryReader, GoalPublishedValue } from './goal-grounding-ports';
import type { GoalParameter } from './goal-planner-types';
import { observationJsonBytes } from './observation-json-bytes';
import { navigationAuditActive } from '../../shared/navigation-audit';

export const GOAL_GEOMETRY_ENTRIES = 32;
export const GOAL_GEOMETRY_BYTES = 16 * 1024;
const SLICE = 128;
type Entry = GoalGeometryMemory['entries'][number];

/** A publication cursor, not a second pathfinder or work allowance. Domains
 * supply finite native checks; only this queue may advance their cursors. */
export function createGoalGeometryReader(input: Readonly<{
  tick: number; work: FactWorkQueue; memory: GoalGeometryMemory;
}>): GoalGeometryReader {
  const { tick, work, memory } = input;
  boundGoalGeometryMemory(memory);
  return request => {
    const requestId = `goal-geometry:${goalValueKey([request.key, request.revision])}`;
    const pending = (code: string, requestedTick = tick): GoalPublishedValue<never> => ({
      state: 'pending', requestIds: [requestId],
      reason: { code, factIds: [requestId], values: { requestedTick, tick } },
    });
    let entry = memory.entries.find(item => item.key === request.key && item.revision === request.revision);
    if (!entry) {
      const state = jsonValue(request.initialState);
      if (state === undefined) return pending('goal-geometry-cursor-invalid');
      entry = { key: request.key, revision: request.revision, state, work: 0, requestedTick: tick, readyTick: null, value: null };
      if (observationJsonBytes(entry) > GOAL_GEOMETRY_BYTES / 2) return pending('goal-geometry-cursor-limit');
      memory.entries = memory.entries.filter(item => item.key !== request.key);
      memory.entries.push(entry);
      boundGoalGeometryMemory(memory, entry);
    }
    const record = entry;
    if (record.errorCode) return pending(record.errorCode, record.requestedTick);
    if (record.readyTick !== null) {
      if (record.readyTick >= tick) return pending('goal-geometry-publication-pending', record.requestedTick);
      // The validated, detached value is returned as a copy: a domain cannot
      // alter a published fact or another counterfactual's cursor through it.
      return { state: 'met', value: structuredClone(record.value) as never, factIds: [requestId] };
    }
    work.register({ key: requestId, tier: 'background-field', minimum: 1, run: allowance => {
      if (!memory.entries.includes(record)) return { work: 0, done: true };
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
        if (result.done) { record.value = value; record.readyTick = tick; }
        if (observationJsonBytes(record) > GOAL_GEOMETRY_BYTES / 2) {
          record.errorCode = 'goal-geometry-cursor-limit'; record.state = null; record.value = null;
        }
      }
      boundGoalGeometryMemory(memory, record);
      return { work: result.work, done: result.done || !!record.errorCode };
    } });
    return pending('goal-geometry-pending', record.requestedTick);
  };
}

/** Eviction only discards evidence. Re-reading an evicted request is pending,
 * never known-unreachable. Active callbacks verify their entry still exists. */
export function boundGoalGeometryMemory(memory: GoalGeometryMemory, retain?: Entry) {
  const compare = (a: Entry, b: Entry) => Number(a === retain) - Number(b === retain)
    || Number(a.readyTick === null) - Number(b.readyTick === null)
    || a.requestedTick - b.requestedTick || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  while (memory.entries.length > GOAL_GEOMETRY_ENTRIES || observationJsonBytes(memory) > GOAL_GEOMETRY_BYTES) {
    const oldest = [...memory.entries].sort(compare)[0];
    if (!oldest) break;
    memory.entries.splice(memory.entries.indexOf(oldest), 1);
  }
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
