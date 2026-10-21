import { unitMover } from '../../shared/catalog';
import { weaponRules } from '../../shared/equipment';
import type { Owner, Unit } from '../../shared/types';
import { goalFact, goalValueKey } from './goal-facts';
import { canLandIntercept, landInterceptionShotDamage } from './land-interception';
import { strategyIsOpponent } from './ownership';
import type { GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import type { LandId, Point } from './types';

export type GoalLandCapabilityFactPorts = Readonly<{
  /** Prepared region lookup only; this resolver never creates terrain fields. */
  regionAt: (point: Point) => LandId | null;
  /** Formal execution observation/projection for this exact timed predicate. */
  readWindowProof?: (fact: GoalFact) => GoalFactObservation | null;
  /** Absence is not destruction without a recorded real entity lifecycle. */
  destroyedEntity?: (id: string) => Readonly<{ owner: Owner; destroyedTick: number; revision: string }> | null;
}>;

/** One land-domain consumer. No selector, provider, queue, total fact reader,
 * speculative troop or native path search is created here. */
export function readGoalLandCapabilityFact(fact: GoalFact, context: GoalPlanningContext,
  ports: GoalLandCapabilityFactPorts): GoalFactObservation | null {
  const p = fact.predicate, { snapshot, owner, tick } = context;
  if (p.kind !== 'interception-capability' && p.kind !== 'harassment-ended'
    && p.kind !== 'route-controlled' && p.kind !== 'enemy-site-destroyed') return null;
  const answer = (met: boolean, code: string, dependencies: unknown,
    extra: Partial<GoalFactObservation> = {}): GoalFactObservation => ({ fact, state: met ? 'met' : 'unmet', observedTick: tick,
    revision: goalValueKey([fact.id, dependencies]), evidence: [], reason: { code, factIds: [fact.id], values: {} }, ...extra } as GoalFactObservation);
  const pending = (code: string, dependencies: unknown, requests: readonly string[] = [fact.id], requestedTick = tick): GoalFactObservation => ({
    fact, state: 'pending', observedTick: tick, requestedTick,
    requestId: `land:${goalValueKey([fact.id, requests])}`, revision: goalValueKey([fact.id, code, dependencies]),
    reason: { code, factIds: requests, values: {} }, evidence: [],
  });
  if (snapshot.tick !== tick || context.situation.tick !== tick || context.situation.owner !== owner)
    return pending('land-fact-epoch-pending', [snapshot.tick, context.situation.tick, context.situation.owner]);
  if (p.kind === 'route-controlled' || p.kind === 'harassment-ended') {
    const proof = ports.readWindowProof?.(fact);
    if (!proof) return pending('land-window-proof-required', p);
    if (proof.fact.id !== fact.id || proof.observedTick !== tick)
      return pending('land-window-proof-binding-pending', [proof.fact.id, proof.observedTick, proof.revision]);
    // The proof source owns the full window and cohort/lease validation. A
    // quiet current snapshot alone never establishes future control.
    return { ...proof, fact };
  }
  if (p.kind === 'enemy-site-destroyed') {
    const id = p.site.entityId;
    if (!id) return pending('land-target-identity-required', p.site);
    const entity = [...snapshot.units, ...snapshot.buildings].find(entity => entity.id === id);
    if (entity) return answer(entity.hp <= 0 && strategyIsOpponent(snapshot, owner, entity.owner),
      entity.hp <= 0 && strategyIsOpponent(snapshot, owner, entity.owner) ? 'native-hostile-target-destroyed'
        : strategyIsOpponent(snapshot, owner, entity.owner) ? 'native-hostile-target-alive' : 'land-target-not-hostile',
      [entity.id, entity.owner, entity.hp, snapshot.teams]);
    const destroyed = ports.destroyedEntity?.(id);
    if (!destroyed || !Number.isFinite(destroyed.destroyedTick) || destroyed.destroyedTick > tick)
      return pending('land-target-lifecycle-required', id);
    return answer(strategyIsOpponent(snapshot, owner, destroyed.owner), 'recorded-target-lifecycle',
      [id, destroyed, snapshot.teams]);
  }
  if (!Number.isFinite(p.throughTick) || p.throughTick < tick)
    return answer(false, 'land-interception-window-invalid', p.throughTick);
  if (!p.cohort) return pending('land-interception-cohort-required', p.site);
  const refs = goalFact(p).predicate;
  if (refs.kind !== 'interception-capability') return null;
  const cohort = refs.cohort!;
  if (cohort.some(ref => ref.kind !== 'existing')) return answer(false, 'land-cohort-output-not-born', cohort, { entityIds: [] });
  const units = cohort.map(ref => snapshot.units.find(unit => ref.kind === 'existing' && unit.id === ref.entityId));
  if (units.some(unit => !unit || unit.hp <= 0 || unit.owner !== owner || unitMover(unit.kind) !== 'land'
    || unit.deck || unit.cabin)) return answer(false, 'land-cohort-member-unavailable', units, { entityIds: [] });
  const crew = units as Unit[];
  const bound = snapshot.units.find(unit => unit.id === p.site.entityId);
  const observation = context.situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === p.site.entityId);
  if (!bound && !observation) return pending('land-interception-threat-observation-required', p.site);
  if (bound && !strategyIsOpponent(snapshot, owner, bound.owner)) return answer(false, 'land-target-not-hostile', [bound.id, bound.owner, snapshot.teams]);
  const threats = bound ? bound.hp > 0 ? [bound] : [] : snapshot.units.filter(unit => unit.hp > 0
    && observation!.attackers.some(attacker => attacker.unitId === unit.id) && strategyIsOpponent(snapshot, owner, unit.owner));
  if (observation && observation.attackers.some(attacker => !snapshot.units.some(unit => unit.id === attacker.unitId)))
    return pending('land-interception-threat-entity-pending', observation.attackers);
  const stats = (unit: Unit) => [unit.id, unit.kind, unit.owner, unit.x, unit.y, unit.hp, unit.maxHp, unit.attackDamage,
    unit.attackCooldown, unit.cooldown, unit.attackRange, unit.speed, unit.expiresTick, unit.effects, unit.hands, unit.level];
  const dependencies: unknown[] = [crew.map(stats), threats.map(stats), snapshot.players[owner]?.upgrades, snapshot.teams,
    snapshot.items, snapshot.variants];
  if (!threats.length) return answer(true, 'land-no-observed-interception-target', dependencies,
    { entityIds: crew.map(unit => unit.id), interception: { threatIds: [], capableUnitIds: [], counterKinds: [] } });
  // The existing two-volley gate is a single-harasser assessment. Concurrent
  // targets need the common battle port, not reused damage for every enemy.
  if (threats.length > 1) return pending('land-joint-interception-assessment-required', dependencies);
  const target = threats[0]!, landId = ports.regionAt(target);
  if (!landId || p.site.landId && landId !== p.site.landId)
    return answer(false, 'land-interception-target-off-land', dependencies);
  const ready: Unit[] = [], missing: GoalFactObservation[] = [];
  for (const unit of crew) {
    if (ports.regionAt(unit) !== landId || unit.attackDamage <= 0 || !canLandIntercept(unit, target)) continue;
    const cooldown = weaponRules(snapshot, unit).attackCooldown;
    if (![unit.hp, unit.speed, unit.attackDamage, cooldown, unit.cooldown, unit.attackRange].every(Number.isFinite))
      return pending('land-interception-stats-pending', dependencies);
    const route = context.readFact(goalFact({ kind: 'route', mover: 'land', actor: { kind: 'existing', entityId: unit.id },
      from: { landId, point: { x: unit.x, y: unit.y } }, to: { ...p.site, landId, point: { x: target.x, y: target.y } } }));
    dependencies.push([route.fact.id, route.revision, route.state, route.availableTick, route.route]);
    if (route.state === 'pending' || route.state === 'met' && (route.availableTick ?? tick) > tick
      || route.state === 'met' && (route.route?.ticks === null || route.route?.ticks === undefined)) { missing.push(route); continue; }
    if (route.state !== 'met') continue;
    const eta = route.route!.ticks!;
    if (!Number.isFinite(eta) || eta < 0) { missing.push(route); continue; }
    // The current weapon cooldown elapses during the approach as well.
    const secondShot = tick + Math.max(eta, Math.max(0, unit.cooldown)) + Math.max(1, cooldown);
    if (secondShot <= p.throughTick && (unit.expiresTick === undefined || unit.expiresTick > secondShot)) ready.push(unit);
  }
  const volley = ready.reduce((sum, unit) => sum + landInterceptionShotDamage(snapshot, unit, target), 0);
  const capable = ready.length > 0 && volley * 2 >= target.hp;
  if (!capable && missing.length) return pending('land-interception-route-pending', dependencies,
    missing.map(route => route.state === 'pending' ? route.requestId : route.fact.id),
    Math.min(tick, ...missing.flatMap(route => route.state === 'pending' ? [route.requestedTick] : [])));
  return answer(capable, capable ? 'native-land-interception-capable' : 'native-land-interception-insufficient', dependencies,
    { entityIds: crew.map(unit => unit.id), quantity: volley * 2,
      interception: { threatIds: [target.id], capableUnitIds: ready.map(unit => unit.id),
        counterKinds: [...new Set(ready.map(unit => unit.kind))].sort() },
      reason: { code: capable ? 'native-land-interception-capable' : 'native-land-interception-insufficient',
        factIds: [fact.id], values: { twoVolleyDamage: volley * 2, requiredDamage: target.hp, deficit: Math.max(0, target.hp - volley * 2) } } });
}
