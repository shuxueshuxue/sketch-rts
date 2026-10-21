import { unitMover } from '../../shared/catalog';
import { isOpenGround } from '../../shared/terrain';
import type { Unit } from '../../shared/types';
import { shipProfile } from '../../shared/ship-geometry';
import { bodyMass } from '../../shared/physical-body';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import { MINING_RALLY_RADIUS } from '../bootstrap_1/mining-rally';
import { withinExpansionGarrisonCoverage } from '../bootstrap_1/expansion-garrison-rules';
import { bootstrapCampApproach, type CampApproachPointReader } from '../bootstrap_1/camp-geometry';
import { effectiveCombatRating, structureRating, TOWER_STRENGTH } from '../policy/v6/strength';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { assessAllocatedForce, targetCoveringTowers } from './allocated-force';
import type { AllocationArrivalReader, AllocationLandRouteReader } from './allocation-arrival-query';
import { defenseThreatScenarios, type DefenseResponse } from './defense-risk';
import { defenseGatherPost } from './executors/defend-site';
import type { GoalNativeGroundReader } from './goal-boarding-geometry';
import { goalCampId, goalFact, goalValueKey, resolveGoalCamp } from './goal-facts';
import { assessGoalCampCombatOption, assessGoalDefenseCombatOption, type GoalMovementRisk } from './goal-naval-assessment';
import type { GoalCandidates, GoalCohortMember, GoalCohortOption, GoalCombatOption, GoalEntityReference, GoalEstimate,
  GoalFact, GoalFactObservation, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import { landIdAt } from './regions';
import { seaIdAt } from './regions';
import type { GoalHullCandidate, GoalTransportFactPorts } from './goal-grounding-ports';
import { valueGoalSeaLeg } from './goal-sea-leg-value';
import { coarseGoalCampOptions, type GoalCampBattleModel } from './goal-camp-quotation';
import { createDefaultGoalCampBattleModel, type GoalCampModelObserver } from './goal-camp-default-model';
import { goalAssemblyPostSource } from './goal-naval-actions';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { goalStartedCohortGroups, type GoalStartedCohortReader } from './goal-started-cohort';
import { goalCampStagingOutsideAlert } from './goal-camp-staging-geometry';
import type { Point, Target } from './types';

type Deferred = NonNullable<Extract<GoalCandidates<never>, { state: 'met' }>['deferred']>[number];
export type GoalCombatMovementRequest = Readonly<{
  effect: GoalFact; cohort: readonly GoalCohortMember[]; from: Target; target: Target;
  routes: readonly GoalFactObservation[]; arrivalTicks: GoalEstimate<number>; throughTick: number;
  /** Camps priced by this selected plan's clearing actions. Their battle loss
   * includes contact during gathering; unrelated camps remain march risks. */
  plannedCampIds?: readonly string[];
  /** Only the named camp's contact exposure belongs to the camp battle model.
   * The exact on-post prerequisite remains a condition, never current arrival. */
  campContact?: Readonly<{ campId: string; stagingFact: GoalFact }>;
}>;
export type GoalNavalCombatGroundingPorts = Readonly<{
  arrival: AllocationArrivalReader; landRoute: AllocationLandRouteReader;
  resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']>;
  /** Same-source conditional landing origins. Existing actors retain their
   * actual HP/weapons; these locations become usable only via their pool facts. */
  cohortOptions?: GoalGroundingReader['cohortOptions'];
  startedCohort?: GoalStartedCohortReader;
  transportFacts?: Pick<GoalTransportFactPorts, 'seaLeg'>;
  /** Read-only coarse travel time from the same owner's published sea field;
   * this port must not request geometry or start a route query. */
  coarseSeaTicks?: (ship: Unit, from: Point, to: Point, future: boolean) => GoalEstimate<number>;
  movementRisk?: (request: GoalCombatMovementRequest) => GoalEstimate<GoalMovementRisk>;
  /** Same replaceable camp model for coarse discovery and exact refinement. */
  campBattleModel?: GoalCampBattleModel;
  onCampModelSelection?: GoalCampModelObserver;
  readGroundPoint?: GoalNativeGroundReader;
  /** Only potential redirect scenarios need a counterfactual response. The
   * source owns its eligible/excluded pool and published route facts. */
  response?: (request: GoalCombatMovementRequest) => DefenseResponse;
  allowedUnitIds?: readonly string[]; interruptedUnitIds?: readonly string[];
}>;
const sorted = (items: readonly string[]) => [...new Set(items)].sort();
const reason = (code: string, factIds: readonly string[] = []) => ({ code, factIds: sorted(factIds), values: {} });
const known = <T>(value: T, factIds: readonly string[]): GoalEstimate<T> => ({ state: 'met', value, factIds: sorted(factIds) });
const pending = (code: string, ids: readonly string[], requests: readonly string[] = ids): Extract<GoalCandidates<never>, { state: 'pending' }> => ({
  state: 'pending', requestIds: sorted(requests), reason: reason(code, ids),
});
const unmet = (code: string, ids: readonly string[] = []): Extract<GoalCandidates<never>, { state: 'unmet' }> => ({ state: 'unmet', reason: reason(code, ids) });
const gap = (a: Target['point'], b: Target['point']) => Math.hypot(a.x - b.x, a.y - b.y);

/** Domain candidate enumeration on the actual owner-think facts. It never
 * creates a Situation, route query, risk batch or work allowance. Pool groups
 * and their singleton contributors are alternatives, not an authored chain. */
export function createGoalNavalCombatGrounding(context: GoalPlanningContext, ports: GoalNavalCombatGroundingPorts):
  Pick<GoalGroundingReader, 'combatOptions'> {
  const campBattleModel = ports.campBattleModel ?? createDefaultGoalCampBattleModel(ports.onCampModelSelection);
  const allowed = ports.allowedUnitIds === undefined ? null : new Set(ports.allowedUnitIds);
  const interrupted = new Set(ports.interruptedUnitIds ?? []);
  const actors = new Map(context.snapshot.units.map(unit => [unit.id, unit]));
  const locations = new Map(context.situation.units.map(unit => [unit.id, unit.location]));
  const roles = new Map(context.situation.units.map(unit => [unit.id, unit.roles]));
  const eligible = (unit: Unit) => unit.owner === context.owner && unit.hp > 0 && unit.expiresTick === undefined
    && unitMover(unit.kind) === 'land' && (!allowed || allowed.has(unit.id)) && !interrupted.has(unit.id);
  const units = context.snapshot.units.filter(eligible).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const memo = new Map<string, GoalCandidates<GoalCombatOption>>();
  const committedEffects = new Set<string>();
  function cohorts(effect: GoalFact): GoalCandidates<readonly GoalCohortMember[]> {
    const p = effect.predicate;
    const workers = p.kind === 'assets-safe' || p.kind === 'worker-at';
    const suitable = (unit: Unit) => workers ? unit.kind === 'worker' : unit.kind !== 'worker' && unit.attackDamage > 0
      && (p.kind !== 'garrison-ready' || !!roles.get(unit.id)?.some(role => role === 'frontline' || role === 'ranged')
        && !roles.get(unit.id)?.some(role => role === 'caster' || role === 'healer' || role === 'worker'));
    const refs = p.kind === 'assets-safe' ? sorted(p.unitIds).map(entityId => ({ kind: 'existing' as const, entityId }))
      : p.kind === 'worker-at' && p.worker ? [p.worker]
      : p.kind === 'force-at' || p.kind === 'force-available' ? p.cohort : undefined;
    const groups: GoalEntityReference[][] = [];
    const preferred = goalStartedCohortGroups(context, effect, units.filter(suitable), ports.startedCohort);
    if (preferred !== undefined) committedEffects.add(effect.id);
    if (refs) groups.push([...refs]);
    else if (preferred) groups.push(...preferred.map(group => group.map(unit => ({ kind: 'existing' as const, entityId: unit.id }))));
    else {
      const lands = new Map<string, Unit[]>();
      for (const unit of units.filter(suitable)) {
        const location = locations.get(unit.id);
        const region = location?.kind === 'land' ? location.landId : location?.kind === 'aboard' ? `aboard:${location.shipId}` : undefined;
        if (!region) continue;
        const group = lands.get(region) ?? []; group.push(unit); lands.set(region, group);
      }
      for (const [, units] of [...lands].sort(([a], [b]) => a < b ? -1 : 1)) {
        groups.push(units.map(unit => ({ kind: 'existing', entityId: unit.id })));
        if (units.length > 1) for (const unit of units) groups.push([{ kind: 'existing', entityId: unit.id }]);
      }
    }
    const candidates: (readonly GoalCohortMember[])[] = [], deferred: Deferred[] = [];
    for (const group of groups) {
      const id = `combat-cohort:${goalValueKey(group)}`, bound = context.precision === 'coarse'
        ? { state: 'met' as const, candidates: group.flatMap(reference => {
          const actor = reference.kind === 'existing' ? actors.get(reference.entityId) : undefined;
          return actor ? [{ reference, assessment: actor }] : [];
        }), factIds: [effect.id] } : ports.resolveCohort(group);
      if (bound.state === 'pending') { deferred.push({ id, requestIds: bound.requestIds, reason: bound.reason }); continue; }
      if (bound.state !== 'met') continue;
      const members = [...new Map(bound.candidates.map(member => [goalValueKey(member.reference), member])).values()];
      if (goalValueKey(sorted(members.map(member => goalValueKey(member.reference)))) !== goalValueKey(sorted(group.map(goalValueKey)))) continue;
      // Actual references use actual weapons/HP/location. A resolver may not
      // substitute a healthier assessment copy for a currently existing unit.
      const exact = members.flatMap(member => {
        const actor = member.reference.kind === 'existing' ? actors.get(member.reference.entityId) : undefined;
        return actor && eligible(actor)
          && suitable(actor)
          ? [{ reference: member.reference, assessment: actor }] : [];
      });
      if (exact.length !== members.length) {
        if (members.some(member => member.reference.kind !== 'existing')) deferred.push({ id, requestIds: [id],
          reason: reason('combat-actual-pool-binding-pending', [effect.id]) });
        continue;
      }
      if (exact.length) candidates.push(exact);
    }
    return choices(candidates, deferred, [effect.id]);
  }
  function choices<T>(candidates: readonly T[], deferred: readonly Deferred[], ids: readonly string[]): GoalCandidates<T> {
    return candidates.length ? { state: 'met', candidates, factIds: sorted(ids), ...(deferred.length ? { deferred } : {}) }
      : deferred.length ? pending('combat-candidate-facts-pending', deferred.flatMap(item => item.reason.factIds), deferred.flatMap(item => item.requestIds))
      : unmet('no-eligible-combat-cohort', ids);
  }
  function origins(effect: GoalFact): GoalCandidates<GoalCohortOption> {
    const actual = cohorts(effect), candidates: GoalCohortOption[] = [], deferred: Deferred[] = [];
    if (actual.state === 'met') {
      deferred.push(...(actual.deferred ?? []));
      for (const group of actual.candidates) {
        const location = locations.get(group[0]!.assessment.id), id = `combat-origin:${goalValueKey(group.map(m => m.reference))}`;
        if (location?.kind !== 'land' && location?.kind !== 'aboard' || group.some(member => {
          const other = locations.get(member.assessment.id);
          return location?.kind === 'land' ? other?.kind !== 'land' || other.landId !== location.landId
            : location?.kind === 'aboard' ? other?.kind !== 'aboard' || other.shipId !== location.shipId : true;
        })) { deferred.push({ id, requestIds: [id], reason: reason('combat-cohort-region-pending', [effect.id]) }); continue; }
        const from: Target = location.kind === 'land' ? { landId: location.landId, point: { ...location.point } }
          : { seaId: location.seaId, point: { ...location.point } };
        candidates.push({ id, members: group, from, preconditions: [], availableTick: context.tick, factIds: [] });
      }
    } else if (actual.state === 'pending') deferred.push({ id: `combat-actual:${effect.id}`, requestIds: actual.requestIds, reason: actual.reason });
    const projected = ports.cohortOptions?.(effect);
    if (projected?.state === 'pending') deferred.push({ id: `combat-projected:${effect.id}`, requestIds: projected.requestIds, reason: projected.reason });
    if (projected?.state === 'met') {
      deferred.push(...(projected.deferred ?? []));
      for (const option of projected.candidates) {
        const refs = option.members.map(member => member.reference);
        const refsKey = goalValueKey(sorted(refs.map(goalValueKey)));
        const p = effect.predicate;
        const requested = p.kind === 'assets-safe' ? sorted(p.unitIds).map(entityId => ({ kind: 'existing' as const, entityId }))
          : p.kind === 'worker-at' && p.worker ? [p.worker]
          : p.kind === 'force-at' || p.kind === 'force-available' ? p.cohort : undefined;
        if (requested && goalValueKey(sorted(requested.map(goalValueKey))) !== refsKey) continue;
        // The landing enumerator shares the same commitment. A cached broad
        // pool option must not grow this group again after current discovery.
        if (!requested && committedEffects.has(effect.id) && actual.state === 'met'
          && !actual.candidates.some(group => goalValueKey(sorted(group.map(member => goalValueKey(member.reference)))) === refsKey)) continue;
        const poolFact = option.preconditions.find(fact => {
          const p = fact.predicate;
          return p.kind === 'force-available' && p.at.landId === option.from.landId
            && p.cohort && goalValueKey(sorted(p.cohort.map(goalValueKey))) === refsKey
            || p.kind === 'worker-at' && refs.length === 1 && p.at.landId === option.from.landId
              && p.worker && goalValueKey(p.worker) === goalValueKey(refs[0]);
        });
        const force = option.members.reduce((sum, member) => {
          const actor = member.reference.kind === 'existing' ? actors.get(member.reference.entityId) : undefined;
          return sum + (actor ? effectiveCombatRating(context.snapshot, actor) : 0);
        }, 0);
        const postFact = goalAssemblyPostSource(option.preconditions, option.from, refs, force);
        if (!option.from.landId || !poolFact && !postFact) {
          deferred.push({ id: option.id, requestIds: [option.id], reason: reason('combat-conditional-origin-pool-unproved', [effect.id, ...option.factIds]) }); continue;
        }
        const members = option.members.flatMap(member => {
          const actor = member.reference.kind === 'existing' ? actors.get(member.reference.entityId) : undefined;
          if (!actor || !eligible(actor) || member.assessment.kind !== actor.kind || !Number.isFinite(member.assessment.x)
            || !Number.isFinite(member.assessment.y) || landIdAt(context.snapshot.map, member.assessment) !== option.from.landId) return [];
          const p = effect.predicate;
          const suitable = p.kind === 'worker-at' || p.kind === 'assets-safe' ? actor.kind === 'worker'
            : actor.kind !== 'worker' && actor.attackDamage > 0 && (p.kind !== 'garrison-ready'
              || !!roles.get(actor.id)?.some(role => role === 'frontline' || role === 'ranged')
                && !roles.get(actor.id)?.some(role => role === 'caster' || role === 'healer' || role === 'worker'));
          return suitable ? [{ reference: member.reference, assessment: { ...actor,
            x: member.assessment.x, y: member.assessment.y, deck: undefined, cabin: undefined } }] : [];
        });
        if (!members.length || members.length !== option.members.length
          || new Set(refs.map(goalValueKey)).size !== refs.length) continue;
        candidates.push({ ...option, members });
      }
    }
    return !candidates.length && !deferred.length && actual.state === 'unmet' ? actual : choices(candidates, deferred, [effect.id]);
  }
  function atOrigin(option: GoalCombatOption, origin: GoalCohortOption): GoalCombatOption {
    if (!origin.preconditions.length && !origin.factIds.length) return option;
    return { ...option, id: `${option.id}:origin:${origin.id}`,
      preconditions: [...new Map([...option.preconditions, ...origin.preconditions].map(fact => [fact.id, fact])).values()],
      factIds: sorted([...option.factIds, ...origin.factIds]) };
  }
  function travel(effect: GoalFact, cohort: readonly GoalCohortMember[], from: Target, target: Target, throughTick: number): GoalCombatMovementRequest {
    const routes = cohort.map(member => {
      const unit = member.assessment, fact = goalFact({ kind: 'route', mover: 'land', actor: member.reference,
        from: { ...(from.landId ? { landId: from.landId } : {}), point: { x: unit.x, y: unit.y } }, to: target });
      return context.readFact(fact);
    });
    const missing = routes.filter(row => row.state === 'pending'), failed = routes.find(row => row.state === 'unmet');
    let arrivalTicks: GoalEstimate<number>;
    if (failed) arrivalTicks = { state: 'unmet', reason: failed.reason };
    else if (missing.length) arrivalTicks = pending('combat-route-pending', routes.map(row => row.fact.id), missing.flatMap(row => row.state === 'pending' ? [row.requestId] : []));
    else {
      const times: number[] = [], requests: string[] = [];
      let unreachable = false;
      for (const member of cohort) {
        const road = ports.landRoute(member.assessment, target.point);
        if (road.status !== 'known') { unreachable ||= road.status === 'unreachable'; requests.push(effect.id); continue; }
        const arrival = ports.arrival(member.assessment, target);
        if (arrival.status === 'reachable' && !arrival.crossings.length) times.push(arrival.ticks);
        else if (arrival.status === 'unreachable') unreachable = true;
        else requests.push(...('reason' in arrival ? arrival.reason.factIds ?? [] : []), effect.id);
      }
      arrivalTicks = unreachable ? { state: 'unmet', reason: reason('combat-route-unreachable', routes.map(row => row.fact.id)) }
        : requests.length ? pending('combat-arrival-pending', routes.map(row => row.fact.id), requests)
        : known(Math.max(0, ...times), routes.map(row => row.fact.id));
    }
    return { effect, cohort, from, target, routes, arrivalTicks, throughTick };
  }
  function movement(request: GoalCombatMovementRequest): GoalEstimate<GoalMovementRisk> {
    const risk = ports.movementRisk?.(request) ?? pending('combat-movement-risk-unquoted', [request.effect.id],
      request.routes.map(row => row.fact.id));
    return risk.state === 'met' && (!Number.isFinite(risk.value.expectedLossGold) || risk.value.expectedLossGold < 0
      || !Number.isFinite(risk.value.survivalProbability) || risk.value.survivalProbability < 0 || risk.value.survivalProbability > 1)
      ? { state: 'unmet', reason: reason('combat-movement-risk-invalid', risk.factIds) } : risk;
  }
  function movingOption(request: GoalCombatMovementRequest): GoalCombatOption {
    const ids = sorted([request.effect.id, ...request.routes.map(row => row.fact.id)]), risk = movement(request);
    const unavailable = request.arrivalTicks.state !== 'met' ? request.arrivalTicks : risk.state !== 'met' ? risk : null;
    const cost = unavailable ?? known([{ code: 'combat-movement-loss', gold: risk.state === 'met' ? risk.value.expectedLossGold : 0, factIds: ids }], ids);
    return { id: `combat-move:${goalValueKey([request.effect.id, request.cohort.map(m => m.reference), request.from, request.target])}`,
      target: request.target, from: request.from, cohort: request.cohort.map(member => member.reference), requiredForce: 0,
      byTick: request.throughTick, duration: request.arrivalTicks, cost,
      successProbability: unavailable ?? known(risk.state === 'met' ? risk.value.survivalProbability : 0, ids),
      preconditions: request.routes.map(row => row.fact), factIds: ids };
  }
  function coarseLocation(effect: GoalFact, group: readonly GoalCohortMember[], from: Target, target: Target,
    throughTick: number, preconditions: readonly GoalFact[] = []): GoalCombatOption {
    const refs = group.map(member => member.reference), p = effect.predicate;
    const crossing = from.landId !== target.landId || !!from.seaId;
    // A remote post is conditional on the same exact group reaching its pool.
    // This optimistic search origin is not a published physical landing.
    const conditionalPost = crossing && (p.kind === 'force-at' || p.kind === 'garrison-ready');
    const origin = conditionalPost ? target : from;
    const pool = conditionalPost ? [goalFact({ kind: 'force-available', at: target,
      metric: 'combat-rating', minimum: 0, cohort: refs, byTick: throughTick })] : [];
    const routes = p.kind === 'garrison-ready' || crossing && !conditionalPost ? [] : group.map(member => goalFact({ kind: 'route', mover: 'land',
      actor: member.reference, from: { ...(origin.landId ? { landId: origin.landId } : {}),
        point: conditionalPost ? target.point : { x: member.assessment.x, y: member.assessment.y } }, to: target }));
    const clocks = conditionalPost || crossing ? [0] : group.map(member => Math.ceil(gap(member.assessment, target.point)
      / Math.max(1, member.assessment.speed) * SIM_TICKS_PER_SECOND));
    const facts = sorted([effect.id, ...preconditions.map(fact => fact.id), ...pool.map(fact => fact.id), ...routes.map(fact => fact.id)]);
    const safety = p.kind === 'garrison-ready' ? [goalFact({ kind: 'site-safe', site: target, throughTick })] : [];
    return { id: `coarse-location:${goalValueKey([effect.id, refs, origin, target])}`, target, from: origin, cohort: refs,
      requiredForce: p.kind === 'garrison-ready'
        ? group.reduce((sum, member) => sum + effectiveCombatRating(context.snapshot, member.assessment), 0) : 0,
      byTick: throughTick, duration: known(p.kind === 'garrison-ready' ? Math.max(0, throughTick - context.tick) : Math.max(...clocks), facts),
      // Search bounds only. Exact refinement must replace both estimates;
      // these values are never a no-exposure or protection world proof.
      cost: known([], facts), successProbability: known(1, facts),
      preconditions: [...preconditions, ...pool, ...safety, ...routes], factIds: facts };
  }
  function defense(effect: GoalFact, group: readonly GoalCohortMember[], from: Target, site: Target, throughTick: number): GoalCandidates<GoalCombatOption> {
    const threat = context.situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === site.entityId);
    if (!threat) return pending('combat-site-threat-unpublished', [effect.id]);
    const byId = new Map(context.snapshot.units.map(unit => [unit.id, unit]));
    if (threat.attackers.some(row => !byId.has(row.unitId))) return pending('combat-opponent-shape-pending', threat.attackers.map(row => row.unitId));
    const enemy = threat.attackers.flatMap(row => byId.get(row.unitId) ? [byId.get(row.unitId)!] : []);
    const field = enemy.length ? { x: enemy.reduce((sum, unit) => sum + unit.x, 0) / enemy.length,
      y: enemy.reduce((sum, unit) => sum + unit.y, 0) / enemy.length } : from.point;
    const post: Target = { ...site, point: defenseGatherPost(site.point, field) };
    if (!isOpenGround(context.snapshot.map, post.point.x, post.point.y) || landIdAt(context.snapshot.map, post.point) !== site.landId)
      return unmet('combat-guard-post-ground-blocked', [effect.id]);
    const request = travel(effect, group, from, post, throughTick), windowTicks = Math.max(1, throughTick - context.tick);
    const ownTowers = targetCoveringTowers(context.snapshot, context.owner, post, 'own');
    const hostileTowers = targetCoveringTowers(context.snapshot, context.owner, site, 'opponent');
    const opponents: { unit: Unit; share: number }[] = [], scoped = threat.attackers.flatMap(row => {
      const unit = byId.get(row.unitId)!;
      if (!strategyIsOpponent(context.snapshot, context.owner, unit.owner)) return [];
      if (!('ticks' in row.arrival)) { opponents.push({ unit, share: 1 }); return [row]; }
      if (row.arrival.ticks >= windowTicks || unit.expiresTick !== undefined && unit.expiresTick <= context.tick + row.arrival.ticks) return [];
      const available = Math.min(windowTicks, (unit.expiresTick ?? Infinity) - context.tick) - row.arrival.ticks;
      const share = Math.max(0, Math.min(1, available / (windowTicks - row.arrival.ticks)));
      opponents.push({ unit, share });
      return [{ ...row, strength: row.strength * share / (1 + row.arrival.ticks / windowTicks) }];
    });
    const nativeRating = opponents.reduce((sum, row) => sum + effectiveCombatRating(context.snapshot, row.unit) * row.share, 0)
      + hostileTowers.reduce((sum, tower) => sum + structureRating(tower), 0);
    const requiredForce = Math.max(0, nativeRating * 1.25 - ownTowers.reduce((sum, tower) => sum + structureRating(tower), 0));
    // The whole threat model still uses its original field-strength currency.
    // This separate native combat-rating threshold never reuses that scalar.
    const assessed = assessGoalDefenseCombatOption({ snapshot: context.snapshot, situation: context.situation, effect, cohort: group,
      from, target: site, post, byTick: throughTick, routes: request.routes, arrivalTicks: request.arrivalTicks, movementRisk: movement(request),
      requiredCombatRating: known(requiredForce, [effect.id, ...opponents.map(row => row.unit.id)]),
      defense: throughTick > context.tick + threat.horizonTicks ? pending('combat-defense-window-uncovered', [effect.id]) : known({
        threat: defenseThreatScenarios({ ...threat, attackers: scoped }, ports.response?.(request) ?? { status: 'unknown' }),
        opponents, hostileTowers, windowTicks, staticForce: ownTowers.reduce((sum, tower) => sum + TOWER_STRENGTH * Math.max(0, tower.hp / Math.max(1, tower.maxHp)), 0),
        onStation: group.filter(member => gap(member.assessment, post.point) <= MINING_RALLY_RADIUS).map(member => member.reference),
      }, [effect.id, ...opponents.map(row => row.unit.id)]) });
    return assessed;
  }
  function garrison(effect: GoalFact, group: readonly GoalCohortMember[], from: Target, site: Target, throughTick: number): GoalCandidates<GoalCombatOption> {
    // A future hall need not have a present SiteThreat. Its garrison is the
    // same hold atom with an exact on-post force prerequisite, not a defense
    // macro which waits for a hall to exist before it can be declared.
    if (!site.landId) return pending('combat-guard-post-region-pending', [effect.id]);
    const post: Target = { landId: site.landId, point: defenseGatherPost(site.point, from.point) };
    if (!withinExpansionGarrisonCoverage(post.point, site.point)) return unmet('combat-guard-post-outside-mine-coverage', [effect.id]);
    if (!isOpenGround(context.snapshot.map, post.point.x, post.point.y) || landIdAt(context.snapshot.map, post.point) !== site.landId)
      return unmet('combat-guard-post-ground-blocked', [effect.id]);
    const safetyFact = goalFact({ kind: 'site-safe', site: post, throughTick }), safety = context.readFact(safetyFact);
    const requiredForce = group.reduce((sum, member) => sum + effectiveCombatRating(context.snapshot, member.assessment), 0);
    const ids = sorted([effect.id, safety.fact.id, ...safety.reason.factIds]);
    const unquoted = pending('garrison-post-protection-unpublished', ids, safety.state === 'pending' ? [safety.requestId] : ids);
    // A published safe full window proves that holding at this post has no
    // observed combat loss. Marching there belongs to force-at's achiever.
    const quiet = safety.state === 'met' && safety.fact.id === safetyFact.id && safety.observedTick === context.tick
      && (safety.availableTick ?? context.tick) <= context.tick && safety.threats !== undefined
      && !safety.threats.unitIds.length && !safety.threats.campIds.length && safety.threats.requiredForce === 0
      && !safety.derived?.allOf.length;
    const derived = safety.derived?.allOf ?? [];
    const clearedWindow = safety.state === 'unmet' && safety.reason.code === 'observed-safety-threats-present'
      && safety.fact.id === safetyFact.id && safety.observedTick === context.tick
      && (safety.availableTick ?? context.tick) <= context.tick && safety.threats !== undefined
      && !safety.threats.unitIds.length && safety.threats.requiredForce === 0 && safety.threats.campIds.length > 0
      && derived.length > 0 && derived.every(fact => fact.predicate.kind === 'camp-cleared')
      && safety.threats.campIds.every(campId => derived.some(fact => fact.predicate.kind === 'camp-cleared' && fact.predicate.campId === campId));
    const proof = sorted([...ids, ...(clearedWindow ? derived.map(fact => fact.id) : [])]);
    const cost: GoalCombatOption['cost'] = quiet || clearedWindow ? known([], proof) : unquoted;
    const successProbability = quiet || clearedWindow ? known(1, proof) : unquoted;
    return { state: 'met', candidates: [{ id: `combat-garrison:${goalValueKey([effect.id, post, group.map(m => m.reference)])}`,
      target: post, from, cohort: group.map(m => m.reference), requiredForce, byTick: throughTick,
      duration: known(Math.max(0, throughTick - context.tick), ids), cost, successProbability,
      preconditions: [safety.fact], factIds: proof }], factIds: proof };
  }
  function clearCamp(effect: GoalFact, group: readonly GoalCohortMember[], from: Target, campId: string, throughTick: number): GoalCandidates<GoalCombatOption> {
    const resolved = resolveGoalCamp(context.snapshot, campId);
    if (resolved.status !== 'present') return unmet(resolved.status === 'cleared' ? 'combat-camp-already-cleared' : 'combat-camp-binding-invalid', [campId]);
    const camp = resolved.exposure.camp, landId = landIdAt(context.snapshot.map, camp.center);
    if (!landId) return pending('combat-camp-region-pending', [effect.id, campId]);
    if (from.landId !== landId) return pending('combat-camp-source-transport-pending', [effect.id, campId]);
    const center = { x: group.reduce((sum, member) => sum + member.assessment.x, 0) / group.length,
      y: group.reduce((sum, member) => sum + member.assessment.y, 0) / group.length };
    const hall = context.snapshot.buildings.filter(building => building.owner === context.owner && building.hp > 0 && building.complete
      && building.kind === 'townHall' && landIdAt(context.snapshot.map, building) === landId)
      .sort((a, b) => gap(a, center) - gap(b, center) || (a.id < b.id ? -1 : 1))[0];
    const home = hall ? { x: hall.x, y: hall.y } : center;
    const unresolved: string[] = [], facts: string[] = [effect.id, campId];
    const project: CampApproachPointReader = point => {
      const projected = ports.readGroundPoint?.({ kind: 'project-goal', point, mover: 'land' });
      if (projected?.state === 'met') {
        facts.push(...projected.factIds);
        return landIdAt(context.snapshot.map, projected.value) === landId
          && goalCampStagingOutsideAlert(resolved.exposure, projected.value, group.map(member => member.assessment)) ? { status: 'known', point: projected.value }
          : { status: 'unreachable', reasonCode: 'combat-staging-region-mismatch' };
      }
      if (projected?.state === 'unmet') return { status: 'unreachable', reasonCode: projected.reason.code };
      const key = `combat-camp-staging:${goalValueKey([campId, point])}`;
      unresolved.push(...(projected?.state === 'pending' ? projected.requestIds : [key]));
      return { status: 'unknown', reasonCode: 'combat-staging-projection-pending' };
    };
    const approach = bootstrapCampApproach(context.snapshot, home, group.map(member => member.assessment), camp, from.point,
      neutralCampExposure(context.snapshot).camps.map(camp => camp.camp), (start, goal) => {
        const road = ports.landRoute(start, goal);
        if (road.status === 'unknown') unresolved.push(goalFact({ kind: 'route', mover: 'land',
          from: { landId, point: { x: start.x, y: start.y } }, to: { landId, point: { x: goal.x, y: goal.y } } }).id);
        return road;
      }, project);
    if (!approach) return unresolved.length ? pending('combat-camp-staging-pending', facts, unresolved)
      : unmet('combat-camp-staging-unreachable', facts);
    const staging: Target = { landId, point: approach.staging }, target: Target = { landId, point: camp.center };
    // Only this atom's post-to-contact leg is assessed. Gathering from the
    // actual origin is a separate force-at prerequisite, never billed twice.
    const staged = group.map(member => ({ ...member, assessment: { ...member.assessment, x: staging.point.x, y: staging.point.y } }));
    const routes = staged.map(member => context.readFact(goalFact({ kind: 'route', mover: 'land', actor: member.reference,
      from: staging, to: target })));
    const missing = routes.filter(row => row.state === 'pending'), failed = routes.find(row => row.state === 'unmet');
    const valid = routes.every(row => row.route?.ticks !== null && row.route?.ticks !== undefined && Number.isFinite(row.route.ticks) && row.route.ticks >= 0);
    const arrivalTicks: GoalEstimate<number> = failed ? { state: 'unmet', reason: failed.reason }
      : missing.length ? pending('combat-camp-contact-route-pending', routes.map(row => row.fact.id), missing.flatMap(row => row.state === 'pending' ? [row.requestId] : []))
      : valid ? known(Math.max(0, ...routes.map(row => row.route!.ticks!)), routes.map(row => row.fact.id))
      : pending('combat-camp-contact-clock-pending', routes.map(row => row.fact.id));
    const stagingFact = goalFact({ kind: 'camp-staging', campId, at: staging, cohort: group.map(member => member.reference) });
    const request: GoalCombatMovementRequest = { effect, cohort: staged, from: staging, target, routes, arrivalTicks, throughTick,
      campContact: { campId, stagingFact } };
    const result = assessGoalCampCombatOption({ snapshot: context.snapshot, situation: context.situation, effect, cohort: group,
      from, target, staging, campId, byTick: throughTick, routes, arrivalTicks, movementRisk: movement(request),
      stagingFacts: [context.readFact(stagingFact)], battleModel: campBattleModel });
    return result.state === 'met' ? { ...result, candidates: result.candidates.map(option => ({ ...option,
      factIds: sorted([...option.factIds, ...facts]) })), factIds: sorted([...result.factIds, ...facts]),
      ...(unresolved.length ? { deferred: [{ id: `combat-camp-staging-alternatives:${campId}`, requestIds: sorted(unresolved),
        reason: reason('combat-camp-staging-alternatives-pending', facts) }] } : {}) } : result;
  }
  function options(effect: GoalFact): GoalCandidates<GoalCombatOption> {
    const p = effect.predicate;
    if (p.kind === 'transport-at') {
      if (p.transport.kind !== 'existing') return pending('combat-actual-transport-binding-pending', [effect.id]);
      const actor = actors.get(p.transport.entityId);
      if (!actor || actor.owner !== context.owner || actor.hp <= 0 || !isTransportKind(actor.kind)
        || allowed && !allowed.has(actor.id) || interrupted.has(actor.id)) return unmet('combat-transport-not-available', [effect.id]);
      const sea = seaIdAt(context.snapshot.map, actor), profile = shipProfile(actor);
      if (!sea || !p.at.seaId || !profile) return pending('combat-transport-region-pending', [effect.id]);
      if (sea !== p.at.seaId) return unmet('combat-transport-other-basin', [effect.id]);
      const cargo = context.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === actor.id);
      const from: Target = { seaId: sea, point: { x: actor.x, y: actor.y } };
      if (context.precision === 'coarse') {
        const route = goalFact({ kind: 'route', mover: 'sea', actor: p.transport, from, to: p.at,
          ...(actor.sailing?.heading === undefined ? {} : { fromHeading: actor.sailing.heading }) });
        const duration = gap(actor, p.at.point) <= p.tolerance ? known(0, [effect.id])
          : ports.coarseSeaTicks?.(actor, from.point, p.at.point, false)
            ?? known(Math.ceil(gap(actor, p.at.point) / Math.max(1, actor.speed) * SIM_TICKS_PER_SECOND), [effect.id]);
        return { state: 'met', factIds: [effect.id], candidates: [{ id: `coarse-hull:${effect.id}`, target: p.at, from,
          cohort: [p.transport], requiredForce: 0, byTick: p.byTick,
          duration,
          cost: known([], [effect.id]), successProbability: known(1, [effect.id]), preconditions: [route], factIds: [effect.id, route.id] }] };
      }
      const hull: GoalHullCandidate = { id: actor.id, reference: p.transport, assessment: actor, seaId: sea, availableTick: context.tick,
        capacity: profile.loadCapacity - cargo.reduce((mass, unit) => mass + bodyMass(unit), 0),
        cargoUnitIds: sorted(cargo.map(unit => unit.id)), preconditions: [], factIds: [actor.id] };
      const heading = actor.sailing?.heading;
      const leg = Number.isFinite(heading) ? ports.transportFacts?.seaLeg(hull, { ...from.point, heading: heading! }, p.at.point, false)
        ?? pending('combat-transport-sea-leg-unpublished', [effect.id]) : pending('combat-transport-heading-pending', [effect.id]);
      const valuation = valueGoalSeaLeg({ snapshot: context.snapshot, owner: context.owner, hull, leg });
      const route = goalFact({ kind: 'route', mover: 'sea', actor: p.transport, from, to: p.at,
        ...(heading === undefined ? {} : { fromHeading: heading }) });
      return { state: 'met', candidates: [{ id: `combat-hull:${goalValueKey([effect.id, p.transport])}`, target: p.at, from,
        cohort: [p.transport], requiredForce: 0, byTick: p.byTick,
        duration: leg.state === 'met' ? known(leg.value.ticks, leg.factIds) : leg, ...valuation,
        preconditions: [route], factIds: sorted([effect.id, route.id, ...(leg.state === 'met' ? leg.factIds : leg.reason.factIds)]) }], factIds: [effect.id] };
    }
    if (!['site-safe', 'assets-safe', 'force-at', 'force-available', 'worker-at', 'garrison-ready', 'camp-cleared', 'gold'].includes(p.kind)) return unmet('not-naval-combat-effect', [effect.id]);
    if (p.kind === 'camp-cleared' || p.kind === 'gold') {
      const camps = p.kind === 'camp-cleared' ? [p.campId] : neutralCampExposure(context.snapshot).camps.map(camp => goalCampId(camp.memberIds)).sort();
      if (context.precision === 'coarse') {
        const groups = cohorts(effect); if (groups.state !== 'met') return groups;
        const candidates: GoalCombatOption[] = [], deferred: Deferred[] = [...(groups.deferred ?? [])];
        for (const campId of camps) for (const group of groups.candidates) {
          const answer = coarseGoalCampOptions({ snapshot: context.snapshot, situation: context.situation, effect,
            campId, cohort: group, byTick: 'byTick' in p ? p.byTick : (context.planThroughTick ?? context.tick + context.situation.horizonTicks),
            model: campBattleModel });
          if (answer.state === 'met') candidates.push(...answer.candidates);
          else if (answer.state === 'pending') deferred.push({ id: `coarse-camp:${campId}:${goalValueKey(group.map(member => member.reference))}`,
            requestIds: answer.requestIds, reason: answer.reason });
        }
        return choices(candidates, deferred, [effect.id, ...camps]);
      }
      const groups = origins(effect); if (groups.state !== 'met') return groups;
      const result: GoalCombatOption[] = [], deferred: Deferred[] = [...(groups.deferred ?? [])];
      for (const campId of camps) for (const origin of groups.candidates) {
        const group = origin.members, id = `combat-camp:${goalValueKey([campId, group.map(m => m.reference)])}${origin.preconditions.length ? `:${origin.id}` : ''}`;
        if (!origin.from.landId) {
          deferred.push({ id, requestIds: [id], reason: reason('combat-camp-land-origin-pending', [effect.id, campId]) }); continue;
        }
        const from = origin.from;
        const answer = clearCamp(effect, group, from, campId, 'byTick' in p ? p.byTick : (context.planThroughTick ?? context.tick + context.situation.horizonTicks));
        if (answer.state === 'met') { result.push(...answer.candidates.map(option => atOrigin(option, origin))); deferred.push(...(answer.deferred ?? [])); }
        else if (answer.state === 'pending') deferred.push({ id, requestIds: answer.requestIds, reason: answer.reason });
      }
      return choices(result, deferred, [effect.id, ...camps]);
    }
    const target = p.kind === 'site-safe' ? p.site : 'at' in p ? p.at : undefined;
    if (!target?.landId) return pending('combat-target-region-pending', [effect.id]);
    const throughTick = 'throughTick' in p ? p.throughTick : 'byTick' in p ? p.byTick : (context.planThroughTick ?? context.tick + context.situation.horizonTicks);
    const groups = origins(effect); if (groups.state !== 'met') return groups;
    const result: GoalCombatOption[] = [], deferred: Deferred[] = [...(groups.deferred ?? [])];
    let rejected: Extract<GoalCandidates<never>, { state: 'unmet' }> | undefined;
    for (const origin of groups.candidates) {
      const group = origin.members, id = `combat-location:${goalValueKey(group.map(m => m.reference))}${origin.preconditions.length ? `:${origin.id}` : ''}`, from = origin.from;
      if (context.precision === 'coarse' && ['garrison-ready', 'force-at', 'force-available', 'worker-at'].includes(p.kind)) {
        let option = coarseLocation(effect, group, from, target, throughTick, origin.preconditions);
        if ((p.kind === 'force-at' || p.kind === 'force-available') && p.metric === 'camp-force') {
          const camp = resolveGoalCamp(context.snapshot, p.campId);
          if (camp.status !== 'present') { rejected ??= unmet('combat-camp-binding-invalid', [p.campId]); continue; }
          option = { ...option, campId: p.campId,
            requiredForce: assessAllocatedForce(context.owner, [], { metric: 'camp-force', camp: camp.exposure.camp }).requiredForce };
        }
        result.push(option); continue;
      }
      if (from.landId !== target.landId) {
        if (p.kind === 'force-available' || p.kind === 'worker-at') {
          // A manifest is an input to transport grounding, not a priced land
          // march across water. The provider consumes each crossing's own
          // duration/cost/P and exact actual aboard/shore origin.
          const unquoted = pending('combat-transport-option-unquoted', [effect.id], [`${id}:crossing`]);
          result.push({ id: `${id}:transport`, target, from, cohort: group.map(member => member.reference), requiredForce: 0,
            byTick: throughTick, duration: unquoted, cost: unquoted, successProbability: unquoted, preconditions: [], factIds: [effect.id] });
          continue;
        }
        deferred.push({ id: `${id}:crossing`, requestIds: [`${id}:crossing`], reason: reason('combat-transport-arrival-pending', [effect.id]) }); continue;
      }
      if (p.kind === 'site-safe' || p.kind === 'garrison-ready') {
        const assessed = p.kind === 'garrison-ready' ? garrison(effect, group, from, target, throughTick) : defense(effect, group, from, target, throughTick);
        if (assessed.state === 'met') { result.push(...assessed.candidates.map(option => atOrigin(option, origin))); deferred.push(...(assessed.deferred ?? [])); }
        else if (assessed.state === 'pending') deferred.push({ id, requestIds: assessed.requestIds, reason: assessed.reason });
        else rejected ??= assessed;
      } else {
        const refs = group.map(member => member.reference);
        const actualPost = p.kind === 'force-at' && !origin.preconditions.length && group.every(member => {
          const unit = member.reference.kind === 'existing' ? actors.get(member.reference.entityId) : undefined;
          return !!unit && !unit.deck && !unit.cabin && landIdAt(context.snapshot.map, unit) === target.landId
            && gap(unit, target.point) <= ASSEMBLY_RANGE;
        });
        const presence = actualPost ? context.readFact(goalFact({ ...p, cohort: refs } as Extract<GoalFact['predicate'], { kind: 'force-at' }>)) : null;
        // Arrival means the native post tolerance, just as the world reader
        // and assembler completion do. Already present members need no march
        // to its mathematical centre. The paired pool/post flows still claim
        // the exact group; this observation does not add any opening balance.
        const present = presence?.state === 'met' && (presence.availableTick ?? context.tick) <= context.tick;
        const option = atOrigin(present ? { id: `combat-present:${presence.fact.id}`, from, target, cohort: refs,
          requiredForce: 0, byTick: throughTick, duration: known(0, [presence.fact.id]), cost: known([], [presence.fact.id]),
          successProbability: known(1, [presence.fact.id]), preconditions: [], factIds: [presence.fact.id] }
          : movingOption(travel(effect, group, from, target, throughTick)), origin);
        if ((p.kind === 'force-at' || p.kind === 'force-available') && p.metric === 'camp-force') {
          const camp = resolveGoalCamp(context.snapshot, p.campId);
          if (camp.status !== 'present') { rejected ??= unmet('combat-camp-binding-invalid', [p.campId]); continue; }
          result.push({ ...option, campId: p.campId, requiredForce: assessAllocatedForce(context.owner, [], { metric: 'camp-force', camp: camp.exposure.camp }).requiredForce });
        } else result.push(option);
      }
    }
    return !result.length && !deferred.length && rejected ? rejected : choices(result, deferred, [effect.id]);
  }
  return { combatOptions: effect => {
    let answer = memo.get(effect.id);
    if (!answer) { answer = options(effect); memo.set(effect.id, answer); }
    return answer;
  } };
}
