import type { Unit } from '../../shared/types';
import type { AllocationMethodQuoteInput, ExecutionState, JsonValue, PlannedVoyage } from './allocation-types';
import type { FixedVoyage } from './arrivals';
import type { DecisionFacts } from './decision';
import type { Arrival, Target } from './types';
import { actionTargetArrival } from './unit-arrivals';

const record = (value: JsonValue | undefined): value is ExecutionState =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const terminal = (status: unknown) => status === 'complete' || status === 'failed' || status === 'abandoned';
const unknown = (code: string): Arrival => ({ status: 'unknown', reason: { code, detail: code, evidence: [] } });

/** Physical evidence and this action's own serializable execution progress.
 * A global fastest crossing never changes an already executing manifest. */
export function plannedVoyageContext(input: AllocationMethodQuoteInput, voyage: PlannedVoyage) {
  const execution = input.executions.find(action => action.methodId === input.method.id && action.token.actionId === voyage.actionId);
  const states = execution?.state.voyages, stored = record(states) ? states[voyage.id] : undefined;
  const state = record(stored) ? stored : execution?.state ?? {};
  const status = state.status ?? execution?.status;
  const producer = voyage.ship.kind === 'production' ? input.executions.find(action => action.methodId === input.method.id
    && voyage.ship.kind === 'production' && action.token.actionId === voyage.ship.actionId) : undefined;
  const shipId = voyage.ship.kind === 'existing' ? voyage.ship.unitId
    : typeof producer?.state.createdShipId === 'string' ? producer.state.createdShipId : null;
  const cargo = input.snapshot.units.filter(unit => voyage.unitIds.includes(unit.id) && (unit.deck || unit.cabin));
  const actualPhase = state.phase ?? execution?.phase;
  const phase: FixedVoyage['phase'] = actualPhase === 'returning' || actualPhase === 'returned' || actualPhase === 'return' ? 'return'
    : actualPhase === 'unloading' || actualPhase === 'delivered' ? 'unloading'
    : actualPhase === 'sailing' || actualPhase === 'departing' || cargo.length === voyage.unitIds.length ? 'sailing' : 'loading';
  const committed = !terminal(status) && (execution?.status === 'active' || execution?.status === 'blocked'
    || producer?.status === 'active' || producer?.status === 'blocked' || producer?.status === 'complete' || cargo.length > 0);
  return { execution, producer, state, status, shipId, phase, committed };
}

/** Quotes and materialization share the same fixed-hull callback, supplied by
 * the allocator's current evaluation transaction. Missing production/route
 * facts stay unknown; a previous relative ETA is never revived. */
export function plannedVoyageArrival(input: AllocationMethodQuoteInput, voyage: PlannedVoyage, unit: Unit, target: Target): DecisionFacts<Arrival> {
  const context = plannedVoyageContext(input, voyage);
  if (!context.shipId) return unknown('fixed-voyage-production-pending');
  if (!input.unitIds.includes(context.shipId)) return unknown('fixed-voyage-hull-not-granted');
  if (!input.fixedVoyageArrival) return unknown('fixed-voyage-query-unavailable');
  return input.fixedVoyageArrival(unit, target, { shipId: context.shipId, seaId: voyage.crossing.seaId,
    departure: voyage.departure.point, landing: voyage.destination.point,
    departureGround: voyage.departureGround, landingGround: voyage.landingGround, phase: context.phase });
}

export function allocatedMemberArrival(input: AllocationMethodQuoteInput, unit: Unit, target: Target, targetId: string): DecisionFacts<Arrival> | undefined {
  const voyages = (input.method.voyagePlans ?? []).filter(voyage => voyage.unitIds.includes(unit.id)
    && voyage.landingGround.landId === target.landId && plannedVoyageContext(input, voyage).committed);
  if (voyages.length > 1) return unknown('fixed-voyage-member-has-multiple-active-crossings');
  if (voyages[0]) return plannedVoyageArrival(input, voyages[0], unit, target);
  const fact = input.situation.units.find(fact => fact.id === unit.id);
  return fact && actionTargetArrival(fact, targetId, target, input.situation.assets);
}
