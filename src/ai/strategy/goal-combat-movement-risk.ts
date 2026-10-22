import { abilityCooldown } from '../../shared/ability-cooldowns';
import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { combatCapability, combatWeapons } from '../../shared/combat-capabilities';
import { strikeReach } from '../../shared/combat-geometry';
import { itemsFor } from '../../shared/equipment';
import { FLAME_CLOAK, LIGHTNING_ROD, STORM_STAFF } from '../../shared/item-rules';
import { pointSegmentDistanceSquared, segmentDistanceSquared } from '../../shared/navigation-math';
import { shipProfile } from '../../shared/ship-geometry';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { unitAbilities } from '../../shared/unit-abilities';
import type { GameSnapshot, Unit } from '../../shared/types';
import { castThreatReach, mountedThreatReach } from '../policy/threat-reach';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import type { DecisionFacts } from './decision';
import { goalCampId, goalValueKey, resolveGoalCamp } from './goal-facts';
import type { GoalCombatMovementRequest } from './goal-naval-combat-grounding';
import type { GoalMovementRisk } from './goal-naval-assessment';
import type { GoalEstimate } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import type { Point, Situation } from './types';

export type GoalPublishedMovementRisk = Readonly<{
  epoch: number; requestId: string; risk: GoalEstimate<GoalMovementRisk>;
}>;
/** A runtime binding key, not a decision-memory payload or a new query ID. */
export function goalCombatMovementRiskId(request: GoalCombatMovementRequest): string {
  return goalValueKey([request.effect.id, request.from, request.target, request.throughTick, request.arrivalTicks, request.campContact,
    [...new Set(request.plannedCampIds ?? [])].sort(),
    request.cohort.map(member => [member.reference, member.assessment.id, member.assessment.kind, member.assessment.owner,
      member.assessment.x, member.assessment.y, member.assessment.hp, member.assessment.maxHp, member.assessment.radius,
      member.assessment.speed, member.assessment.attackDamage, member.assessment.attackRange, member.assessment.attackCooldown,
      member.assessment.deck, member.assessment.cabin]),
    request.routes.map(row => [row.fact.id, row.revision, row.state, row.route])]);
}
const unique = (ids: readonly string[]) => [...new Set(ids)].sort();
const squared = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function intersects(road: readonly Point[], point: Point, radius: number) {
  return road.length === 1 ? squared(road[0]!, point) <= radius * radius
    : road.slice(1).some((to, index) => pointSegmentDistanceSquared(point, road[index]!, to) <= radius * radius);
}
function corridor(road: readonly Point[], from: Point, to: Point, radius: number) {
  return road.length === 1 ? pointSegmentDistanceSquared(road[0]!, from, to) <= radius * radius
    : road.slice(1).some((end, index) => segmentDistanceSquared(road[index]!, end, from, to) <= radius * radius);
}
const finite = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
const bodyRadius = (unit: Unit) => {
  const hull = shipProfile(unit)?.hull;
  return Math.max(unit.radius, hull ? Math.max(0, ...hull.map(point => Math.hypot(point.x, point.y))) : 0);
};

/** Only a no-exposure proof or an explicitly bound existing model result is
 * returned as a number. This function never samples risk, finds a route,
 * creates a Situation, spends work, or infers a default probability.
 * The proof covers observed threats during this published march window;
 * future unobserved production/orders are not asserted to be known. */
export function assessGoalCombatMovementRisk(input: Readonly<{
  snapshot: GameSnapshot; situation: Pick<DecisionFacts<Situation>, 'tick' | 'owner' | 'horizonTicks'>; request: GoalCombatMovementRequest;
  publishedRisk?: GoalPublishedMovementRisk;
}>): GoalEstimate<GoalMovementRisk> {
  const { snapshot, situation, request } = input;
  if (request.campContact) return campContactRisk(input);
  const ids = unique([request.effect.id, ...request.routes.map(row => row.fact.id)]);
  const pending = (code: string, facts: readonly string[] = ids, requests: readonly string[] = ids): GoalEstimate<GoalMovementRisk> => ({
    state: 'pending', requestIds: unique(requests.length ? requests : [request.effect.id]),
    reason: { code, factIds: unique(facts), values: {} },
  });
  if (snapshot.tick !== situation.tick || request.throughTick < snapshot.tick || request.arrivalTicks.state !== 'met')
    return request.arrivalTicks.state === 'met' ? pending('movement-world-epoch-or-window-pending') : request.arrivalTicks;
  const ticks = request.arrivalTicks.value;
  if (!Number.isFinite(ticks) || ticks < 0 || snapshot.tick + ticks > request.throughTick)
    return pending('movement-window-invalid');
  const unresolved = request.routes.filter(row => row.state === 'pending');
  if (unresolved.length) return pending('movement-route-pending', ids, unresolved.flatMap(row => row.state === 'pending' ? [row.requestId] : []));
  if (request.routes.some(row => row.state === 'unmet')) return pending('movement-route-not-published');
  const published = input.publishedRisk;
  if (published && (published.epoch !== snapshot.tick || published.requestId !== goalCombatMovementRiskId(request)))
    return pending('movement-published-model-binding-mismatch');
  if (!request.cohort.length) return pending('movement-cohort-empty');
  const roads: { unit: Unit; points: readonly Point[] }[] = [];
  for (const member of request.cohort) {
    const unit = member.reference.kind === 'existing' ? snapshot.units.find(unit => member.reference.kind === 'existing' && unit.id === member.reference.entityId) : undefined;
    if (!unit || unit.owner !== situation.owner || unit.hp <= 0 || unit.deck || unit.cabin
      || goalValueKey(unit) !== goalValueKey(member.assessment)) return pending('movement-current-cohort-binding-pending');
    const row = request.routes.find(row => row.fact.predicate.kind === 'route' && row.fact.predicate.actor
      && goalValueKey(row.fact.predicate.actor) === goalValueKey(member.reference));
    const p = row?.fact.predicate;
    if (!row?.route || p?.kind !== 'route' || p.mover !== 'land' || row.observedTick !== snapshot.tick
      || squared(p.from.point, unit) > 1e-8 || squared(p.to.point, request.target.point) > 1e-8
      || !Number.isFinite(row.route.distance) || row.route.distance < 0 || row.route.ticks === null
      || !Number.isFinite(row.route.ticks) || row.route.ticks < 0 || row.route.ticks > ticks)
      return pending('movement-route-actor-or-window-pending');
    const points = row.route.points;
    if (!points.every(finite) || !finite(unit) || !finite(request.target.point)
      || points.length && squared(points.at(-1)!, request.target.point) > 1e-8
      || !points.length && squared(unit, request.target.point) > 1e-8) return pending('movement-route-endpoint-pending');
    roads.push({ unit, points: [{ x: unit.x, y: unit.y }, ...points] });
  }
  if (published?.risk.state === 'met') {
    const value = published.risk.value;
    return Number.isFinite(value.expectedLossGold) && value.expectedLossGold >= 0
      && Number.isFinite(value.survivalProbability) && value.survivalProbability >= 0 && value.survivalProbability <= 1
      ? published.risk : pending('movement-published-model-invalid', published.risk.factIds);
  }
  if (ticks > situation.horizonTicks) return published?.risk ?? pending('movement-observation-window-uncovered');
  const zero = (extra: readonly string[] = []): GoalEstimate<GoalMovementRisk> => ({ state: 'met', value: { expectedLossGold: 0, survivalProbability: 1 },
    factIds: unique([...ids, ...extra]) });
  // No elapsed movement can incur transport loss. Ongoing combat/guard duty
  // remains the next action's battle assessment, rather than a second charge.
  if (ticks === 0 && roads.every(road => road.points.every(point => squared(point, road.unit) < 1e-8))) return zero();
  const contacts = new Set<string>(), examined: string[] = [], campFacts = neutralCampExposure(snapshot);
  const plannedCamps = new Set(request.plannedCampIds ?? []);
  const opponent = (owner: string) => owner === 'neutral' || strategyIsOpponent(snapshot, situation.owner, owner);
  const mobile = snapshot.units.filter(unit => unit.hp > 0 && strategyIsOpponent(snapshot, situation.owner, unit.owner));
  const hullSpeed = Math.max(0, ...mobile.filter(unit => shipProfile(unit)).map(unit => Math.max(unit.speed,
    Math.abs(unit.sailing?.speed ?? 0), Math.hypot(unit.sailing?.velocityX ?? 0, unit.sailing?.velocityY ?? 0))));
  for (const { unit, points } of roads) {
    if (unit.effects.some(effect => effect.type === 'poison' && effect.remaining > 0)) contacts.add(unit.id);
    for (const foe of mobile) {
      examined.push(foe.id);
      const carrierId = foe.deck?.shipId ?? foe.cabin?.shipId, carrier = carrierId ? snapshot.units.find(ship => ship.id === carrierId && ship.hp > 0) : undefined;
      if (carrierId && !carrier) { contacts.add(foe.id); continue; }
      const capability = combatCapability(snapshot, foe), weapons = combatWeapons(snapshot, foe);
      let reach = Math.max(capability.armed ? capability.range + bodyRadius(foe) + unit.radius : 0,
        mountedThreatReach(snapshot, foe, unit, ticks));
      for (const ability of unitAbilities(foe)) {
        const rules = ABILITY_DEFS[ability];
        if (abilityCooldown(foe, ability) > ticks) continue;
        if (rules.behavior === 'charge') reach += (rules.range + rules.drive) * (1 + Math.floor(ticks / Math.max(1, rules.cooldown)));
        if (rules.behavior === 'summon') reach = Math.max(reach, rules.range + UNIT_DEFS[rules.summonKind].attackRange
          + UNIT_DEFS[rules.summonKind].speed * ticks / SIM_TICKS_PER_SECOND + unit.radius);
      }
      reach += Math.max(UNIT_DEFS[foe.kind].splash ? 50 : 0, ...weapons.map(weapon => Math.max(weapon.weapon?.radius ?? 0, weapon.weapon?.blastRadius ?? 0)));
      for (const item of itemsFor(snapshot, foe)) {
        if (item.kind === 'flameCloak') reach = Math.max(reach, FLAME_CLOAK.radius + unit.radius);
        if (item.cooldownRemaining > ticks) continue;
        if (item.kind === 'stormStaff') reach = Math.max(reach, STORM_STAFF.range + STORM_STAFF.radius + unit.radius);
        if (item.kind === 'lightningRod') reach = Math.max(reach,
          LIGHTNING_ROD.range + (LIGHTNING_ROD.hits - 1) * LIGHTNING_ROD.bounceRange + unit.radius);
      }
      // Ignore terrain and allow observed hull transport: this is a conservative
      // physical upper envelope, never an invented enemy route or ETA.
      const speed = Math.max(0, foe.speed) + hullSpeed;
      const radius = reach + speed * ticks / SIM_TICKS_PER_SECOND + (carrier ? bodyRadius(carrier) : 0);
      if (!Number.isFinite(radius) || intersects(points, carrier ?? foe, radius)) contacts.add(foe.id);
    }
    for (const camp of campFacts.camps) {
      const campId = goalCampId(camp.memberIds);
      if (plannedCamps.has(campId)) { examined.push(campId); continue; }
      const memberIds = new Set(camp.memberIds);
      // Damage already in flight or an observed attack order can wake an idle
      // camp during this march. Its response is not restricted to alert range.
      const triggered = camp.members.some((member, index) => member.active || member.returning
        || camp.camp.creeps[index]!.order.type !== 'idle' || !!camp.camp.creeps[index]!.orderQueue?.length
        || !!camp.camp.creeps[index]!.aim?.tracking
        || camp.camp.creeps[index]!.effects.some(effect => effect.type === 'poison' && effect.remaining > 0))
        || snapshot.units.some(actor => actor.hp > 0 && actor.owner !== 'neutral'
          && 'targetId' in actor.order && actor.order.targetId !== undefined && memberIds.has(actor.order.targetId))
        || snapshot.projectiles.some(shot => shot.remaining > 0 && shot.remaining <= ticks
          && (memberIds.has(shot.targetId) || camp.members.some((member, index) => squared(member.point, { x: shot.toX, y: shot.toY })
            <= ((shot.weapon?.radius ?? 0) + camp.camp.creeps[index]!.radius) ** 2)))
        || snapshot.effects.some(effect => (effect.type === 'storm' || effect.type === 'burningGround') && effect.remaining > 0
          && camp.members.some((member, index) => squared(member.point, effect) <= ((effect.radius ?? 0) + camp.camp.creeps[index]!.radius) ** 2));
      for (let index = 0; index < camp.members.length; index++) {
        const member = camp.members[index]!, guard = camp.camp.creeps[index]!; examined.push(member.id);
        const reach = Math.max(mountedThreatReach(snapshot, guard, unit, ticks), combatCapability(snapshot, guard).range) + guard.radius + unit.radius;
        if (triggered) {
          // Current/home/leash remain relevant even while every guard returns.
          if (intersects(points, member.home, member.pursuitRadius + reach)
            || intersects(points, member.responseOrigin, member.responseRadius + reach)
            || corridor(points, member.point, member.home, reach + member.alertRadius)) contacts.add(member.id);
        } else {
          // Native idle acquisition does not chase everything within its leash.
          // Ready spells and carried attacks still retain their own native reach.
          const alert = Math.max(strikeReach(guard, unit, member.alertRadius),
            castThreatReach(snapshot, guard, unit, ticks) + guard.radius + unit.radius);
          if (intersects(points, member.point, alert)) contacts.add(member.id);
        }
      }
    }
    for (const tower of snapshot.buildings.filter(building => building.hp > 0 && opponent(building.owner))) {
      const rules = BUILDING_DEFS[tower.kind];
      if (Math.max(tower.attackDamage, rules.attackDamage ?? 0) <= 0) continue;
      examined.push(tower.id);
      const reach = Math.max(tower.attackRange, rules.attackRange ?? 0) + unit.radius;
      if (intersects(points, tower, reach)) contacts.add(tower.id);
    }
    for (const shot of snapshot.projectiles.filter(shot => opponent(shot.owner) && shot.remaining > 0 && shot.remaining <= ticks)) {
      if (shot.targetId === unit.id || intersects(points, { x: shot.toX, y: shot.toY }, (shot.weapon?.radius ?? 0) + unit.radius)) contacts.add(shot.id);
    }
    for (const effect of snapshot.effects.filter(effect => (effect.type === 'storm' || effect.type === 'burningGround')
      && effect.remaining > 0 && (effect.owner === undefined || opponent(effect.owner))))
      if (intersects(points, effect, (effect.radius ?? 0) + unit.radius)) contacts.add(effect.id);
  }
  if (contacts.size) return published?.risk ?? pending('movement-observed-exposure-unquoted', [...ids, ...contacts]);
  return zero(examined);
}

/** Conditional post-to-contact accounting. The original camp battle owns the
 * named guards; all other threats still pass through the unchanged assessor. */
function campContactRisk(input: Parameters<typeof assessGoalCombatMovementRisk>[0]): GoalEstimate<GoalMovementRisk> {
  const { snapshot, situation, request } = input, contact = request.campContact!;
  const pending = (code: string): GoalEstimate<GoalMovementRisk> => ({ state: 'pending', requestIds: [contact.stagingFact.id],
    reason: { code, factIds: [contact.campId, contact.stagingFact.id], values: {} } });
  const p = contact.stagingFact.predicate, camp = resolveGoalCamp(snapshot, contact.campId);
  const refs = request.cohort.map(member => goalValueKey(member.reference)).sort();
  if (camp.status !== 'present' || p.kind !== 'camp-staging' || p.campId !== contact.campId
    || goalValueKey(p.at) !== goalValueKey(request.from) || goalValueKey(p.cohort?.map(goalValueKey).sort()) !== goalValueKey(refs)
    || !request.from.landId || request.from.landId !== request.target.landId
    || squared(request.target.point, camp.exposure.camp.center) > 1e-8
    || !['camp-cleared', 'gold'].includes(request.effect.predicate.kind)
    || request.effect.predicate.kind === 'camp-cleared' && request.effect.predicate.campId !== contact.campId)
    return pending('movement-camp-contact-binding-pending');
  const projected = new Map<string, Unit>();
  for (const member of request.cohort) {
    const actual = member.reference.kind === 'existing' ? snapshot.units.find(unit => member.reference.kind === 'existing' && unit.id === member.reference.entityId) : undefined;
    if (!actual || actual.owner !== situation.owner || actual.hp <= 0 || projected.has(actual.id)
      || squared(member.assessment, request.from.point) > 1e-8) return pending('movement-camp-contact-cohort-pending');
    const atPost = { ...actual, x: request.from.point.x, y: request.from.point.y, deck: undefined, cabin: undefined };
    if (goalValueKey(member.assessment) !== goalValueKey(atPost)) return pending('movement-camp-contact-cohort-pending');
    projected.set(actual.id, atPost);
  }
  const guards = new Set(camp.exposure.memberIds);
  const conditionalSnapshot = { ...snapshot, units: snapshot.units.filter(unit => !guards.has(unit.id))
    .map(unit => projected.get(unit.id) ?? unit) };
  const { campContact: _contact, ...ordinaryRequest } = request;
  const published = input.publishedRisk;
  if (published && (published.epoch !== snapshot.tick || published.requestId !== goalCombatMovementRiskId(request)))
    return pending('movement-published-model-binding-mismatch');
  const result = assessGoalCombatMovementRisk({ snapshot: conditionalSnapshot, situation, request: ordinaryRequest,
    ...(published ? { publishedRisk: { ...published, requestId: goalCombatMovementRiskId(ordinaryRequest) } } : {}) });
  return result.state === 'met' ? { ...result, factIds: unique([...result.factIds, contact.campId, contact.stagingFact.id]) } : result;
}
