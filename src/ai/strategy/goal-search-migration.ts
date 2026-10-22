import type { AiPolicyMemory } from '../memory';
import type { StrategyAllocationMemory } from './allocation-types';
import type { GoalPlanningReferences } from './goal-planning-references';
import type { GoalSearchMemory } from './goal-search-format';
import { readGoalGlobalStepKey } from './goal-search-format';
import { goalSearchWire } from './goal-search-wire';
import { readGoalReference } from './goal-versioned-references';
import { retainGoalPlanningReferences } from './goal-planning-references';
import type { GoalPlannerRuntimeMemory } from './goal-planner-input';
import { goalMigrationScopes } from './goal-migration-scopes';

const prior = /^goal-v[1-9][0-9]*$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export type GoalPriorDefinition = Readonly<{ id: string; namespace: string; content: unknown; goalId?: string }>;
/** The provider supplies a stable selector, not an allocated version ID.
 * The complete mapping is prepared while the original table is still alive. */
export type GoalPriorSelector = (definition: GoalPriorDefinition) => string;
export type GoalPublicationMemory = {
  memory: Omit<GoalPlannerRuntimeMemory, 'cache' | 'refinements' | 'requotes' | 'requoteCapacity'>;
  /** Only definitions reached by native data, never the discarded search.
   * This explicit transitional root is removed by source-key migration. */
  references?: GoalPlanningReferences;
};

/** One atomic format boundary. No interning, allocation, native payment,
 * SDK command or search is permitted here. A missing mapping fails before
 * either input table or authority is changed. */
export function migrateGoalSearchMemory(memory: AiPolicyMemory, select: GoalPriorSelector): AiPolicyMemory {
  const table = memory.goalPlanningReferences;
  const authority = memory.strategyAllocation;
  const migrated = authority && migrateGoalAuthoritySelectors(authority, table, select);
  const { goalPlanning: _search, goalPlanningReferences: _definitions, ...rest } = memory;
  let publications = memory.goalPublications;
  if (memory.goalPlanning) {
    const { cache: _cache, refinements: _refinements, requotes: _requotes, requoteCapacity: _capacity, ...native } = memory.goalPlanning;
    const references = table && retainGoalPlanningReferences(table, native);
    publications = { memory: structuredClone(native), ...(references && Object.keys(references.entries).length
      ? { references: { version: 1, nextVersion: references.nextVersion, entries: structuredClone(references.entries) } } : {}) };
  }
  return { ...rest, ...(migrated ? { strategyAllocation: migrated } : {}),
    ...(publications ? { goalPublications: publications } : {}),
    goalSearch: goalSearchWire(memory.goalSearch ?? { version: 1, goals: {} } satisfies GoalSearchMemory) };
}

export function migrateGoalAuthoritySelectors(authority: StrategyAllocationMemory,
  table: GoalPlanningReferences | undefined, select: GoalPriorSelector): StrategyAllocationMemory {
  const { scope, goals } = goalMigrationScopes(authority);
  if (authority.goalReferences && table?.priorDeclarations) {
    const entries = Object.fromEntries(Object.entries(authority.goalReferences.entries).map(([id, entry]) => {
      const priorId = table.priorDeclarations?.[id];
      return [id, priorId && entry.namespace === 'declaration' && record(entry.content)
        ? { ...entry, content: { ...entry.content, priorId } } : entry];
    }));
    authority = { ...authority, goalReferences: { ...authority.goalReferences, entries } };
  }
  const replacements = new Map<string, string>(), decoded = new Map<string, unknown>(), reading = new Set<string>();
  // Decode data references without calling the process-global planning scope
  // and without allocating a replacement goal-vN while looking one up.
  const definition = (id: string): unknown => {
    if (decoded.has(id)) return decoded.get(id);
    const entry = table?.entries[id];
    if (!entry || reading.has(id)) throw Error(`Missing or cyclic prior goal definition: ${id}`);
    reading.add(id);
    const expand = (value: unknown): unknown => {
      if (typeof value === 'string') {
        if (prior.test(value)) return definition(value);
        const action = /^action:(train|wait-income):(goal-v[1-9][0-9]*)(?::([0-9]+))?$/.exec(value);
        if (action) return { kind: action[1], requirement: definition(action[2]!), ...(action[3] ? { count: Number(action[3]) } : {}) };
        // Older domain identities have a single JSON tail. Decode that tail
        // structurally, never by replacing substrings of entity names.
        for (let i = 0; i < value.length; i++) if (value[i] === '{' || value[i] === '[') {
          let body: unknown;
          try { body = JSON.parse(value.slice(i)); } catch { continue; }
          if (JSON.stringify(body) === value.slice(i)) return { prefix: value.slice(0, i), value: expand(body) };
        }
        return value;
      }
      if (Array.isArray(value)) return value.map(expand);
      if (!record(value)) return value;
      const fields = Object.entries(value);
      if (fields.length === 1 && fields[0]![0].endsWith('Ref') && typeof fields[0]![1] === 'string'
        && prior.test(fields[0]![1])) return definition(fields[0]![1]);
      return Object.fromEntries(fields.map(([key, item]) => [key, expand(item)]));
    };
    const content = expand(entry.content);
    if (/goal-v[1-9][0-9]*/.test(JSON.stringify(content))) throw Error(`Unresolved prior goal definition encoding: ${id}`);
    reading.delete(id); decoded.set(id, content); return content;
  };
  const selected = (input: GoalPriorDefinition): string => {
    const value = select(input);
    if (typeof value !== 'string' || !value || prior.test(value) || /goal-v[1-9][0-9]*/.test(value)) throw Error(`Unresolved goal selector: ${input.id}`);
    if (input.namespace === 'action') {
      const key = readGoalGlobalStepKey(value);
      if (input.goalId && key.goalId !== input.goalId) throw Error('Goal selector belongs to another objective');
    }
    return value;
  };
  const replacement = (id: string, goalId?: string) => {
    const key = JSON.stringify([goalId ?? null, id]), existing = replacements.get(key); if (existing !== undefined) return existing;
    const entry = table?.entries[id];
    if (!entry) throw Error(`Missing prior goal definition: ${id}`);
    const value = selected({ id, namespace: entry.namespace, content: structuredClone(definition(id)), ...(goalId ? { goalId } : {}) });
    replacements.set(key, value); return value;
  };
  // These composite formats were written by the goal method/capital bridge.
  // Entity IDs and arbitrary physical strings are never substring-rewritten.
  const aliases = new Map<string, string>();
  Object.keys(authority.objectives).forEach(goal => goals.add(goal));
  for (const action of [...Object.values(authority.methods).flatMap(method => method.actions),
    ...Object.values(authority.executions).map(execution => ({ id: execution.token.actionId, intent: execution.intent }))]) {
    if (action.intent.kind !== 'goal-action') continue;
    const prefix = `goal:${action.intent.goalId}:`, suffix = action.id.startsWith(prefix) ? action.id.slice(prefix.length) : '';
    if (prior.test(suffix)) {
      aliases.set(action.id, `${prefix}${replacement(suffix, action.intent.goalId)}`);
      aliases.set(`goal-capital:${action.id}`, `goal-capital:${aliases.get(action.id)!}`);
    }
  }
  // Authority parameter definitions can be shared. Follow their existing
  // goal-ref edges to establish scope; conflicting rewrites must fail rather
  // than allocate a second version or silently borrow another goal's output.
  const scopes = new Map<string, Set<string>>();
  const discover = (value: unknown, goalId?: string): void => {
    goalId = scope(value, goalId);
    if (typeof value === 'string' && authority.goalReferences?.entries[value] && goalId) {
      const owners = scopes.get(value) ?? new Set<string>();
      if (owners.has(goalId)) return;
      owners.add(goalId); scopes.set(value, owners); discover(authority.goalReferences.entries[value]!.content, goalId);
    } else if (Array.isArray(value)) value.forEach(item => discover(item, goalId));
    else if (record(value)) Object.values(value).forEach(item => discover(item, goalId));
  };
  const { goalReferences: _references, ...roots } = authority;
  discover(roots);
  for (const [id, entry] of Object.entries(authority.goalReferences?.entries ?? {})) {
    const goalId = scope(entry.content); if (goalId) discover(id, goalId);
  }
  const string = (value: string, goalId?: string): string => {
    if (prior.test(value)) return replacement(value, goalId);
    const alias = aliases.get(value); if (alias !== undefined) return alias;
    if (value.startsWith('budget:') && aliases.has(value.slice(7))) return `budget:${aliases.get(value.slice(7))!}`;
    if (value.startsWith('budget:')) return `budget:${string(value.slice(7), goalId)}`;
    for (const goal of goals) for (const prefix of [`goal:${goal}:`, `goal-capital:goal:${goal}:`]) {
      const tail = value.startsWith(prefix) ? value.slice(prefix.length) : '';
      if (prior.test(tail)) return prefix + replacement(tail, goal);
    }
    const action = /^action:(train|wait-income):(goal-v[1-9][0-9]*)(?::([0-9]+))?$/.exec(value);
    if (action) return `action:${action[1]}:${replacement(action[2]!, goalId)}${action[3] ? `:${action[3]}` : ''}`;
    if (/goal-v[1-9][0-9]*/.test(value)) for (let i = 0; i < value.length; i++) if (value[i] === '{' || value[i] === '[') {
      let body: unknown;
      try { body = JSON.parse(value.slice(i)); } catch { continue; }
      if (JSON.stringify(body) === value.slice(i)) return value.slice(0, i) + JSON.stringify(visit(body, goalId));
    }
    if (/goal-v[1-9][0-9]*/.test(value)) throw Error('Unrecognized prior goal identity; retain the source table');
    return value;
  };
  const visit = (value: unknown, goalId?: string): unknown => {
    goalId = scope(value, goalId);
    if (typeof value === 'string') return string(value, goalId);
    if (Array.isArray(value)) return value.map(item => visit(item, goalId));
    if (!record(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [string(key, scope(item, goalId)), visit(item, goalId)]));
  };
  // Construct the entire result before returning it. Keeping the existing
  // goal-ref keys/counter is essential: this is not a fresh authorization.
  const { goalReferences, ...records } = authority;
  const definitions = goalReferences && { ...goalReferences, entries: Object.fromEntries(Object.entries(goalReferences.entries).map(([id, entry]) => {
    const owners = [...scopes.get(id) ?? []];
    const versions = (owners.length ? owners : [undefined]).map(goalId => {
      const next = visit(entry, goalId) as typeof entry;
      if (next.namespace !== 'declaration' || !record(next.content) || typeof next.content.goal !== 'string') return next;
      const body = next.content, owner = body.goal as string;
      if (typeof body.priorId === 'string' && body.priorId.startsWith('goal-step:1:')) {
        if (readGoalGlobalStepKey(body.priorId).goalId !== owner) throw Error('Goal declaration belongs to another objective');
        return next;
      }
      const parameters = typeof body.parametersRef === 'string' ? readGoalReference(goalReferences, body.parametersRef) : {};
      const priorId = selected({ id: typeof body.priorId === 'string' ? body.priorId : id, namespace: 'action', goalId: owner,
        content: { kind: body.kind, parameters: visit(parameters, owner), outputs: body.outputs } });
      return { ...next, content: { ...body, priorId } };
    });
    if (versions.some(value => JSON.stringify(value) !== JSON.stringify(versions[0])))
      throw Error('Ambiguous shared authority output; retain the source table');
    return [id, versions[0]!];
  })) };
  const result = { ...visit(records) as StrategyAllocationMemory, ...(definitions ? { goalReferences: definitions } : {}) } as StrategyAllocationMemory;
  if (result.goalReferences?.nextVersion !== authority.goalReferences?.nextVersion
    || Object.keys(result.goalReferences?.entries ?? {}).join('\n') !== Object.keys(authority.goalReferences?.entries ?? {}).join('\n'))
    throw Error('Goal migration must not allocate authority references');
  return result;
}
