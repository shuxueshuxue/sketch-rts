import type { ActionIntent, ExecutableMethod, StrategyAllocationMemory } from './allocation-types';
import type { GoalExecutableIntent } from './goal-execution-types';
import type { DecisionFacts } from './decision';
import type { Objective } from './types';
import type { GoalParameter } from './goal-planner-types';
import { internGoalReference, readGoalReference, retainGoalReferences, type GoalReferenceMemory } from './goal-versioned-references';
import { readGoalGlobalStepKey } from './goal-search-format';

type ReferenceOwner = Pick<StrategyAllocationMemory, 'goalReferences'>;
const record = (value: GoalParameter | undefined): value is Readonly<Record<string, GoalParameter>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const emptyTable = (): GoalReferenceMemory => ({ version: 1, nextVersion: 1, entries: {} });
const isReference = (table: GoalReferenceMemory, value: string) => Object.hasOwn(table.entries, value);

export function readGoalIntent(owner: ReferenceOwner, intent: GoalExecutableIntent): GoalExecutableIntent {
  if (!intent.parametersRef) return intent;
  const table = owner.goalReferences;
  const parameters = table && readGoalReference(table, intent.parametersRef);
  if (!table || !record(parameters)) throw Error(`Missing goal parameter version: ${intent.parametersRef}`);
  const expanded = { ...parameters };
  if (typeof expanded.optionId === 'string') {
    const option = readGoalReference(table, expanded.optionId);
    if (typeof option !== 'string') throw Error(`Missing goal option version: ${expanded.optionId}`);
    expanded.optionId = option;
  }
  const declaration = readGoalReference(table, intent.declarationId);
  return { ...intent, parameters: expanded,
    declarationId: record(declaration) && typeof declaration.priorId === 'string'
      ? declaration.priorId : intent.declarationId };
}

export function readGoalActionReference(owner: ReferenceOwner, id: string) {
  const table = owner.goalReferences, action = table && readGoalReference(table, id);
  if (typeof action === 'string') for (const kind of ['assemble', 'transport-force', 'clear-camp']) {
    const marker = `goal-action:${kind}:`, index = action.indexOf(marker);
    if (index < 0) continue;
    try { const parameters = JSON.parse(action.slice(index + marker.length)) as GoalParameter;
      if (record(parameters)) return { goal: '', kind, parameters }; } catch { /* Not a canonical priorId receipt. */ }
  }
  const definition = table && record(action) && typeof action.definition === 'string' ? readGoalReference(table, action.definition) : undefined;
  const parameters = table && record(definition) && typeof definition.parametersRef === 'string'
    ? readGoalReference(table, definition.parametersRef) : undefined;
  return record(action) && typeof action.goal === 'string' && typeof action.kind === 'string' && record(parameters)
    ? { goal: action.goal, kind: action.kind, parameters } : null;
}

function storeIntent(table: GoalReferenceMemory, intent: GoalExecutableIntent): GoalExecutableIntent {
  const expanded = intent.parametersRef ? readGoalIntent({ goalReferences: table }, intent) : intent;
  const parameters = { ...expanded.parameters };
  if (typeof parameters.optionId === 'string') parameters.optionId = internGoalReference(table, 'option', parameters.optionId);
  const parametersRef = intent.parametersRef ?? internGoalReference(table, 'parameters', parameters);
  // Non-output naval IDs formerly repeated every parameter (including the
  // option's escaped proposal). Their definition is already fully referenced.
  const naval = ['assemble', 'transport-force', 'transport-worker', 'position-transport', 'clear-camp',
    'clear-shore', 'defend', 'evacuate', 'hold-position'].includes(intent.actionKind);
  const stable = expanded.declarationId.startsWith('goal-step:1:');
  if (stable) {
    const step = readGoalGlobalStepKey(expanded.declarationId);
    if (step.goalId !== intent.goalId || step.selector.kind !== intent.actionKind)
      throw Error('Goal intent selector belongs to another objective or action kind');
  }
  // Migrated naval definitions already carry a stable selector. Keep that
  // exact body on re-store instead of allocating a selector-less version.
  const definition = { kind: intent.actionKind, goal: intent.goalId, parametersRef, outputs: [...intent.outputs],
    ...(!naval || stable ? { priorId: expanded.declarationId } : {}) };
  return { ...intent, declarationId: internGoalReference(table, 'declaration', definition), parametersRef, parameters: {} };
}

function storedAction(table: GoalReferenceMemory, action: ExecutableMethod['actions'][number]) {
  if (action.intent.kind !== 'goal-action') return action;
  const intent = storeIntent(table, action.intent);
  if (action.intent.parametersRef && isReference(table, action.id)) return { ...action, intent };
  const id = internGoalReference(table, 'action', { kind: intent.actionKind, goal: intent.goalId, definition: intent.declarationId,
    actors: [...action.unitIds ?? []].sort(), target: action.target } as GoalParameter);
  return { ...action, id, intent };
}
function rewrite<T>(value: T, aliases: ReadonlyMap<string, string>): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return aliases.get(value) ?? value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [aliases.get(key) ?? key, visit(item)]));
    return value;
  };
  return visit(value) as T;
}

/** Version definitions before they are copied into leases, events or command
 * receipts. No actor, payment, physical choice or generation is changed. */
export function storeGoalMethod(memory: StrategyAllocationMemory, method: ExecutableMethod) {
  if (method.kind !== 'goal-plan') return { memory, method };
  const table = structuredClone(memory.goalReferences ?? emptyTable()), aliases = new Map<string, string>();
  const actions = method.actions.map(action => {
    const next = storedAction(table, action); aliases.set(action.id, next.id); return next;
  });
  for (const spend of method.spends) if (!isReference(table, spend.spendId))
    aliases.set(spend.spendId, internGoalReference(table, 'spend', { priorId: spend.spendId }));
  const stored = rewrite({ ...method, actions }, aliases);
  const spends = [...new Map(stored.spends.map(spend => [spend.spendId, spend])).values()];
  return { memory: { ...memory, goalReferences: table, goalIdentityVersion: 1 as const },
    method: { ...stored, spends } };
}

/** One priorId-load conversion rewrites every internal reference together.
 * It retains the original generation, command receipts, payment and outputs. */
export function restoreGoalAuthorityReferences(memory: StrategyAllocationMemory): StrategyAllocationMemory {
  if (memory.goalIdentityVersion === 1) return memory;
  let next = { ...memory, goalReferences: structuredClone(memory.goalReferences ?? emptyTable()) };
  const aliases = new Map<string, string>(), methods = { ...memory.methods }, executions = { ...memory.executions };
  for (const [id, method] of Object.entries(methods)) if (method.kind === 'goal-plan') {
    const packed = storeGoalMethod(next, method); next = { ...packed.memory, goalReferences: packed.memory.goalReferences! };
    methods[id] = packed.method;
    method.actions.forEach((action, index) => aliases.set(action.id, packed.method.actions[index]!.id));
    method.spends.forEach((spend, index) => aliases.set(spend.spendId, packed.method.spends[index]!.spendId));
  }
  for (const [id, execution] of Object.entries(executions)) if (execution.intent.kind === 'goal-action') {
    const unitIds = Object.values(memory.assignments).filter(assignment => assignment.action.actionId === id
      && assignment.action.generation === execution.token.generation).map(assignment => assignment.unitId);
    const packed = storedAction(next.goalReferences, { id, intent: execution.intent, target: execution.target,
      executor: execution.executor, unitIds, spendIds: [], demands: [], dependsOn: execution.dependsOn, completionEffects: execution.completionEffects });
    const actionId = aliases.get(id) ?? packed.id; aliases.set(id, actionId);
    executions[id] = { ...execution, intent: packed.intent, token: { ...execution.token, actionId } };
  }
  // Retained journal tokens can outlive their execution. Intern their old
  // identity once as data without claiming a live actor or resurrecting work.
  for (const event of memory.events) if (event.methodId.startsWith('goal-bundle:') && !aliases.has(event.action.actionId))
    aliases.set(event.action.actionId, internGoalReference(next.goalReferences, 'retired', event.action.actionId));
  // A budget is addressed by its spend, including after its method has left
  // the current graph. Preserve that lookup and the paid receipt together.
  for (const [key, budget] of Object.entries(memory.budgets)) {
    let spendId = aliases.get(budget.spendId);
    if (!spendId && (aliases.has(budget.action.actionId) || budget.spendId.length > 256)) {
      spendId = internGoalReference(next.goalReferences, 'spend', { priorId: budget.spendId });
      aliases.set(budget.spendId, spendId);
    }
    if (spendId) {
      const id = `budget:${spendId}`;
      aliases.set(key, id); aliases.set(budget.id, id); aliases.set(`budget:${budget.spendId}`, id);
    }
  }
  // Older capital/blocked record IDs sometimes embedded their action ID too.
  // Rewrite their keys and every reference atomically, not only live tokens.
  const identityFields = new Set(['id', 'actionId', 'declarationId', 'optionId', 'spendId', 'quoteId', 'commandId',
    'interruptedCommandId', 'parentActionId', 'budgetId']);
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'goalReferences') continue;
      if (identityFields.has(key) && typeof item === 'string' && item.length > 256 && !aliases.has(item))
        aliases.set(item, internGoalReference(next.goalReferences, 'control', item));
      collect(item);
    }
  };
  collect({ methods, executions, budgets: memory.budgets, blocked: memory.blocked, events: memory.events,
    issuedCommands: memory.issuedCommands, issuedOrders: memory.issuedOrders });
  const { goalReferences: _table, ...records } = { ...next, methods, executions, goalIdentityVersion: 1 as const };
  return { ...rewrite(records, aliases), goalReferences: next.goalReferences };
}

export function retainGoalAuthorityReferences(memory: StrategyAllocationMemory): StrategyAllocationMemory {
  if (!memory.goalReferences) return memory;
  const roots = new Set<string>(), { goalReferences: table, ...records } = memory;
  const visit = (value: unknown) => {
    if (typeof value === 'string') { if (isReference(table, value)) roots.add(value); }
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { visit(key); visit(item); }
  };
  visit(records);
  const retained = structuredClone(table); retainGoalReferences(retained, roots);
  return { ...memory, goalReferences: retained };
}


/** Collector discovery may stop at a real foundation. An already admitted
 * native task still needs its original objective to settle payment/output
 * receipts. This retained declaration is not a new candidate or valuation. */
export function storeGoalObjective(memory: StrategyAllocationMemory, objective: DecisionFacts<Objective>) {
  const table = structuredClone(memory.goalReferences ?? emptyTable());
  const ref = internGoalReference(table, 'objective', objective as unknown as GoalParameter);
  return { memory: { ...memory, goalReferences: table }, ref };
}

export function readGoalObjective(memory: StrategyAllocationMemory, objectiveId: string): DecisionFacts<Objective> | undefined {
  const allocation = memory.objectives[objectiveId], ref = allocation?.goalDefinitionRef;
  if (!ref || !memory.goalReferences || ['complete', 'failed', 'abandoned'].includes(allocation.status)) return undefined;
  const value = readGoalReference(memory.goalReferences, ref);
  if (!record(value) || value.id !== objectiveId || value.owner !== memory.owner || typeof value.kind !== 'string')
    throw Error('Invalid admitted goal objective definition');
  return value as unknown as DecisionFacts<Objective>;
}
