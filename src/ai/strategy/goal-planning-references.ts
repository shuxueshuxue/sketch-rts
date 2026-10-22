import type { GoalActionDeclaration, GoalFact, GoalFactObservation, GoalFactPredicate } from './goal-planner-types';

/** Semantic definitions, rather than a compressed copy of the search graph.
 * The monotonically allocated versions travel with the owning seat's memory. */
export type GoalPlanningReferences = {
  version: 1; nextVersion: number;
  entries: Record<string, { namespace: string; content: unknown }>;
  priorIdentitiesRestored?: true;
  priorDeclarations?: Record<string, string>;
};
export const createGoalPlanningReferences = (): GoalPlanningReferences => ({ version: 1, nextVersion: 1, entries: {} });
const reference = /^goal-v([1-9][0-9]*)$/;
let current: GoalPlanningReferences | undefined;
const standalone = createGoalPlanningReferences();
const indexes = new WeakMap<GoalPlanningReferences, Map<string, string>>();
const semanticOrderKeys = new WeakMap<GoalPlanningReferences, Map<string, string>>();
const stored = new WeakMap<object, Readonly<Record<string, string>>>();
export type GoalDeclarationRecipe = Pick<GoalActionDeclaration, 'id' | 'kind' | 'precision' | 'duration' | 'cost' | 'successProbability' | 'regeneration' | 'refinementFor'>
  & { executor: string };
const resolvers = new WeakMap<GoalPlanningReferences, (recipe: GoalDeclarationRecipe) => GoalActionDeclaration>();
const completeDeclarations = new WeakMap<GoalPlanningReferences, Set<string>>();
export function setGoalDeclarationResolver(resolve: (recipe: GoalDeclarationRecipe) => GoalActionDeclaration) {
  if (current) resolvers.set(current, resolve);
}
export function protectGoalDeclarations(ids: readonly string[]) {
  const memory = table(), live = completeDeclarations.get(memory) ?? new Set<string>();
  ids.forEach(id => live.add(id)); completeDeclarations.set(memory, live);
}
export function clearGoalDeclarationRuntime(memory: GoalPlanningReferences) {
  resolvers.delete(memory); completeDeclarations.delete(memory);
}
const table = () => current ?? standalone;
export const currentGoalPlanningReferences = () => current;
export const goalPlanningReferenceProjection = (value: unknown) => value && typeof value === 'object' ? stored.get(value) : undefined;
/** A grounding selector is not a declaration or a grant. Naval action
 * identities already own these canonical parameters, even if their cached
 * exact quotation has expired. Keep actors/contact identity for comparison. */
export function goalPlanningGroundingParameters(id: string): GoalActionDeclaration['executor']['parameters'] | undefined {
  const entry = table().entries[id];
  if (entry?.namespace !== 'action') return undefined;
  const body = hydrateGoalPlanningValue(entry.content) as { prefix?: unknown; value?: unknown };
  return typeof body.prefix === 'string' && body.prefix.startsWith('goal-action:') && body.value
    && typeof body.value === 'object' && !Array.isArray(body.value) ? body.value as GoalActionDeclaration['executor']['parameters'] : undefined;
}
const canonical = (value: unknown, ancestors = new Set<object>()): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw Error('Goal definitions require finite acyclic JSON');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    throw Error('Goal definitions require plain JSON');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (array && keys.length !== value.length + 1) throw Error('Goal definition arrays must be dense');
  const fields: [string, unknown][] = [];
  ancestors.add(value);
  try {
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)
        throw Error('Goal definitions require plain JSON properties');
      const item = descriptors[key]!.value;
      if (!array && item === undefined) continue; // optional predicate fields normalize away
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw Error('Invalid goal definition array');
      fields.push([key, canonical(item, ancestors)]);
    }
    return array ? fields.map(([, item]) => item) : Object.fromEntries(fields.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  } finally { ancestors.delete(value); }
};

export function withGoalPlanningReferences<T>(memory: GoalPlanningReferences, run: () => T): T {
  if (memory.version !== 1 || !Number.isSafeInteger(memory.nextVersion) || memory.nextVersion < 1)
    throw Error('Invalid goal planning reference memory');
  const previous = current; current = memory;
  try { return run(); } finally { current = previous; }
}
export function internGoalPlanningReference(namespace: string, content: unknown): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(namespace)) throw Error('Invalid goal definition namespace');
  const memory = table(), bytes = JSON.stringify(canonical(content)), key = `${namespace}:${bytes}`;
  let index = indexes.get(memory);
  if (!index) {
    index = new Map();
    for (const [id, entry] of Object.entries(memory.entries)) {
      const match = reference.exec(id);
      if (!match || Number(match[1]) >= memory.nextVersion)
        throw Error('Invalid goal planning reference version');
      index.set(`${entry.namespace}:${JSON.stringify(canonical(entry.content))}`, id);
    }
    indexes.set(memory, index);
  }
  const prior = index.get(key); if (prior) return prior;
  if (!Number.isSafeInteger(memory.nextVersion + 1)) throw Error('Goal planning reference versions exhausted');
  const id = `goal-v${memory.nextVersion++}`;
  memory.entries[id] = { namespace, content: JSON.parse(bytes) }; index.set(key, id); return id;
}
function content(id: string, namespace?: string): unknown {
  const entry = table().entries[id];
  if (!entry || namespace && entry.namespace !== namespace) throw Error(`Missing goal planning definition: ${id}`);
  return entry.content;
}
function project<T extends object>(value: T, ref: Readonly<Record<string, string>>): T {
  stored.set(value, ref);
  Object.defineProperty(value, 'toJSON', { configurable: true, value: () => ref });
  return value;
}
function deferredDeclaration(id: string): GoalActionDeclaration {
  const memory = table(), wire = content(id, 'recipe') as GoalDeclarationRecipe;
  let expanded: GoalActionDeclaration | undefined;
  const read = () => expanded ??= (() => {
    const resolve = resolvers.get(memory);
    if (!resolve) throw Error('A goal declaration recipe requires its native provider scope');
    return resolve(hydrateGoalPlanningValue(wire));
  })();
  const action = { id: wire.id, kind: wire.kind } as unknown as GoalActionDeclaration;
  for (const key of ['precision', 'regeneration', 'preconditions', 'preconditionWindows', 'effects', 'demands', 'flows',
    'refinementFor', 'duration', 'cost', 'successProbability', 'executor', 'outputs', 'reasons'] as const)
    Object.defineProperty(action, key, { configurable: true, enumerable: true, get: () => read()[key] });
  return project(action, { recipeRef: id });
}
export function referenceGoalFact(predicate: GoalFactPredicate, semantic: GoalFactPredicate): GoalFact {
  const id = internGoalPlanningReference('fact', encodeGoalPlanningValue(semantic)),
    body = internGoalPlanningReference('fact', encodeGoalPlanningValue(predicate));
  const projection = { id, ...(id === body ? {} : { predicateRef: body }) };
  const fact = { ...projection, predicate: hydrateGoalPlanningValue(content(body)) as GoalFactPredicate };
  return current ? project(fact, projection) : fact;
}

/** Regional pools intentionally share one semantic fact identity. A cached
 * answer's earlier precise request view must not create a new truth version. */
export function versionGoalObservation(fact: GoalFact, observed: GoalFactObservation): GoalFactObservation {
  const { revision: _nativeRevision, observedTick: _observedTick, ...proof } = observed;
  return { ...observed, fact, revision: goalPlanningIdentity('fact-proof', { ...proof, fact: { id: fact.id } }) };
}

/** Action identity is separate from its changing exact quotation. Parameters
 * are stored once and referenced before IDs enter edges, outputs or leases. */
export function goalPlanningIdentity(namespace: string, identity: unknown): string {
  if (typeof identity === 'string' && table().entries[identity]?.namespace === namespace) return identity;
  if (!current && typeof identity === 'string') return identity;
  if (typeof identity === 'string') for (let index = 0; index < identity.length; index++) if (identity[index] === '{' || identity[index] === '[') {
    try {
      const tail = identity.slice(index), value = JSON.parse(tail);
      if (JSON.stringify(value) === tail) return internGoalPlanningReference(namespace,
        { prefix: identity.slice(0, index), value: encodeGoalPlanningValue(value) });
    } catch { /* This identity has no JSON body. */ }
  }
  return internGoalPlanningReference(namespace, encodeGoalPlanningValue(identity));
}

/** Allocation order cannot depend on which unreferenced version was collected.
 * Expand semantic definitions transiently for deterministic tie comparison. */
export function goalPlanningOrderKey(id: string): string {
  if (!current) return id;
  let keys = semanticOrderKeys.get(current);
  if (!keys) { keys = new Map(); semanticOrderKeys.set(current, keys); }
  const prior = keys.get(id); if (prior !== undefined) return prior;
  const expand = (value: unknown, seen: ReadonlySet<string>): unknown => {
    if (typeof value === 'string') {
      if (table().entries[value]) {
        if (seen.has(value)) return { cycle: table().entries[value]!.namespace };
        return { namespace: table().entries[value]!.namespace,
          value: expand(content(value), new Set([...seen, value])) };
      }
      // Composite path keys stay structured during comparison too. Restoring
      // nested action IDs as JSON-inside-JSON would recreate the old string
      // expansion even though the resident cache uses short references.
      try { const parsed = JSON.parse(value); if (JSON.stringify(parsed) === value) return expand(parsed, seen); } catch { /* A plain identity. */ }
      return value.replace(/goal-v[1-9][0-9]*/g, ref => {
        if (!table().entries[ref]) return ref;
        return JSON.stringify(canonical(expand(ref, seen)));
      });
    }
    if (Array.isArray(value)) return value.map(item => expand(item, seen));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, seen)]));
    return value;
  };
  const decoded = expand(id, new Set()), key = typeof decoded === 'string' ? decoded : JSON.stringify(canonical(decoded));
  // Only immutable version entries are memoized, never arbitrary search paths.
  if (table().entries[id]) keys.set(id, key);
  return key;
}

/** Explicit semantic references only: facts and action declarations. This is
 * neither a text codec nor arbitrary object/DAG compression. */
export function encodeGoalPlanningValue<T>(value: T): T {
  const fields = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const target = value && typeof value === 'object' && !Array.isArray(value) && 'point' in value;
    const namespace = key === 'resource' && value && typeof value === 'object' ? 'resource'
      : key === 'revision' && typeof value === 'string' && row.fact ? 'factRevision'
      : key === 'revision' && typeof value === 'string' && typeof row.key === 'string' ? 'geometryRevision'
      : key === 'context' && row.groundingKey && value && typeof value === 'object' ? 'groundingContext'
      : key === 'refinement' && value && typeof value === 'object' ? 'comparison'
      : key === 'factIds' && Array.isArray(value) && value.length ? 'evidence'
      : ['cohort', 'units'].includes(key) && Array.isArray(value) && value.length && value.every(item => item && typeof item === 'object' && 'kind' in item) ? 'cohort'
      : ['at', 'site', 'target', 'from', 'to', 'loadingPost', 'approach'].includes(key) && target ? 'target' : undefined;
    return [key, namespace ? { [`${namespace}Ref`]: internGoalPlanningReference(namespace, visit(value)) } : visit(value)];
  }));
  const visit = (value: unknown, declarationBody = false): unknown => {
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    const prior = stored.get(value);
    if (typeof row.owner === 'string' && Array.isArray(row.effects) && typeof row.rewardGold === 'number'
      && 'deadlineTick' in row) return { goalRef: internGoalPlanningReference('goal', fields(row)) };
    if (prior?.recipeRef && !completeDeclarations.get(table())?.has(row.id as string)) return prior;
    const action = typeof row.id === 'string' && typeof row.kind === 'string' && row.executor
      && Array.isArray(row.preconditions) && Array.isArray(row.effects) && row.duration && row.cost && row.successProbability;
    if (action && row.regeneration && (row.precision !== 'exact' || !completeDeclarations.get(table())?.has(row.id as string))) {
      const declaration = row as unknown as GoalActionDeclaration;
      const recipe: GoalDeclarationRecipe = { id: declaration.id, kind: declaration.kind, executor: declaration.executor.executor,
        ...(declaration.precision ? { precision: declaration.precision } : {}), regeneration: declaration.regeneration!,
        ...(declaration.refinementFor ? { refinementFor: declaration.refinementFor } : {}),
        duration: declaration.duration.state === 'met' ? { state: 'met', value: declaration.duration.value, factIds: [] } : declaration.duration,
        cost: declaration.cost.state === 'met' ? { state: 'met', value: declaration.cost.value.map(({ code, gold, at }) => ({ code, gold, ...(at === undefined ? {} : { at }), factIds: [] })), factIds: [] } : declaration.cost,
        successProbability: declaration.successProbability.state === 'met'
          ? { state: 'met', value: declaration.successProbability.value, factIds: [] } : declaration.successProbability };
      return { recipeRef: internGoalPlanningReference('recipe', fields(recipe as unknown as Record<string, unknown>)) };
    }
    if (prior && !(action && prior.recipeRef)) return prior;
    if (typeof row.id === 'string' && row.predicate && reference.test(row.id)) {
      const fact = row as unknown as GoalFact;
      const body = internGoalPlanningReference('fact', visit(fact.predicate));
      return { id: fact.id, ...(body === fact.id ? {} : { predicateRef: body }) };
    }
    if (!declarationBody && action) {
      const body = fields(row);
      return { declarationRef: internGoalPlanningReference('declaration', body) };
    }
    return fields(row);
  };
  return visit(value) as T;
}

export function hydrateGoalPlanningValue<T>(value: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const projection = stored.get(value);
    if (projection?.recipeRef) return deferredDeclaration(projection.recipeRef);
    const row = value as Record<string, unknown>;
    if (typeof row.recipeRef === 'string') return deferredDeclaration(row.recipeRef);
    for (const namespace of ['resource', 'evidence', 'cohort', 'target', 'comparison', 'factRevision', 'geometryRevision', 'groundingContext', 'goal']) {
      const ref = row[`${namespace}Ref`];
      if (typeof ref === 'string' && Object.keys(row).length === 1) return visit(content(ref, namespace));
    }
    if (typeof row.observationRef === 'string') return project(visit(content(row.observationRef, 'observation')) as object,
      { observationRef: row.observationRef });
    if (typeof row.declarationRef === 'string') {
      const body = visit(content(row.declarationRef, 'declaration')) as object;
      return project(body, { declarationRef: row.declarationRef });
    }
    if (typeof row.id === 'string' && table().entries[row.id]?.namespace === 'fact'
      && (row.predicate || Object.keys(row).every(key => key === 'id' || key === 'predicateRef'))) {
      const predicate = row.predicate ?? content(typeof row.predicateRef === 'string' ? row.predicateRef : row.id, 'fact');
      const fact = { ...row, predicate: visit(predicate) };
      return project(fact, { id: row.id, ...(typeof row.predicateRef === 'string' ? { predicateRef: row.predicateRef } : {}) });
    }
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, visit(item)]));
  };
  return visit(value) as T;
}

/** Keep the runtime's direct field access, while JSON writes only references.
 * Definitions are allocated before returning, never as a JSON side effect. */
export function sealGoalPlanningValue<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const prior = stored.get(value);
    if (prior?.recipeRef && !completeDeclarations.get(table())?.has((value as GoalActionDeclaration).id)) return;
    const row = value as Record<string, unknown>;
    Object.values(row).forEach(visit);
    if (typeof row.id === 'string' && row.predicate && table().entries[row.id]?.namespace === 'fact') {
      project(value, encodeGoalPlanningValue(value) as unknown as Record<string, string>);
    } else if (typeof row.id === 'string' && row.executor && Array.isArray(row.preconditions) && Array.isArray(row.effects)
      && row.duration && row.cost && row.successProbability) {
      project(value, encodeGoalPlanningValue(value) as unknown as Record<string, string>);
    } else if (typeof row.key === 'string' && typeof row.revision === 'string' && typeof row.requestedTick === 'number'
      && 'readyTick' in row && 'work' in row) {
      project(value, encodeGoalPlanningValue(value) as unknown as Record<string, string>);
    }
  };
  visit(value); return value;
}

export function cloneGoalPlanningValue<T>(value: T): T {
  return hydrateGoalPlanningValue(structuredClone(value));
}

/** Public trace views are detached values. Their discarded alternatives are
 * not roots of the seat's resident definition table. Cache records remain the
 * compact wire format and are rooted by the actual seat cache instead. */
export function detachGoalPlanningTrace<T>(value: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    if (row.referenceEncoding === 'goal-definitions-v1') return value;
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, visit(item)]));
  };
  return visit(value) as T;
}

/** Standalone planner APIs carry their definitions in the cache. Native owner
 * frames store the table exactly once in the seat memory instead. */
export function goalPlanningStandaloneReferences(): GoalPlanningReferences | undefined { return current ? undefined : standalone; }
export function collectGoalPlanningReferences(memory: GoalPlanningReferences, roots: unknown): void {
  // Only the actual wire roots keep definitions. Unencoded physical targets
  // in unrelated observation/authority records must not create phantom roots.
  memory.entries = retainGoalPlanningReferences(memory, JSON.parse(JSON.stringify(roots))).entries;
  indexes.delete(memory);
  semanticOrderKeys.delete(memory);
}

export function retainGoalPlanningReferences(memory: GoalPlanningReferences, roots: unknown): GoalPlanningReferences {
  const pending: string[] = [], live = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      // A definition may contain a structured identity string. These are roots
      // too; only actual, monotonically allocated table identities are kept.
      for (const match of value.matchAll(/goal-v[1-9][0-9]*/g)) if (memory.entries[match[0]]) pending.push(match[0]);
    } else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { scan(key); scan(item); }
  };
  scan(roots);
  while (pending.length) {
    const id = pending.pop()!; if (live.has(id)) continue;
    live.add(id); scan(memory.entries[id]!.content);
  }
  return { ...memory, entries: Object.fromEntries(Object.entries(memory.entries).filter(([id]) => live.has(id))) };
}

/** Moving a definition into the shared seat table cannot evade the cache's
 * existing quota. Charge every definition reachable from this wire root once.
 * Standalone payloads already carry their own table. */
export function goalPlanningResidentBytes(value: unknown): number {
  const json = JSON.stringify(value), wire = JSON.parse(json);
  const references = current && retainGoalPlanningReferences(current, wire);
  return new TextEncoder().encode(references ? JSON.stringify({ value: wire, definitions: {
    version: references.version, nextVersion: references.nextVersion, entries: references.entries,
  } }) : json).byteLength;
}
