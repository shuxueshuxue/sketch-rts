import { bodyMass } from '../../shared/physical-body';
import { shipProfile } from '../../shared/ship-geometry';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import { isTransportKind } from '../../shared/transport-role';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalGroundingReader, GoalPlanningContext, GoalTransportOption } from './goal-planner-types';
import type { GoalEstimate } from './goal-planner-types';
import type { Unit } from '../../shared/types';
import type { Point } from './types';
import { seaIdAt, type RegionIndex } from './regions';
import { chooseGoalCoarseDeparture, chooseGoalCoarseShore, type GoalPublishedBerthReader } from './goal-selected-berths';

/** A proposal from the prepared geographic contacts. These are deliberately
 * optimistic search bounds. A chosen contact may reuse its published native
 * berth; roads and risk still require selected-action refinement before any
 * command authority exists. */
export function createGoalCoarseTransport(context: GoalPlanningContext, regions: RegionIndex,
  resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']>, publishedBerth?: GoalPublishedBerthReader,
  seaTicks?: (ship: Unit, from: Point, to: Point, future: boolean) => GoalEstimate<number>): GoalGroundingReader['transportOptions'] {
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  return (from, to, _capacity, request) => {
    const id = `coarse-transport:${goalValueKey([from, to, request])}`;
    const missing = (code: string) => ({ state: 'pending' as const, requestIds: [id], reason: { code, factIds: [id], values: {} } });
    if (!request || !to.landId) return missing('coarse-transport-cohort-and-land-required');
    const members = resolveCohort(request.cohort); if (members.state !== 'met') return members;
    const loaded = members.candidates.flatMap(member => member.assessment.deck?.shipId ?? member.assessment.cabin?.shipId ?? []);
    const ships = new Set(loaded);
    if (ships.size > 1) return { state: 'unmet', reason: { code: 'coarse-cohort-needs-separate-voyages', factIds: [id], values: {} } };
    const waiting = members.candidates.filter(member => !member.assessment.deck && !member.assessment.cabin);
    const mass = waiting.reduce((sum, member) => sum + bodyMass(member.assessment), 0);
    const candidates: GoalTransportOption[] = [];
    for (const ship of context.snapshot.units) {
      if (ship.owner !== context.owner || ship.hp <= 0 || !isTransportKind(ship.kind) || ships.size && !ships.has(ship.id)) continue;
      const seaId = seaIdAt(context.snapshot.map, ship); if (!seaId || from.seaId && from.seaId !== seaId) continue;
      const end = chooseGoalCoarseShore(regions.shoresByLand.get(to.landId)?.get(seaId) ?? [], to.point, ship, members.candidates, publishedBerth);
      const landing = end && (end.berth ?? { ...end.shore, heading: ship.sailing?.heading ?? 0 });
      const startContact = from.landId && landing ? chooseGoalCoarseDeparture(regions.shoresByLand.get(from.landId)?.get(seaId) ?? [],
        from.point, landing.water, ship, members.candidates, publishedBerth) : undefined;
      const departure = startContact && (startContact.berth ?? startContact.proposal ?? { ...startContact.shore, heading: ship.sailing?.heading ?? 0 });
      if (!landing || waiting.length && !departure) continue;
      const cargo = context.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === ship.id);
      const capacity = Math.max(0, (shipProfile(ship)?.loadCapacity ?? 0) - cargo.reduce((sum, unit) => sum + bodyMass(unit), 0));
      if (capacity < mass) continue;
      const transport = { kind: 'existing' as const, entityId: ship.id }, byTick = (context.planThroughTick ?? context.tick + context.situation.horizonTicks);
      const start = departure?.water ?? { x: ship.x, y: ship.y }, heading = ship.sailing?.heading ?? 0;
      const approach = goalFact({ kind: 'transport-at', transport, at: { seaId, point: start }, tolerance: ship.radius, byTick });
      const crossing = goalFact({ kind: 'route', mover: 'sea', actor: transport, from: { seaId, point: start },
        to: { seaId, point: landing.water }, fromHeading: heading });
      // Read a published basin/wind forecast when available. The compatibility
      // fallback is only a straight-line time bound; combat is priced later.
      const sailing = seaTicks?.(ship, start, landing.water, true) ?? { state: 'met' as const,
        value: Math.floor(distance(start, landing.water) / Math.max(1, ship.speed) * 20), factIds: [id] };
      // Fighters reach the departure post through their separate assembly.
      const walk = waiting.filter(member => member.assessment.kind === 'worker').reduce((longest, member) => Math.max(longest,
        Math.floor(distance(member.assessment, departure!.ground) / Math.max(1, member.assessment.speed) * 20)), 0);
      const common = { id: `${id}:${ship.id}`, seaId, transport, from, to, capacity, loadedUnitIds: cargo.map(unit => unit.id).sort(),
        landing: { water: landing.water, ground: landing.ground, heading: landing.heading }, crossing,
        shoreSafe: goalFact({ kind: 'shore-safe', landId: to.landId, landing: { landId: to.landId, point: landing.ground }, throughTick: byTick }),
        duration: sailing.state === 'met' ? { state: 'met' as const,
          value: sailing.value + walk + (waiting.length ? GANGWAY_SETUP_TICKS : 0) + GANGWAY_SETUP_TICKS,
          factIds: [id, ...sailing.factIds] } : sailing,
        cost: { state: 'met' as const, value: [], factIds: [id] }, successProbability: { state: 'met' as const, value: 1, factIds: [id] },
        preconditions: [goalFact({ kind: 'transport-in', transport, seaId, capacity: mass, byTick })], factIds: [id] };
      candidates.push(waiting.length && departure ? { ...common, origin: 'land', approach,
        departure: { water: departure.water, ground: departure.ground, heading: departure.heading } }
        : { ...common, origin: 'aboard', departure: { water: start, heading } });
    }
    return candidates.length ? { state: 'met', candidates, factIds: [id] } : missing('coarse-existing-hull-or-contact-missing');
  };
}
