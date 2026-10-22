import type { AiPolicyMemory } from '../memory';
import { readCachePayload, storeGoalCachePayload } from './cache-payload';
import { goalFact } from './goal-facts';
import { goalValueKey } from './goal-facts';
import { clearGoalDeclarationRuntime, collectGoalPlanningReferences, createGoalPlanningReferences, currentGoalPlanningReferences, detachGoalPlanningTrace, encodeGoalPlanningValue, goalPlanningIdentity,
  hydrateGoalPlanningValue, internGoalPlanningReference, sealGoalPlanningValue, withGoalPlanningReferences } from './goal-planning-references';
import type { GoalActionDeclaration, GoalFactPredicate } from './goal-planner-types';
import { retainGoalRefinementChoices, retainGoalSearchEntry } from './goal-search-retention';
const restoredObservations = new WeakMap<object, Map<string, import('./goal-planner-types').GoalFactObservation>>();
export function restoredGoalObservation(fact: import('./goal-planner-types').GoalFact) {
  const table = currentGoalPlanningReferences();
  return table && restoredObservations.get(table)?.get(goalValueKey(fact.predicate));
}

/** Prior JSON identities are decoded only on load. Rewrite complete JSON
 * values, never substrings of physical parameters or truncated hash aliases. */
export function restoreGoalPlanningIdentities<T>(value: T): T {
  const strings = new Map<string, string>();
  const string = (value: string): string => {
    const prior = strings.get(value); if (prior !== undefined) return prior;
    if (value.startsWith('selected-shore:goal-action:')) {
      const restored = 'selected-shore:' + string(value.slice('selected-shore:'.length)); strings.set(value, restored); return restored;
    }
    for (const prefix of ['world:', 'exact-build-site:', 'assembly-post:', 'ground:']) if (value.startsWith(`${prefix}fact:{`)) {
      const restored = prefix + string(value.slice(prefix.length)); strings.set(value, restored); return restored;
    }
    if (value.startsWith('fact:{')) {
      const id = internGoalPlanningReference('fact', encodeGoalPlanningValue(visit(JSON.parse(value.slice(5))))); strings.set(value, id); return id;
    }
    let result = value;
    if (value.startsWith('action:train:fact:')) {
      const end = value.lastIndexOf('}');
      if (end >= 0) result = `action:train:${string(value.slice(13, end + 1))}${value.slice(end + 1)}`;
    } else for (let index = 0; index < value.length; index++) if (value[index] === '{' || value[index] === '[') {
      try {
        const tail = value.slice(index), body = JSON.parse(tail);
        if (JSON.stringify(body) !== tail) continue;
        result = value.slice(0, index) + JSON.stringify(visit(body)); break;
      } catch { /* A physical string need not be a prior JSON identity. */ }
    }
    if (result.startsWith('goal-geometry:[')) {
      const [key, revision] = JSON.parse(result.slice('goal-geometry:'.length));
      result = goalPlanningIdentity('geometry-request', { key, revision });
    } else if (/^(goal-action:|action:(build|train|wait-income|hold-position|defend|engage-units|evacuate):)/.test(result))
      result = goalPlanningIdentity('action', result);
    strings.set(value, result); return result;
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return string(value);
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    if (typeof row.id === 'string' && row.predicate) {
      const fact = goalFact(visit(row.predicate) as GoalFactPredicate); strings.set(row.id, fact.id); return fact;
    }
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [string(key),
      key === 'goalKey' && typeof item === 'string' ? goalPlanningIdentity('goal-key', string(item))
        : key === 'optionId' && typeof item === 'string' ? goalPlanningIdentity('option', string(item)) : visit(item)]));
  };
  return visit(value) as T;
}

function restoreCaches(memory: NonNullable<AiPolicyMemory['goalPlanning']>) {
  // Cache plans and quotation ownership must use the same identity space
  // before reference-root retention compares them. Otherwise every valid old
  // quote appears unreferenced solely because its action IDs were not migrated.
  if (memory.refinements) memory.refinements = restoreGoalPlanningIdentities(memory.refinements);
  const restoredPlans: import('./goal-planner-types').GoalPlan[] = [];
  const restoreDeclaration = (action: GoalActionDeclaration): GoalActionDeclaration => {
    const request = action.refinementFor ?? (() => {
      const effect = action.effects.find(effect => effect.operation === 'establish')?.fact;
      if (!effect) return undefined;
      const economy = ['build', 'train', 'wait-income'].includes(action.kind);
      const land = ['destroy-target', 'engage-units'].includes(action.kind)
        || action.kind === 'hold-position' && !action.executor.parameters.garrisonMineId;
      return { effect, providerId: economy ? 'goal:economy' : land ? 'goal:land-combat' : 'goal:naval-and-defense' };
    })();
    return !action.regeneration && request
    ? { ...action, regeneration: { providerId: request.providerId, effect: request.effect,
      groundingKey: action.id, context: { precision: action.precision ?? 'coarse', reservedGold: 0, campIds: [] },
      // The old payload did not preserve a reconstruction context. Its recipe
      // must expire under a current provider, never borrow old world proof.
      sourceRevision: 'prior-declaration-context-unrecorded', dependencies: [] } } : action;
  };
  const migrateDeclarations = <T>(value: T): T => {
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(visit);
      if (!value || typeof value !== 'object') return value;
      const row = value as Record<string, unknown>;
      if (row.executor && Array.isArray(row.preconditions) && Array.isArray(row.effects) && row.duration && row.cost && row.successProbability)
        return restoreDeclaration(value as GoalActionDeclaration);
      return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, visit(item)]));
    };
    return visit(value) as T;
  };
  const restore = (cache: NonNullable<typeof memory.cache>) => {
    if (cache.referenceEncoding === 'goal-definitions-v1') return cache;
    const { packedEntries: _packed, entries: _entries, ...header } = cache;
    const decoded = restoreGoalPlanningIdentities(readCachePayload(cache));
    const references = currentGoalPlanningReferences()!, observations = restoredObservations.get(references) ?? new Map();
    for (const entry of decoded) for (const row of [...entry.plan.facts.map(node => node.observation), ...entry.continuation?.observed ?? []])
      observations.set(goalValueKey(row.fact.predicate), row);
    restoredObservations.set(references, observations);
    const entries = migrateDeclarations(decoded).map(entry => retainGoalSearchEntry({ ...entry,
      ...(entry.continuation && (entry.continuation.coarse || !cache.declarationRevision || cache.declarationRevision.includes(':coarse:'))
        ? { continuation: { ...entry.continuation, demandDriven: true as const } } : {}) }));
    restoredPlans.push(...entries.map(entry => entry.plan));
    return { ...header, ...storeGoalCachePayload(entries) };
  };
  if (memory.cache) memory.cache = restore(memory.cache);
  for (const entry of memory.requotes ?? []) entry.cache = restore(entry.cache);
  // An empty/truncated old search cache is not evidence that its known quotes
  // were rejected. Let the current search choose first. Multiple re-quote
  // caches also share ownership, so collect their roots together.
  if (memory.refinements && restoredPlans.length) retainGoalRefinementChoices(memory.refinements, restoredPlans);
  for (const entry of memory.refinements?.entries ?? []) if (entry.sourceRevision) {
    // The physical source projection is unchanged; only its world/actor
    // definitions now have persistent identities. Do not invalidate a native
    // price merely because that lossless projection moved into the table.
    try {
      const source = JSON.parse(entry.sourceRevision);
      if (Array.isArray(source) && source[0] === 'action-finish-safety-capital-v1' && typeof source[1] === 'string') {
        const actor = JSON.parse(source[1]);
        if (Array.isArray(actor) && actor.length === 2 && Array.isArray(actor[0]) && Array.isArray(actor[1])) {
          const world = goalPlanningIdentity('quotation-world', goalValueKey(actor[0]));
          const actors = goalPlanningIdentity('quotation-actors', goalValueKey(actor[1]));
          entry.sourceRevision = goalValueKey([source[0], goalPlanningIdentity('quotation-source', goalValueKey([world, actors])), ...source.slice(2)]);
        }
      }
    } catch { /* An opaque/versioned source is retained as-is and validated normally. */ }
  }
}

/** The outer native entry also covers payment ACK before planner assembly.
 * No snapshot, physical result, command or authority generation is changed. */
export function withGoalPlanningMemory<T>(memory: AiPolicyMemory, run: () => T): T {
  const references = memory.goalPlanningReferences ??= createGoalPlanningReferences();
  if (currentGoalPlanningReferences() === references) return run();
  return withGoalPlanningReferences(references, () => {
    if (memory.goalPlanning) {
      if (!references.priorIdentitiesRestored) restoreCaches(memory.goalPlanning);
      memory.goalPlanning = hydrateGoalPlanningValue(references.priorIdentitiesRestored
        ? memory.goalPlanning : restoreGoalPlanningIdentities(memory.goalPlanning));
    }
    // Authority versions may retain a declaration or world fact after its
    // original graph is retired. Convert those references with the same table.
    if (memory.strategyAllocation && !references.priorIdentitiesRestored) {
      const { goalReferences, ...records } = memory.strategyAllocation;
      memory.strategyAllocation = { ...restoreGoalPlanningIdentities(records), ...(goalReferences ? { goalReferences } : {}) };
      // Published authority versions are immutable. Map their original
      // declaration identity on restore without changing the stored version.
      const aliases = references.priorDeclarations ??= {};
      for (const [id, entry] of Object.entries(goalReferences?.entries ?? {})) {
        const value = entry.content;
        if (entry.namespace === 'declaration' && value && typeof value === 'object' && 'priorId' in value
          && typeof value.priorId === 'string') aliases[id] = restoreGoalPlanningIdentities(value.priorId);
      }
    }
    references.priorIdentitiesRestored = true;
    let result: T | undefined;
    try { result = run(); return detachGoalPlanningTrace(result); }
    finally {
      if (memory.goalPlanning) sealGoalPlanningValue(memory.goalPlanning);
      if (references.priorDeclarations) references.priorDeclarations = Object.fromEntries(Object.entries(references.priorDeclarations)
        .filter(([id]) => !!memory.strategyAllocation?.goalReferences?.entries[id]));
      try { collectGoalPlanningReferences(references, [memory.goalPlanning, memory.strategyAllocation, references.priorDeclarations]); }
      finally { clearGoalDeclarationRuntime(references); restoredObservations.delete(references); }
    }
  });
}
