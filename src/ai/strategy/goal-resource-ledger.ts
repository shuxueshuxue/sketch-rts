import type { AllocationReason } from './allocation-types';
import { goalResourceKey } from './goal-facts';
import { goalReplayAncestors, orderGoalReplayEvents } from './goal-replay-order';
import type { GoalActionDeclaration, GoalResource, GoalResourceBalance, GoalResourceEvent, GoalResourceFlow } from './goal-planner-types';

export type GoalScheduledAction = Readonly<{ action: GoalActionDeclaration; startTick: number; finishTick: number;
  dependsOn?: readonly string[] }>;
export type GoalResourceDeficit = Readonly<{ actionId: string; resource: GoalResource; tick: number; required: number; available: number }>;
export type GoalResourceProjection = Readonly<{
  state: 'met' | 'unmet'; timeline: readonly GoalResourceEvent[]; balances: readonly GoalResourceBalance[];
  deficits: readonly GoalResourceDeficit[];
  duplicateCredits: readonly Readonly<{ actionId: string; sourceId: string; declared: number; credited: number }>[];
}> | Readonly<{ state: 'pending'; reason: AllocationReason }>;
type Segment = { fromTick: number; throughTick: number; ratePerTick: number };
const finite = (value: number) => Number.isFinite(value);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const why = (code: string, ids: readonly string[] = []): GoalResourceProjection => ({ state: 'pending', reason: { code, factIds: ids, values: {} } });

/** Only source intervals already proved by the shared income forecast enter
 * here. Equal stream overlaps are credited once; conflicting forecasts do not
 * silently choose whichever version funds the plan. */
function mergeSegments(input: readonly Segment[]): Segment[] | null {
  const points = [...new Set(input.flatMap(segment => [segment.fromTick, segment.throughTick]))].sort((a, b) => a - b);
  const result: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const fromTick = points[i - 1]!, throughTick = points[i]!;
    const covering = input.filter(segment => segment.fromTick <= fromTick && segment.throughTick >= throughTick);
    if (!covering.length) continue;
    const ratePerTick = covering[0]!.ratePerTick;
    if (covering.some(segment => !close(segment.ratePerTick, ratePerTick))) return null;
    result.push({ fromTick, throughTick, ratePerTick });
  }
  return result;
}
const integral = (segments: readonly Segment[]) => segments.reduce((sum, segment) => sum + (segment.throughTick - segment.fromTick) * segment.ratePerTick, 0);

/** Solvency is checked at every event, never just on the final net total.
 * This pure projection does not reserve or create actual money/units. The
 * existing allocator remains the authority for every ready action's grant. */
export function projectGoalResources(input: Readonly<{ epoch: number; initial: readonly GoalResourceBalance[];
  actions: readonly GoalScheduledAction[] }>): GoalResourceProjection {
  const balances = new Map<string, GoalResourceBalance>(), amounts = new Map<string, number>();
  for (const balance of input.initial) {
    const key = goalResourceKey(balance.resource), previous = balances.get(key);
    if (!finite(balance.quantity) || balance.quantity < 0 || balance.asOfTick !== input.epoch
      || previous && !close(previous.quantity, balance.quantity)) return why('goal-initial-resource-conflict', balance.factIds);
    balances.set(key, balance); amounts.set(key, balance.quantity);
  }
  const unique = new Set<string>();
  type Event = { actionId: string; tick: number; flow: GoalResourceFlow; index: number; finish: boolean };
  const events: Event[] = [];
  for (const { action, startTick, finishTick } of input.actions) {
    if (unique.has(action.id) || !finite(startTick) || !finite(finishTick) || startTick < input.epoch || finishTick < startTick)
      return why('goal-action-schedule-invalid', [action.id]);
    unique.add(action.id);
    for (let index = 0; index < action.flows.length; index++) {
      const flow = action.flows[index]!, tick = flow.at === 'start' ? startTick : flow.at === 'finish' ? finishTick : startTick + flow.at.offsetTicks;
      if (!finite(flow.delta) || !finite(tick) || tick < startTick || tick > finishTick) return why('goal-resource-flow-invalid', [action.id]);
      events.push({ actionId: action.id, tick, flow, index, finish: flow.at === 'finish' });
    }
  }
  const ancestors = goalReplayAncestors(input.actions);
  if (!ancestors) return why('goal-action-dependencies-invalid');
  const phase = (event: Event) => event.flow.at === 'start' ? 0 : event.flow.at === 'finish' ? 2 : 1;
  const ordered = orderGoalReplayEvents(events.map(event => ({ id: JSON.stringify([event.actionId, event.index]), tick: event.tick,
    value: event, dependsOn: events.filter(previous => previous.tick <= event.tick && (
      previous.actionId === event.actionId && (previous.tick < event.tick
        || phase(previous) < phase(event) || phase(previous) === phase(event) && previous.index < event.index)
      || previous.actionId !== event.actionId && ancestors.get(event.actionId)!.has(previous.actionId)))
      .map(previous => JSON.stringify([previous.actionId, previous.index])) })),
    (a, b) => Number(b.finish && b.flow.delta > 0) - Number(a.finish && a.flow.delta > 0)
      || (a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : a.index - b.index));
  if (!ordered) return why('goal-resource-event-dependencies-invalid');
  const timeline: GoalResourceEvent[] = [], deficits: GoalResourceDeficit[] = [], duplicateCredits: {
    actionId: string; sourceId: string; declared: number; credited: number }[] = [];
  const oneShot = new Map<string, number>(), income = new Map<string, Segment[]>();
  for (const event of ordered) {
    const { flow, actionId, tick } = event, key = goalResourceKey(flow.resource), before = amounts.get(key) ?? 0;
    let delta = flow.delta;
    if (delta > 0 && flow.resource.kind === 'gold' && !flow.source) return why('goal-positive-gold-source-unbound', [actionId]);
    if (flow.source && delta > 0) {
      const sourceKey = `${key}/${flow.source.kind}/${flow.source.id}`;
      if (flow.source.kind === 'event') {
        const previous = oneShot.get(sourceKey);
        if (previous !== undefined && !close(previous, delta)) return why('goal-reward-source-conflict', [flow.source.id]);
        if (previous !== undefined) delta = 0;
        else oneShot.set(sourceKey, delta);
      } else {
        const segments = flow.source.segments;
        if (segments.some(segment => !finite(segment.fromTick) || !finite(segment.throughTick) || !finite(segment.ratePerTick)
          || segment.fromTick < input.epoch || segment.throughTick > tick || segment.throughTick < segment.fromTick || segment.ratePerTick < 0))
          return why('goal-income-source-invalid', [flow.source.id]);
        const own = mergeSegments(segments), previous = income.get(sourceKey) ?? [];
        if (!own || !close(integral(own), delta)) return why('goal-income-source-amount-mismatch', [flow.source.id]);
        const merged = mergeSegments([...previous, ...own]);
        if (!merged) return why('goal-income-source-conflict', [flow.source.id]);
        delta = integral(merged) - integral(previous); income.set(sourceKey, merged);
      }
      if (!close(delta, flow.delta)) duplicateCredits.push({ actionId, sourceId: flow.source.id, declared: flow.delta, credited: delta });
    }
    const after = before + delta;
    if (!finite(after)) return why('goal-resource-balance-nonfinite', [actionId]);
    if (after < -1e-9) deficits.push({ actionId, resource: flow.resource, tick, required: Math.max(0, -delta), available: Math.max(0, before) });
    amounts.set(key, Math.abs(after) < 1e-9 ? 0 : after);
    if (!balances.has(key)) balances.set(key, { resource: flow.resource, quantity: 0, asOfTick: input.epoch, factIds: flow.factIds });
    timeline.push({ actionId, tick, resource: flow.resource, before, delta, after: amounts.get(key)! });
  }
  return { state: deficits.length ? 'unmet' : 'met', timeline, deficits, duplicateCredits,
    balances: [...balances.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, balance]) => ({ ...balance, quantity: amounts.get(key) ?? 0 })) };
}
