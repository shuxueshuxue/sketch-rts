import type { ActionIntent, ExecutableMethod, StrategyAllocationMemory } from './allocation-types';
import { goalValueKey } from './goal-facts';
import { readGoalIntent } from './goal-authority-references';

/** Native task identity excludes quotation clocks, travel origins and an
 * observed foundation. Explicit continuous protection windows remain part of
 * their obligation, so a shorter guard cannot silently promise a longer one. */
function taskKey(intent: ActionIntent, unitIds: readonly string[], memory: StrategyAllocationMemory): string | null {
  if (intent.kind !== 'goal-action') return null;
  intent = readGoalIntent(memory, intent);
  const fields: Record<typeof intent.actionKind, readonly string[]> = {
    build: ['buildingKind', 'at', 'worker'], train: ['producer', 'unitKind', 'count'],
    assemble: ['at', 'cohort'], 'position-transport': ['transport', 'at'],
    'transport-force': ['transport', 'cohort', 'at', 'landing'],
    'transport-worker': ['transport', 'cohort', 'at', 'landing'],
    'clear-camp': ['campId', 'cohort'], 'clear-shore': ['at', 'threatIds', 'cohort'],
    defend: ['at', 'protectedSite', 'cohort', 'throughTick'], evacuate: ['shelter', 'cohort'],
    'hold-position': ['target', 'cohort', 'garrisonMineId', 'garrisonAt', 'throughTick'],
    'destroy-target': ['target', 'cohort'], 'engage-units': ['target', 'cohort', 'threatIds'],
    'wait-income': ['minimumGold'],
  };
  const semantic = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(semantic);
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    if (typeof row.entityId === 'string' && 'point' in row) return { entityId: row.entityId };
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, semantic(item)]));
  };
  return goalValueKey([intent.goalId, intent.actionKind, [...unitIds].sort(),
    fields[intent.actionKind].map(key => [key, semantic(intent.parameters[key])]),
    intent.parameters.item, intent.parameters.consumable]);
}

/** Admission retains the active physical task's original command/output and
 * capital lineage. Today's whole-plan price is still the ordinary quotation;
 * this function grants no resource or fact and cannot revive terminal work. */
export function continueGoalMethod(method: ExecutableMethod, memory: StrategyAllocationMemory): ExecutableMethod {
  if (method.kind !== 'goal-plan') return method;
  const previous = memory.methods[method.id];
  if (!previous) return method;
  const aliases = new Map<string, string>(), spends = new Map(method.spends.map(spend => [spend.spendId, spend]));
  const actions = method.actions.map(action => {
    const key = taskKey(action.intent, action.unitIds ?? [], memory);
    if (key === null) return action;
    const matching = previous.actions.filter(prior => {
      const execution = memory.executions[prior.id];
      return execution && !['complete', 'failed', 'abandoned'].includes(execution.status)
        && execution.objectiveId === method.objectiveId && execution.executor === action.executor
        && taskKey(execution.intent, prior.unitIds ?? [], memory) === key;
    });
    if (matching.length !== 1) return action;
    const prior = matching[0]!, execution = memory.executions[prior.id]!;
    aliases.set(action.id, prior.id);
    for (const spendId of prior.spendIds) {
      const spend = previous.spends.find(spend => spend.spendId === spendId);
      if (spend) spends.set(spendId, spend);
    }
    return { ...action, id: prior.id, intent: execution.intent, target: execution.target,
      spendIds: prior.spendIds, demands: prior.demands,
      ...(execution.production ? { production: execution.production } : {}) };
  });
  const used = new Set(actions.flatMap(action => action.spendIds));
  return { ...method, actions: actions.map(action => ({ ...action,
    dependsOn: action.dependsOn.map(id => aliases.get(id) ?? id) })),
  spends: [...spends.values()].filter(spend => used.has(spend.spendId)) };
}
