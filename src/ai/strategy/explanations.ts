import type { Evidence } from './types';

type Projection = { key: string; index: number; read: () => unknown };
class ExplanationProjection {
  private entries?: WeakMap<object, Projection[]>;
  private renderedValues?: WeakMap<object, object>;
  private persistentValues?: WeakMap<object, object>;
  constructor(readonly capture: boolean) {}
  get records() { return this.entries ??= new WeakMap(); }
  private get rendered() { return this.renderedValues ??= new WeakMap(); }
  retain<T extends object>(facts: T) {
    this.persistentValues ??= new WeakMap(); this.persistentValues.set(facts, { ...facts });
  }
  project<T>(facts: T): T {
    if (!facts || typeof facts !== 'object') return facts;
    if (!this.capture) return (this.persistentValues?.get(facts) ?? facts) as T;
    const previous = this.rendered.get(facts); if (previous) return previous as T;
    if (Array.isArray(facts)) {
      const result: unknown[] = []; this.rendered.set(facts, result);
      for (let index = 0; index < facts.length; index++) if (index in facts) result[index] = this.project(facts[index]);
      result.length = facts.length; return result as T;
    }
    const result: Record<string, unknown> = {}; this.rendered.set(facts, result);
    const projections = this.records.get(facts), keys = Object.keys(facts);
    for (const projection of projections ?? []) keys.splice(projection.index, 0, projection.key);
    for (const key of keys) {
      const projection = projections?.find(value => value.key === key);
      result[key] = this.project(projection ? projection.read() : (facts as Record<string, unknown>)[key]);
    }
    return result as T;
  }
}

// Synchronous construction scope only. It does not select, schedule, cache or
// publish any fact. Restored in finally, including nested evaluation/errors.
let projection: ExplanationProjection | undefined;
export function decisionProjection<T extends object>(build: () => T, capture = true): { facts: T; explain: (() => T) | undefined } {
  const previous = projection, current = new ExplanationProjection(capture); projection = current;
  try { const facts = build(); return { facts, explain: capture ? () => current.project(facts) : undefined }; }
  finally { projection = previous; }
}

export const capturesExplanations = () => projection?.capture !== false;
const diagnosticUnavailable = (): never => { throw new Error('Explanation requested during a decision-only evaluation'); };

/** Only serialized historical facts need to carry their explanations across a
 * restart. The small lost-site ledger remains byte-identical in either view. */
export function explanationForMemory<T>(facts: T): T { return projection ? projection.project(facts) : facts; }

/** Move pre-existing diagnostic literals to the same side table. Small reasons
 * and constant utility labels use this; large per-unit evidence uses factories
 * so neither its arrays nor text are constructed in the first place. */
export function deferredRecord<T extends object>(facts: T, retainForMemory = false): T {
  if (!projection) return facts;
  if (!projection.capture) {
    if (retainForMemory) projection.retain(facts);
    delete (facts as Record<string, unknown>).explanation;
    delete (facts as Record<string, unknown>).evidence;
    delete (facts as Record<string, unknown>).detail;
    return facts;
  }
  const additions = ['evidence', 'detail', 'explanation'].filter(key => Object.hasOwn(facts, key));
  if (!additions.length) return facts;
  let records = projection.records.get(facts);
  if (!records) projection.records.set(facts, records = []);
  const keys = Object.keys(facts);
  for (const record of records) keys.splice(record.index, 0, record.key);
  for (const key of additions) {
    const read = projectedValueReader(facts, key as keyof T & string);
    records.push({ key, index: keys.indexOf(key), read });
  }
  for (const key of [...additions].sort((a, b) => keys.indexOf(b) - keys.indexOf(a))) delete (facts as Record<string, unknown>)[key];
  records.sort((a, b) => a.index - b.index); return facts;
}
/** A family may retain the input record, so detach diagnostic ownership before
 * moving its literals. Trace mode needs neither a copy nor a side-table row. */
export function copiedDiagnosticRecord<T extends object>(facts: T): T {
  return projection ? deferredRecord(projectedCopy(facts, {})) : facts;
}

/** The value graph owns its numeric facts. Explanation factories capture only
 * facts from this evaluation, never a mutable snapshot or a process cache. A
 * reader that only asks decision questions does not materialize explanations. */
export function deferredProperty<T extends object, K extends string, V>(facts: T, key: K, render: () => V): T & Readonly<Record<K, V>> {
  return projectedProperty(facts, key, lazyValue(render));
}

export function lazyValue<V>(render: () => V): () => V {
  if (!capturesExplanations()) return diagnosticUnavailable;
  let ready = false, value: V;
  return () => {
    if (!ready) { value = render(); ready = true; }
    return value;
  };
}

/** Construct a recipe outside the evaluator's lexical context. Callers pass a
 * module-level formatter and a small owned value, not a closure over a think. */
export function explanationRecipe<Data, Value>(format: (data: Data) => Value, data: Data): () => Value {
  if (!capturesExplanations()) return diagnosticUnavailable;
  return lazyValue(() => format(data));
}
export function valueReader<Value>(value: Value): () => Value { return capturesExplanations() ? () => value : diagnosticUnavailable; }
export function oneEvidenceProjection(read: () => Evidence): () => readonly Evidence[] {
  if (!capturesExplanations()) return diagnosticUnavailable;
  return lazyValue(() => [read()]);
}
export function copiedEvidenceProjection(read: () => readonly Evidence[]): () => readonly Evidence[] {
  if (!capturesExplanations()) return diagnosticUnavailable;
  return lazyValue(() => read().map(item => ({ ...item })));
}

export function projectedProperty<T extends object, K extends string, V>(facts: T, key: K, read: () => V): T & Readonly<Record<K, V>> {
  if (projection?.capture === false) return facts as T & Readonly<Record<K, V>>;
  if (projection) {
    let records = projection.records.get(facts);
    if (!records) projection.records.set(facts, records = []);
    const previous = records.find(value => value.key === key);
    if (previous) previous.read = read;
    else records.push({ key, index: Object.keys(facts).length + records.length, read });
  } else Object.defineProperty(facts, key, { enumerable: true, configurable: true, get: read });
  return facts as T & Readonly<Record<K, V>>;
}

/** Capture the projection now; reading it later never depends on an ambient
 * scope or on the world's then-current snapshot. */
export function projectedValueReader<T extends object, K extends keyof T & string>(facts: T, key: K): () => T[K] {
  if (!capturesExplanations()) return diagnosticUnavailable;
  const registered = projection?.records.get(facts)?.find(value => value.key === key);
  if (registered) return registered.read as () => T[K];
  const descriptor = Object.getOwnPropertyDescriptor(facts, key);
  if (descriptor?.get) return descriptor.get as () => T[K];
  const value = facts[key]; return () => value;
}

export function deferredEvidence<T extends object>(facts: T, render: () => readonly Evidence[]) {
  return deferredProperty(facts, 'evidence', render);
}

/** Replace a projection without spreading the object: object spread would read
 * every accessor and force the old explanation before it was requested. */
export function extendEvidence<T extends { readonly evidence: readonly Evidence[] }>(facts: T,
  render: (base: readonly Evidence[]) => readonly Evidence[]): T {
  const previous = projectedValueReader(facts, 'evidence');
  return deferredEvidence(facts, () => render(previous()));
}

/** Copy facts and their projections without reading a projection. Overrides
 * retain the original JSON property position, just as object spread did. */
export function projectedCopy<T extends object, U extends object>(facts: T, overrides: U): Omit<T, keyof U> & U {
  if (!capturesExplanations()) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(facts)) if (key !== 'evidence' && key !== 'detail' && key !== 'explanation') copy[key] = (facts as Record<string, unknown>)[key];
    for (const key of Object.keys(overrides)) if (key !== 'evidence' && key !== 'detail' && key !== 'explanation') copy[key] = (overrides as Record<string, unknown>)[key];
    return copy as Omit<T, keyof U> & U;
  }
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(facts));
  const records = projection?.records.get(facts);
  if (records) projection!.records.set(copy, records.map(record => ({ ...record })));
  Object.assign(copy, overrides); return copy as Omit<T, keyof U> & U;
}
