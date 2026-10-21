import type { AllocationReason, PlannedAllocationSpend } from './allocation-types';
import { goalValueKey } from './goal-facts';
import type { GoalActionNode, GoalEventTime, GoalPlan, GoalResourceFlow } from './goal-planner-types';

export type GoalPlanCapitalSpend = PlannedAllocationSpend & Readonly<{
  expectedPaymentTick: number;
  /** Original selected-node cash events, not utility losses or income netting.
   * Several descriptions of the same asset remain provenance, not extra cash. */
  paymentSchedule: readonly Readonly<{ actionId: string; at: GoalEventTime; tick: number;
    amountGold: number; factIds: readonly string[] }>[];
}>;
export type GoalPlanCapital = Readonly<{
  spends: readonly GoalPlanCapitalSpend[];
  byAction: ReadonlyMap<string, string>;
  pending: readonly Readonly<{ actionId: string; reason: AllocationReason }>[];
}>;

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function paymentTick(node: GoalActionNode, at: GoalEventTime): number | null {
  const start = node.startTick, finish = node.finishTick;
  if (start === null || finish === null || !Number.isFinite(start) || !Number.isFinite(finish)
    || start < 0 || finish < start) return null;
  const tick = at === 'start' ? start : at === 'finish' ? finish : start + at.offsetTicks;
  return Number.isFinite(tick) && tick >= start && tick <= finish ? tick : null;
}

/** Identity is the purchased world asset. A hall's logical mine survives a
 * refined build point/builder/route; other buildings retain their exact site.
 * An output action ID is a quoted description and never an asset identity. */
function buildingAsset(node: GoalActionNode, owner: string): Readonly<{ id: string; external: readonly string[] }> | null {
  if (node.declaration.kind !== 'build') return null;
  const established = node.declaration.effects.filter(effect => effect.operation === 'establish').map(effect => effect.fact.predicate);
  const buildings = established.filter(effect => effect.kind === 'building-complete');
  const kinds = [...new Set(buildings.map(effect => effect.buildingKind))];
  const kind = kinds.length === 1 ? kinds[0]! : null;
  if (!kind || node.declaration.executor.parameters.buildingKind !== kind) return null;
  const mines = [...new Set(established.filter(effect => effect.kind === 'hall-complete').map(effect => effect.mineId))].sort(order);
  if (kind === 'townHall' && mines.length === 1) return {
    id: `goal-capital:${goalValueKey({ kind: 'hall', owner, mineId: mines[0] })}`,
    external: ['naval:islandHall'],
  };
  // More than one logical hall asset cannot be silently collapsed to one.
  if (mines.length) return null;
  const sites = [...new Set(buildings.map(effect => goalValueKey({ x: effect.at.point.x, y: effect.at.point.y })))];
  if (sites.length !== 1) return null;
  const at = buildings[0]!.at;
  if (!Number.isFinite(at.point.x) || !Number.isFinite(at.point.y)) return null;
  return { id: `goal-capital:${goalValueKey({ kind: 'building', owner, buildingKind: kind, point: at.point })}`,
    external: [] };
}

/** Register all remaining selected cash purchases, including future coarse
 * atoms. The allocator funds them from actual cash; this function grants and
 * reserves nothing. Missing schedule/asset proof is an explicit pending row.
 * Current fungible training declarations have no independent job/output slot;
 * they must not be merged merely because producer/kind/count happen to match. */
export function goalPlanCapital(plan: GoalPlan): GoalPlanCapital {
  const registry = new Map<string, GoalPlanCapitalSpend>(), byAction = new Map<string, string>();
  const pending: { actionId: string; reason: AllocationReason }[] = [];
  const defer = (node: GoalActionNode, code: string, flows: readonly GoalResourceFlow[]) => pending.push({
    actionId: node.id, reason: { code, factIds: [...new Set(flows.flatMap(flow => flow.factIds))].sort(order), values: {} },
  });
  for (const node of [...plan.actions].sort((a, b) => order(a.id, b.id))) {
    if (node.state === 'world-effects-met') continue;
    const cash = node.declaration.flows.filter(flow => flow.resource.kind === 'gold');
    if (cash.some(flow => !Number.isFinite(flow.delta))) { defer(node, 'goal-capital-flow-nonfinite', cash); continue; }
    const outgoing = cash.filter(flow => flow.delta < 0);
    if (!outgoing.length) continue;
    const schedule: GoalPlanCapitalSpend['paymentSchedule'][number][] = [];
    for (const flow of outgoing) {
      const tick = paymentTick(node, flow.at);
      if (tick === null) break;
      schedule.push({ actionId: node.id, at: typeof flow.at === 'string' ? flow.at : { ...flow.at }, tick,
        amountGold: -flow.delta, factIds: [...flow.factIds] });
    }
    const amountGold = outgoing.reduce((sum, flow) => sum - flow.delta, 0);
    if (schedule.length !== outgoing.length || !Number.isFinite(amountGold)) {
      defer(node, 'goal-capital-payment-schedule-pending', outgoing); continue;
    }
    // Do not manufacture a stable slot from an encoded action name, a quote
    // deadline or an unobserved future unit. The center retains this pending.
    if (node.declaration.kind === 'train') { defer(node, 'goal-capital-training-batch-identity-required', outgoing); continue; }
    const asset = buildingAsset(node, plan.goal.owner);
    if (!asset) { defer(node, 'goal-capital-world-asset-identity-pending', outgoing); continue; }
    const expectedPaymentTick = schedule.reduce((first, payment) => Math.min(first, payment.tick), Infinity);
    const old = registry.get(asset.id);
    registry.set(asset.id, { spendId: asset.id, amountGold: Math.max(old?.amountGold ?? 0, amountGold),
      expectedPaymentTick: Math.min(old?.expectedPaymentTick ?? Infinity, expectedPaymentTick),
      includedUtilityTermCodes: ['remaining-plan-actions'], externalReservationIds: asset.external,
      paymentSchedule: [...(old?.paymentSchedule ?? []), ...schedule].sort((a, b) => a.tick - b.tick || order(a.actionId, b.actionId)),
    });
    byAction.set(node.id, asset.id);
  }
  return { spends: [...registry.values()].sort((a, b) => order(a.spendId, b.spendId)), byAction, pending };
}
