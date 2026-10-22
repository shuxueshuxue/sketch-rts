import { goalGroundingKey, goalSemanticPlan, readGoalGlobalStepKey, isGoalSearchActionKind, type GoalIncumbent, type GoalIncumbentStep, type GoalSearchMemory } from './goal-search-format';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value;
function fields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error('Invalid goal search wire fields');
}
function list(value: unknown): asserts value is unknown[] { if (!Array.isArray(value)) throw Error('Invalid goal search wire list'); }
function dependencies(value: unknown) {
  list(value);
  for (const row of value) {
    fields(row, ['kind', 'key', 'revision']);
    if (!['fact', 'candidates'].includes(String(row.kind)) || !text(row.key) || !text(row.revision))
      throw Error('Invalid goal search dependency');
  }
}
function steps(value: unknown): asserts value is GoalIncumbentStep[] {
  list(value);
  for (const row of value) {
    fields(row, ['id', 'selector', 'bindings', 'dependsOn', 'startOffsetTicks', 'finishOffsetTicks', 'quote']);
    fields(row.selector, ['provider', 'kind', 'grounding']);
    if (!text(row.id) || !text(row.selector.provider) || !isGoalSearchActionKind(row.selector.kind)) throw Error('Invalid goal search selector');
    goalGroundingKey(row.selector.grounding as never);
    if (!finite(row.startOffsetTicks) || !finite(row.finishOffsetTicks) || row.finishOffsetTicks < row.startOffsetTicks)
      throw Error('Invalid goal search schedule');
    list(row.dependsOn);
    if (row.dependsOn.some(id => !text(id)) || !object(row.bindings)) throw Error('Invalid goal search bindings');
    for (const binding of Object.values(row.bindings)) {
      if (!object(binding)) throw Error('Invalid goal search binding');
      if (binding.kind === 'step-output') {
        fields(binding, ['kind', 'step', 'output']);
        if (!text(binding.step) || !text(binding.output)) throw Error('Invalid local goal output');
      } else if (binding.kind === 'existing') {
        fields(binding, ['kind', 'entityId']); if (!text(binding.entityId)) throw Error('Invalid existing goal binding');
      } else if (binding.kind === 'output') {
        fields(binding, ['kind', 'actionId', 'output']);
        if (!text(binding.actionId) || !text(binding.output)) throw Error('Invalid global goal output');
        readGoalGlobalStepKey(binding.actionId);
      } else if (binding.kind === 'binding') {
        fields(binding, ['kind', 'name']); if (!text(binding.name)) throw Error('Invalid goal variable');
      } else if (binding.kind === 'pool-member') {
        fields(binding, ['kind', 'unitKind', 'at', 'slot', 'routeProfile']);
        if (!text(binding.unitKind) || !text(binding.slot) || !object(binding.at)) throw Error('Invalid goal pool selector');
      } else throw Error('Unknown goal search binding');
    }
    fields(row.quote, ['basis', 'durationTicks', 'costGold', 'successProbability', 'dependencies']);
    if (!['published', 'forecast'].includes(String(row.quote.basis)) || !finite(row.quote.durationTicks) || row.quote.durationTicks < 0
      || !finite(row.quote.costGold) || !finite(row.quote.successProbability) || row.quote.successProbability < 0 || row.quote.successProbability > 1)
      throw Error('Invalid goal search quote');
    dependencies(row.quote.dependencies);
  }
}
function incumbent(value: unknown, goalId: string): asserts value is GoalIncumbent {
  fields(value, ['goalId', 'scheduledAtTick', 'steps', 'ready', 'condition']);
  if (value.goalId !== goalId || !finite(value.scheduledAtTick)) throw Error('Invalid goal incumbent owner or epoch');
  steps(value.steps); list(value.ready);
  if (value.ready.some(id => !text(id))) throw Error('Invalid goal ready frontier');
  fields(value.condition, ['state', 'step', 'reason']);
  if (value.condition.state !== 'valid' && !(value.condition.state === 'invalid' && text(value.condition.step) && text(value.condition.reason)))
    throw Error('Invalid goal incumbent condition');
  goalSemanticPlan(value as GoalIncumbent);
}

/** Validate actual resident JSON, including descriptors. toJSON/getters must
 * not hide full declarations, nonfinite quotes or a second search graph. */
export function goalSearchWire(input: unknown): GoalSearchMemory {
  const seen = new Set<object>();
  const json = (value: unknown): void => {
    if (typeof value === 'string' && /^goal-v[1-9][0-9]*$/.test(value)) throw Error('Goal search wire cannot depend on a prior planner table');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return;
    if (!value || typeof value !== 'object' || seen.has(value)) throw Error('Goal search memory must be finite acyclic JSON');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw Error('Goal search memory must be plain JSON');
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (array && keys.length !== value.length + 1) throw Error('Goal search arrays must be dense');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw Error('Goal search memory needs JSON keys');
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) throw Error('Goal search memory must not use hidden declarations');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw Error('Invalid goal search array');
      json(descriptor.value);
    }
    seen.delete(value);
  };
  json(input); fields(input, ['version', 'goals']);
  if (input.version !== 1 || !object(input.goals)) throw Error('Invalid goal search memory version');
  for (const [id, row] of Object.entries(input.goals)) {
    fields(row, ['incumbent', 'cursor']);
    if (row.incumbent) incumbent(row.incumbent, id);
    if (row.cursor) {
      const cursor = row.cursor;
      fields(cursor, ['scheduledAtTick', 'stack', 'prefix', 'challenger', 'dependencies', 'exhausted']);
      if (!finite(cursor.scheduledAtTick) || typeof cursor.exhausted !== 'boolean') throw Error('Invalid goal cursor epoch');
      list(cursor.stack); steps(cursor.prefix); dependencies(cursor.dependencies);
      for (const frame of cursor.stack) {
        fields(frame, ['requirement', 'nextAlternative']); goalGroundingKey(frame.requirement as never);
        if (!Number.isSafeInteger(frame.nextAlternative) || (frame.nextAlternative as number) < 0) throw Error('Invalid goal cursor position');
      }
      if (cursor.challenger) incumbent(cursor.challenger, id);
    }
  }
  return JSON.parse(JSON.stringify(input)) as GoalSearchMemory;
}
