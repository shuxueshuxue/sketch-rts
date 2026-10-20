import { UNIT_DEFS, unitRules } from '../../shared/catalog';
import type { AllocationMethodQuoteInput, ExecutionState, JsonValue } from './allocation-types';
import { transportExpectedLoss } from './voyage-risk';
const stateRecord = (value: JsonValue | undefined): value is ExecutionState =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Pure consumption of the framework's single published risk batch. Each
 * action is a parallel transport wave; dependent later waves are conditioned
 * by the method's caller, rather than charging an impossible simultaneous loss. */
export function allocatedVoyageValue(input: AllocationMethodQuoteInput) {
  const actions = new Map<string, { actionId: string; survivalProbability: number; expectedLossGold: number; voyageIds: string[] }>();
  const unknown: { code: string; ids: readonly string[] }[] = [];
  const byId = new Map(input.snapshot.units.map(unit => [unit.id, unit]));
  const hullActions = new Map<string, string>();
  for (const voyage of input.method.voyagePlans ?? []) {
    const execution = input.executions.find(execution => execution.token.actionId === voyage.actionId);
    const states = execution?.state.voyages;
    const state = stateRecord(states) ? states[voyage.id] : undefined;
    if (state && typeof state === 'object' && 'status' in state && state.status === 'complete') continue;
    const shipId = voyage.ship.kind === 'existing' ? voyage.ship.unitId
      : input.executions.find(execution => voyage.ship.kind === 'production' && execution.token.actionId === voyage.ship.actionId)?.state.createdShipId;
    const hullKey = typeof shipId === 'string' ? shipId : voyage.ship.kind === 'production' ? voyage.ship.actionId : voyage.ship.unitId;
    const previous = hullActions.get(hullKey);
    if (previous && previous !== voyage.actionId) {
      // A future return to a second beach and the intervening cargo handoff
      // require a priced leg, not two independent outbound trips from now.
      unknown.push({ code: 'sequential-hull-return-and-cargo-risk-unquoted', ids: [previous, voyage.actionId, hullKey] }); continue;
    }
    hullActions.set(hullKey, voyage.actionId);
    const stages = input.voyageRisks?.get(voyage.id);
    if (!stages) { unknown.push({ code: 'voyage-stage-risk-unpublished', ids: [voyage.id] }); continue; }
    const ship = typeof shipId === 'string' ? byId.get(shipId) : undefined;
    if (typeof shipId === 'string' && (!ship || ship.hp <= 0 || ship.owner !== input.situation.owner)) {
      unknown.push({ code: 'voyage-valued-hull-no-longer-present', ids: [shipId] }); continue;
    }
    // The catalog price scaled by actual remaining HP is the explicit current
    // hull residual proxy. A proposed new native hull starts at full health.
    const residual = ship ? unitRules(input.snapshot, ship).cost * Math.min(1, ship.hp / Math.max(1, ship.maxHp)) : UNIT_DEFS.transport.cost;
    const loss = transportExpectedLoss({ snapshot: input.snapshot, ...(typeof shipId === 'string' ? { shipId } : {}),
      boardingPassengerIds: voyage.unitIds, shipResidualGold: residual, stages });
    if (loss.status !== 'known') { unknown.push({ code: loss.reasonCode, ids: [voyage.id] }); continue; }
    const group = actions.get(voyage.actionId) ?? { actionId: voyage.actionId, survivalProbability: 1, expectedLossGold: 0, voyageIds: [] };
    if (voyage.required) group.survivalProbability *= loss.successProbability;
    group.expectedLossGold += loss.expectedLossGold; group.voyageIds.push(voyage.id); actions.set(voyage.actionId, group);
  }
  return { status: unknown.length ? 'unknown' as const : 'known' as const, actions, unknown };
}
