import { UNIT_DEFS, unitMover } from '../../shared/catalog';
import { boardUnit } from '../../shared/decks';
import { createUnit } from '../../shared/map';
import { shipPassengers } from '../../shared/ship-geometry';
import { isTransportKind } from '../../shared/transport-role';
import { walkableGoal } from '../../shared/terrain';
import type { Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AllocationMethodQuoteInput, AllocationPrecondition, ExecutableMethod, PlannedAllocationSpend, PlannedVoyage } from './allocation-types';
import type { CrossingEta, LandId } from './types';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import { actionTargetArrival } from './unit-arrivals';
import { plannedVoyageArrival, plannedVoyageContext } from './planned-voyage-arrival';

type Group = { key: string; source: LandId; crossing: CrossingEta; units: Unit[]; arrivalTicks: number };
type Result = { voyages: PlannedVoyage[]; actions: ExecutableMethod['actions'][number][]; spends: PlannedAllocationSpend[];
  missing: AllocationPrecondition[]; latestArrivalTicks: number | null };
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Specialize only a supplied bundle. Future hulls are packing prototypes,
 * never entities or fulfilled transport capacity. The exact chosen shore pair
 * travels with the proposal into the allocator and native execution. */
export function materializeVoyages(input: AllocationMethodQuoteInput, actionId: string,
  passengerIds: readonly string[] = input.unitIds): Result {
  const { snapshot, situation, method } = input;
  const action = method.actions.find(action => action.id === actionId);
  if (!action) throw new Error(`Missing transport action ${actionId}`);
  const target = action.target, selected = new Set(input.unitIds), passengers = new Set(passengerIds);
  const result: Result = { voyages: [], actions: [], spends: [], missing: [], latestArrivalTicks: 0 };
  const missing = (code: string, ids: readonly string[], kind: AllocationPrecondition['kind'] = 'route',
    status: AllocationPrecondition['status'] = 'unmet') => {
    result.missing.push({ id: `${actionId}/${code}:${ids.join(',')}`, kind, status,
      reason: { code, factIds: [...ids], values: {} }, demand: null, subgoalIds: [] });
  };
  const actors = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const facts = new Map(situation.units.map(unit => [unit.id, unit]));
  const retained = new Set<string>(), keptActions = new Set<string>();
  const keepAction = (id: string) => {
    if (keptActions.has(id)) return;
    keptActions.add(id);
    const prior = method.actions.find(action => action.id === id);
    if (!prior) { missing('fixed-voyage-production-action-missing', [id], 'production'); return; }
    for (const dependency of prior.dependsOn) keepAction(dependency);
    result.actions.push(prior);
    for (const spendId of prior.spendIds) {
      const spend = method.spends.find(spend => spend.spendId === spendId);
      if (spend) result.spends.push(spend);
      else missing('fixed-voyage-production-spend-missing', [id, spendId], 'budget');
    }
  };
  // Once native execution or paid production starts, this is the original
  // voyage, not another global crossing candidate. Its manifest and geometry
  // survive partial unloading, a newly born hull and a serialized fork.
  for (const voyage of method.voyagePlans ?? []) {
    if (voyage.actionId !== actionId || !plannedVoyageContext(input, voyage).committed) continue;
    for (const id of voyage.unitIds) retained.add(id);
    if (voyage.ship.kind === 'production') keepAction(voyage.ship.actionId);
    const invalid = voyage.unitIds.filter(id => !passengers.has(id) || !selected.has(id)
      || !actors.has(id) || actors.get(id)!.owner !== situation.owner || actors.get(id)!.hp <= 0);
    if (invalid.length) { missing('fixed-voyage-manifest-no-longer-granted', invalid, 'handoff'); continue; }
    if (voyage.ship.kind === 'existing' && !selected.has(voyage.ship.unitId)) {
      missing('fixed-voyage-hull-not-granted', [voyage.ship.unitId], 'transport'); continue;
    }
    let current = voyage.crossing, latestCrossingTicks = -1;
    for (const id of voyage.unitIds) {
      const arrival = plannedVoyageArrival(input, voyage, actors.get(id)!, target);
      if (!('ticks' in arrival)) {
        missing(arrival.reason.code, [voyage.id, id], arrival.reason.code.includes('production') ? 'production' : 'route',
          arrival.status === 'unreachable' ? 'unmet' : 'unknown');
        continue;
      }
      result.latestArrivalTicks = Math.max(result.latestArrivalTicks ?? 0, arrival.ticks);
      if (arrival.crossings[0] && arrival.ticks > latestCrossingTicks) {
        latestCrossingTicks = arrival.ticks;
        current = { ...arrival.crossings[0], departure: { ...voyage.departure.point }, landing: { ...voyage.destination.point },
          landingGround: { ...voyage.landingGround.point } };
      }
    }
    result.voyages.push({ ...voyage, crossing: current });
  }
  const groups = new Map<string, Group>();
  const destinations = target.landId;
  for (const id of [...passengers].sort()) {
    if (retained.has(id)) continue;
    const unit = actors.get(id), fact = facts.get(id);
    if (!unit || unit.owner !== situation.owner || unit.hp <= 0 || !selected.has(id)) { missing('transport-member-unavailable', [id]); continue; }
    if (unitMover(unit.kind) !== 'land') continue;
    if (fact?.location.kind === 'land' && fact.location.landId === destinations) continue;
    if (!fact || fact.location.kind !== 'land') { missing('departure-land-unobserved', [id]); continue; }
    // A resource row is interchangeable only when it names this exact point.
    // A defensive post offset from the hall requires its own action ETA row.
    const arrival = actionTargetArrival(fact, actionId, target, situation.assets);
    if (!arrival || !('crossings' in arrival)) { missing('transport-route-unquoted', [id]); continue; }
    if (arrival.crossings.length !== 1) { missing('transport-needs-unplanned-intermediate-crossing', [id]); continue; }
    const crossing = arrival.crossings[0]!;
    const key = `${fact.location.landId}/${crossing.seaId}/${destinations}/${crossing.departure.x},${crossing.departure.y}/${crossing.landing.x},${crossing.landing.y}`;
    // Different published ship choices require independently priced manifests.
    const variant = `${key}/${crossing.requiresNewShip ? 'production' : crossing.shipId}`;
    const exact = groups.get(variant) ?? { key: variant, source: fact.location.landId, crossing, units: [], arrivalTicks: 0 };
    exact.units.push(unit); groups.set(variant, exact);
    exact.arrivalTicks = Math.max(exact.arrivalTicks, arrival.ticks);
    result.latestArrivalTicks = Math.max(result.latestArrivalTicks ?? 0, arrival.ticks);
  }
  const shores = groups.size ? regionIndex(snapshot.map).shoresByLand : undefined;
  for (const group of [...groups.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) {
    const crossing = group.crossing;
    const departure = shores?.get(group.source)?.get(crossing.seaId)?.find(shore => distance(shore.water, crossing.departure) < 1e-6);
    const landing = destinations && shores?.get(destinations)?.get(crossing.seaId)?.find(shore => distance(shore.water, crossing.landing) < 1e-6);
    if (!departure || !landing || crossing.landingGround && distance(landing.ground, crossing.landingGround) > 1e-6) {
      missing('crossing-ground-pair-unverified', group.units.map(unit => unit.id)); continue;
    }
    const produced = input.executions.filter(execution => execution.methodId === method.id && execution.executor === 'strategy.train-transport'
      && typeof execution.state.createdShipId === 'string' && selected.has(execution.state.createdShipId));
    const existing = crossing.shipId && selected.has(crossing.shipId) ? actors.get(crossing.shipId) : undefined;
    if (!crossing.requiresNewShip && (!existing || existing.owner !== situation.owner || !isTransportKind(existing.kind))) {
      missing('quoted-transport-not-in-candidate-bundle', crossing.shipId ? [crossing.shipId] : [], 'transport'); continue;
    }
    const declaredProducer = 'productionBuildingId' in crossing ? crossing.productionBuildingId : undefined;
    if (crossing.requiresNewShip && declaredProducer !== undefined && typeof declaredProducer !== 'string') {
      missing('quoted-shipyard-reference-invalid', group.units.map(unit => unit.id), 'production'); continue;
    }
    const yard = typeof declaredProducer === 'string'
      ? snapshot.buildings.find(building => building.id === declaredProducer && building.owner === situation.owner
        && building.hp > 0 && building.kind === 'shipyard'
        && seaIdAt(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, 'sea')) === crossing.seaId)
      : snapshot.buildings.filter(building => building.owner === situation.owner && building.hp > 0 && building.kind === 'shipyard'
        && landIdAt(snapshot.map, building) === group.source
        && seaIdAt(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, 'sea')) === crossing.seaId)
        .sort((a, b) => distance(a, departure.ground) - distance(b, departure.ground) || byId(a, b))[0];
    if (crossing.requiresNewShip && declaredProducer !== undefined && !yard) {
      missing('quoted-shipyard-unavailable', [String(declaredProducer)], 'production'); continue;
    }
    if (crossing.requiresNewShip && !yard) { missing('build-shipyard-required', group.units.map(unit => unit.id), 'production'); continue; }
    if (yard && !yard.complete && crossing.requiresNewShip) { missing('shipyard-not-yet-complete', [yard.id], 'production'); continue; }
    const hulls: { unit: Unit; ids: string[]; productionId: string | null }[] = [];
    if (existing) {
      const cargo = shipPassengers(snapshot.units, existing);
      if (cargo.some(unit => !group.units.some(member => member.id === unit.id))) {
        missing('transport-carries-other-objective', [existing.id, ...cargo.map(unit => unit.id)], 'handoff'); continue;
      }
      const production = produced.find(execution => execution.state.createdShipId === existing.id);
      hulls.push({ unit: existing, ids: [], productionId: production?.token.actionId ?? null });
    }
    const packed: Unit[] = existing ? shipPassengers(snapshot.units, existing).map(unit => ({ ...unit })) : [];
    const routeId = `${group.source}:${crossing.seaId}:${crossing.departure.x},${crossing.departure.y}:${crossing.landing.x},${crossing.landing.y}`;
    for (const unit of [...group.units].sort((a, b) => b.radius - a.radius || byId(a, b))) {
      let hull = hulls.find(hull => {
        if (unit.deck?.shipId === hull.unit.id) return true;
        const copy = { ...unit, deck: undefined };
        if (!boardUnit(hull.unit, copy, packed)) return false;
        packed.push(copy); return true;
      });
      if (!hull && crossing.requiresNewShip) {
        const ordinal = hulls.length;
        const productionId = `${method.id}/transport:${routeId}:${ordinal}`;
        const prototype = createUnit(`proposed:${productionId}`, situation.owner, 'transport', yard!.x, yard!.y);
        const copy = { ...unit, deck: undefined };
        if (!boardUnit(prototype, copy, packed)) { missing('passenger-cannot-fit-transport', [unit.id], 'transport'); continue; }
        packed.push(copy); hull = { unit: prototype, ids: [], productionId }; hulls.push(hull);
      }
      if (!hull) { missing('candidate-hull-capacity-insufficient', [unit.id], 'transport'); continue; }
      hull.ids.push(unit.id);
    }
    for (const [index, hull] of hulls.entries()) {
      if (!hull.ids.length) continue;
      const ship: PlannedVoyage['ship'] = hull.productionId ? { kind: 'production', actionId: hull.productionId }
        : { kind: 'existing', unitId: hull.unit.id };
      if (hull.productionId) {
        const prior = input.executions.find(execution => execution.token.actionId === hull.productionId);
        const at = prior?.target ?? { entityId: yard!.id, point: { x: yard!.x, y: yard!.y }, seaId: crossing.seaId };
        const spendId = `${hull.productionId}/capital`;
        result.spends.push({ spendId, amountGold: UNIT_DEFS.transport.cost, includedUtilityTermCodes: ['new-transport'], externalReservationIds: [] });
        const earlier = result.actions.filter(action => action.executor === 'strategy.train-transport' && action.target.entityId === at.entityId).at(-1);
        const waitingSlots = result.actions.filter(action => action.executor === 'strategy.train-transport' && action.target.entityId === at.entityId
          && !input.executions.some(execution => execution.token.actionId === action.id && execution.status === 'complete')).length;
        if (crossing.requiresNewShip) result.latestArrivalTicks = Math.max(result.latestArrivalTicks ?? 0,
          group.arrivalTicks + waitingSlots * UNIT_DEFS.transport.trainTime);
        result.actions.push({ id: hull.productionId, executor: 'strategy.train-transport', intent: { kind: 'train-transport' },
          production: prior?.production ?? { producer: { kind: 'existing', buildingId: at.entityId! },
            unitKind: 'transport', request: { kind: 'submit', spendId } },
          target: at, unitIds: [], dependsOn: earlier ? [earlier.id] : [], demands: [{ kind: 'production', buildingId: at.entityId ?? null, unitKind: 'transport', count: 1 },
            { kind: 'gold', amount: UNIT_DEFS.transport.cost }, { kind: 'supply', amount: UNIT_DEFS.transport.supplyUsed }],
          spendIds: [spendId], completionEffects: [] });
      }
      result.voyages.push({ id: `${actionId}/voyage:${routeId}:${index}`, actionId, ship,
        unitIds: hull.ids.sort(), departure: { point: { ...crossing.departure }, seaId: crossing.seaId },
        destination: { ...target, point: { ...crossing.landing }, seaId: crossing.seaId },
        departureGround: { point: { ...departure.ground }, landId: group.source },
        landingGround: { point: { ...landing.ground }, landId: destinations! }, crossing: { ...crossing }, required: true });
    }
  }
  // Semantic spend entries survive re-materialization; a future boat payment is
  // not re-invented as another transport when it becomes a physical candidate.
  result.spends = [...new Map(result.spends.map(spend => [spend.spendId, spend])).values()];
  result.actions = [...new Map(result.actions.map(action => [action.id, action])).values()];
  if (result.missing.length) result.latestArrivalTicks = null;
  return result;
}
