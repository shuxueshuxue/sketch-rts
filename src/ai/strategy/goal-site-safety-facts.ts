import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { strikeGap } from '../../shared/combat-geometry';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Unit } from '../../shared/types';
import { effectiveCombatRating } from '../policy/v6/strength';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { targetCoveringTowers } from './allocated-force';
import { goalCampId, goalFact, goalValueKey } from './goal-facts';
import type { GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import type { Arrival, LandId, Point, SeaId, Target } from './types';
import { unitArrival } from './unit-arrivals';

export type GoalSafetyWindowProof = Readonly<{
  observation: GoalFactObservation; supportedThroughTick: number;
  /** A command acknowledgement alone is deliberately not a proof kind. */
  basis: 'verified-execution' | 'projected-world';
}>;
export type GoalSiteSafetyFactPorts = Readonly<{
  /** Prepared connectivity labels only, never an implicit path query. */
  regionAt: (point: Point, mover: 'land' | 'sea') => LandId | SeaId | null | undefined;
  readWindowProof?: (fact: GoalFact) => GoalSafetyWindowProof | null;
  /** Already published facts from the same Arrival service. Needed when a
   * deck/cabin passenger or a ship cannot be represented by a land route. */
  readThreatArrival?: (unit: Unit, target: Target) => Arrival | undefined;
}>;
type Extras = Pick<GoalFactObservation, 'entityIds' | 'threats' | 'derived' | 'availableTick'>;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const identity = (unit: Unit) => [unit.id, unit.owner, unit.kind, unit.hp, unit.maxHp, unit.x, unit.y,
  unit.speed, unit.attackDamage, unit.attackRange, unit.attackCooldown, unit.expiresTick, unit.order, unit.deck, unit.cabin, unit.fittings];

/** Only this domain's safety predicates. No selector, second Situation,
 * evaluator world, route solver or work allowance is constructed here. */
export function readGoalSiteSafetyFact(fact: GoalFact, context: GoalPlanningContext,
  ports: GoalSiteSafetyFactPorts): GoalFactObservation | null {
  const p = fact.predicate, { snapshot, owner, tick, situation } = context;
  if (p.kind !== 'site-safe' && p.kind !== 'shore-safe' && p.kind !== 'assets-safe') return null;
  const answer = (met: boolean, code: string, dependencies: unknown, extra: Extras = {}, forecast = false): GoalFactObservation => ({
    fact, state: met ? 'met' : 'unmet', observedTick: tick, revision: goalValueKey([fact.id, code, dependencies]), evidence: [],
    reason: { code, factIds: [fact.id, ...(extra.derived?.allOf.map(item => item.id) ?? [])], values: {
      throughTick: Number.isFinite(p.throughTick) ? p.throughTick : null, ...(forecast ? { observedForecast: true, assumesObservedMembership: true,
        assumesNoNewOrdersOrThreats: true, supportedThroughTick: tick + situation.horizonTicks } : {}),
    } }, ...extra,
  });
  const pending = (code: string, dependencies: unknown, requests: readonly string[] = [fact.id], extra: Extras = {},
    requestedTick = tick): GoalFactObservation => ({ fact, state: 'pending', observedTick: tick, requestedTick,
    requestId: `safety:${goalValueKey([fact.id, [...new Set(requests)].sort(order)])}`,
    revision: goalValueKey([fact.id, code, dependencies]), evidence: [],
    reason: { code, factIds: [...new Set(requests)].sort(order), values: { throughTick: Number.isFinite(p.throughTick) ? p.throughTick : null } }, ...extra });
  if (snapshot.tick !== tick || situation.tick !== tick || situation.owner !== owner)
    return pending('safety-fact-epoch-pending', [snapshot.tick, situation.tick, situation.owner]);
  if (!Number.isFinite(p.throughTick) || p.throughTick < tick)
    return answer(false, 'safety-window-invalid', p.throughTick);

  if (p.kind === 'assets-safe') {
    const ids = [...new Set(p.unitIds)].sort(order), units = ids.map(id => snapshot.units.find(unit => unit.id === id));
    const targetRegion = p.at.landId ?? p.at.seaId;
    if (!targetRegion || ![p.at.point.x, p.at.point.y].every(Number.isFinite)) return pending('assets-safety-region-pending', p.at);
    if (units.some(unit => !unit || unit.owner !== owner || unit.hp <= 0
      || unit.expiresTick !== undefined && unit.expiresTick <= p.throughTick))
      return answer(false, 'assets-safety-member-unavailable', units.map(unit => unit && identity(unit)), { entityIds: [] });
    const actual = units as Unit[];
    for (const mover of new Set(actual.map(unit => unitMover(unit.kind)))) {
      const region = ports.regionAt(p.at.point, mover), expected = mover === 'land' ? p.at.landId : p.at.seaId;
      if (!region) return pending('assets-safety-target-location-pending', [p.at, mover]);
      if (region !== expected) return answer(false, 'assets-safety-target-region-mismatch', [p.at, mover, region]);
    }
    const regions = actual.map(unit => ports.regionAt(unit, unitMover(unit.kind)));
    if (regions.some(region => region === undefined || region === null))
      return pending('assets-safety-location-pending', [actual.map(identity), regions]);
    if (actual.some((unit, index) => unit.deck || unit.cabin || regions[index] !== (unitMover(unit.kind) === 'land' ? p.at.landId : p.at.seaId)))
      return answer(false, 'assets-not-in-target-pool', [actual.map(identity), regions, p.at], { entityIds: [] });
    const site = goalFact({ kind: 'site-safe', site: p.at, throughTick: p.throughTick }), safety = context.readFact(site);
    const extra: Extras = { entityIds: ids, derived: { allOf: [site] }, ...(safety.threats ? { threats: safety.threats } : {}) };
    if (safety.fact.id !== site.id || safety.observedTick !== tick)
      return pending('assets-safety-site-proof-binding-pending', [safety.fact.id, safety.observedTick], [site.id], extra);
    if (safety.state === 'pending') return pending('assets-safety-site-pending', [actual.map(identity), safety.revision],
      [safety.requestId], extra, safety.requestedTick);
    if (safety.state === 'met' && (safety.availableTick ?? tick) > tick)
      return pending('assets-safety-site-not-active', [safety.revision, safety.availableTick], [site.id], extra);
    return answer(safety.state === 'met', safety.state === 'met' ? 'assets-in-safe-target-pool' : 'assets-target-pool-unsafe',
      [actual.map(identity), regions, safety.revision, safety.state], { ...extra, ...(safety.state === 'met' ? { availableTick: tick } : {}) });
  }

  const at = p.kind === 'site-safe' ? p.site : p.landing;
  if (![at.point.x, at.point.y].every(Number.isFinite)) return pending('safety-site-position-pending', at);
  const land = p.kind === 'shore-safe' ? p.landId : at.landId ?? ports.regionAt(at.point, 'land');
  if (!land?.startsWith('land:') || at.landId && at.landId !== land || ports.regionAt(at.point, 'land') !== land)
    return pending('safety-site-land-pending', [at, land]);
  const target: Target = { ...at, landId: land as LandId };
  const proof = ports.readWindowProof?.(fact);
  if (proof) {
    const observation = proof.observation;
    if (observation.fact.id !== fact.id || observation.observedTick !== tick
      || !['verified-execution', 'projected-world'].includes(proof.basis)
      || !Number.isFinite(proof.supportedThroughTick) || proof.supportedThroughTick < p.throughTick)
      return pending('safety-window-proof-binding-pending', [proof.basis, proof.supportedThroughTick, observation.fact.id, observation.observedTick]);
    if (observation.state === 'met' && (observation.availableTick ?? tick) > tick)
      return pending('safety-window-proof-not-active', [observation.revision, observation.availableTick]);
    return { ...observation, fact };
  }
  if (!Number.isFinite(situation.horizonTicks) || situation.horizonTicks < 0 || p.throughTick > tick + situation.horizonTicks)
    return pending('safety-window-support-pending', [p.throughTick, tick + situation.horizonTicks]);

  const window = p.throughTick - tick, units = new Map<string, Unit>(), campIds = new Set<string>();
  const missing: { id: string; requestedTick: number }[] = [], dependencies: unknown[] = [target, window, snapshot.teams];
  const bound = snapshot.buildings.find(building => building.id === at.entityId) ?? at.point;
  const siteThreat = situation.lands.flatMap(row => row.threats).find(row => row.siteId === at.entityId);
  const eta = (unit: Unit): number | null | undefined => {
    const weapon = combatCapability(snapshot, unit);
    if (!unit.deck && !unit.cabin && strikeGap(unit, bound) <= weapon.range
      && (unitMover(unit.kind) === 'sea' || ports.regionAt(unit, 'land') === land)) return 0;
    const actor = situation.units.find(row => row.id === unit.id);
    const observed = siteThreat?.attackers.find(row => row.unitId === unit.id)?.arrival
      ?? (actor && at.entityId ? unitArrival(actor, at.entityId) : undefined);
    const published = observed ?? ports.readThreatArrival?.(unit, target);
    if (published) {
      dependencies.push([unit.id, published.status, 'ticks' in published ? published.ticks : null,
        'lowerBoundTicks' in published ? published.lowerBoundTicks : null]);
      if (published.status === 'unreachable' || 'lowerBoundTicks' in published
        && published.lowerBoundTicks !== undefined && published.lowerBoundTicks > window) return null;
      if (published.status === 'reachable' && Number.isFinite(published.ticks) && published.ticks >= 0) return published.ticks;
      missing.push({ id: `safety-arrival:${unit.id}:${fact.id}`, requestedTick: tick }); return undefined;
    }
    if (unit.deck || unit.cabin || unitMover(unit.kind) !== 'land') {
      missing.push({ id: `safety-arrival:${unit.id}:${fact.id}`, requestedTick: tick }); return undefined;
    }
    const from = ports.regionAt(unit, 'land');
    if (!from) { missing.push({ id: `safety-region:${unit.id}`, requestedTick: tick }); return undefined; }
    if (from !== land) return null;
    const routeFact = goalFact({ kind: 'route', mover: 'land', from: { landId: from as LandId, point: { x: unit.x, y: unit.y } },
      to: target, actor: { kind: 'existing', entityId: unit.id } }), route = context.readFact(routeFact);
    dependencies.push([route.fact.id, route.revision, route.state, route.route, route.availableTick]);
    if (route.fact.id !== routeFact.id || route.observedTick !== tick || route.state === 'pending'
      || route.state === 'met' && ((route.availableTick ?? tick) > tick || route.route?.ticks === null || route.route?.ticks === undefined
        || !Number.isFinite(route.route.ticks) || route.route.ticks < 0)
      || route.state === 'unmet' && route.reason.code === 'route-actor-not-available') {
      missing.push({ id: route.state === 'pending' ? route.requestId : routeFact.id,
        requestedTick: route.state === 'pending' ? route.requestedTick : tick }); return undefined;
    }
    if (route.state !== 'met') return null;
    // A route to the site's center is sufficient to show a threat arrives.
    // A late center ETA does not prove its weapon could not fire earlier.
    if (route.route!.ticks! > window && weapon.range > 0) {
      missing.push({ id: `safety-strike-arrival:${routeFact.id}`, requestedTick: tick }); return undefined;
    }
    return route.route!.ticks!;
  };
  for (const camp of neutralCampExposure(snapshot).camps) {
    const id = goalCampId(camp.memberIds);
    for (let index = 0; index < camp.members.length; index++) {
      const member = camp.members[index]!, guard = camp.camp.creeps[index]!;
      if (ports.regionAt(guard, 'land') !== land) continue;
      // Native camp-alert and active-pursuit envelopes. No self-acquisition
      // by a hypothetical friendly unit and no native canReach/path call.
      const alert = !member.returning && strikeGap(guard, bound) <= member.alertRadius;
      const returningAlert = member.returning && gap(target.point, member.home) <= member.alertRadius;
      const active = member.active && gap(target.point, member.home) <= member.pursuitRadius
        && gap(target.point, member.responseOrigin) <= member.responseRadius
        && gap(guard, target.point) <= Math.min(member.pursuitRadius, guard.attackRange + guard.speed * window / SIM_TICKS_PER_SECOND);
      if (!alert && !returningAlert && !active) continue;
      dependencies.push([id, identity(guard), member]);
      const arrival = eta(guard);
      if (arrival === undefined || arrival !== null && arrival <= window) campIds.add(id);
    }
  }
  for (const unit of snapshot.units) {
    const capability = combatCapability(snapshot, unit);
    if (unit.hp <= 0 || !strategyIsOpponent(snapshot, owner, unit.owner) || !capability.armed) continue;
    dependencies.push([identity(unit), capability]);
    const inRange = !unit.deck && !unit.cabin && strikeGap(unit, bound) <= capability.range;
    const onLand = ports.regionAt(unit, 'land') === land && unitMover(unit.kind) === 'land';
    const seen = siteThreat?.attackers.some(row => row.unitId === unit.id)
      || !!(at.entityId && situation.units.find(row => row.id === unit.id) && unitArrival(situation.units.find(row => row.id === unit.id)!, at.entityId));
    if (!inRange && !seen && !unit.deck && !unit.cabin && !onLand) continue;
    // A straight maximum-speed lower bound can only reject a route that
    // cannot enter this window; it is never used as a positive ETA.
    if (!inRange && onLand && unit.speed > 0
      && Math.max(0, strikeGap(unit, bound) - capability.range) * SIM_TICKS_PER_SECOND / unit.speed > window) continue;
    const arrival = inRange ? 0 : eta(unit);
    if (arrival === undefined || arrival !== null && arrival <= window
      && (unit.expiresTick === undefined || unit.expiresTick > tick + arrival)) units.set(unit.id, unit);
  }
  const unfinished = snapshot.buildings.filter(building => building.hp > 0 && !building.complete
    && building.attackDamage > 0 && strategyIsOpponent(snapshot, owner, building.owner)
    && strikeGap(building, bound) <= building.attackRange);
  for (const building of unfinished) missing.push({ id: `safety-enemy-construction:${building.id}`, requestedTick: tick });
  const towers = [...targetCoveringTowers(snapshot, owner, target, 'opponent'), ...unfinished];
  dependencies.push(towers.map(tower => [tower.id, tower.owner, tower.hp, tower.complete, tower.attackDamage, tower.attackRange, tower.x, tower.y]));
  const allOf = [...campIds].sort(order).map(campId => goalFact({ kind: 'camp-cleared', campId }));
  for (const hostile of [...units.values(), ...towers]) allOf.push(goalFact({ kind: 'enemy-site-destroyed',
    site: { entityId: hostile.id, point: { x: hostile.x, y: hostile.y }, ...(ports.regionAt(hostile, 'land')?.startsWith('land:')
      ? { landId: ports.regionAt(hostile, 'land') as LandId } : {}) } }));
  const requiredForce = [...units.values()].reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
  if (!Number.isFinite(requiredForce)) return pending('safety-threat-force-pending', dependencies, [fact.id],
    allOf.length ? { derived: { allOf } } : {});
  const extra: Extras = { threats: { unitIds: [...units.keys()].sort(order), campIds: [...campIds].sort(order), requiredForce },
    ...(allOf.length ? { derived: { allOf: [...new Map(allOf.map(row => [row.id, row])).values()].sort((a, b) => order(a.id, b.id)) } } : {}) };
  if (missing.length) return pending(unfinished.length ? 'safety-enemy-construction-pending' : 'safety-threat-route-pending', dependencies, missing.map(row => row.id), extra,
    Math.min(tick, ...missing.map(row => row.requestedTick)));
  return answer(!allOf.length, allOf.length ? 'observed-safety-threats-present' : 'observed-safety-window-clear', dependencies,
    { ...extra, ...(!allOf.length ? { availableTick: tick } : {}) }, true);
}
