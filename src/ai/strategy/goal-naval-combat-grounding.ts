import { unitMover } from '../../shared/catalog';
import { isOpenGround } from '../../shared/terrain';
import type { Unit } from '../../shared/types';
import { MINING_RALLY_RADIUS } from '../bootstrap_1/mining-rally';
import { effectiveCombatRating, structureRating, TOWER_STRENGTH } from '../policy/v6/strength';
import { targetCoveringTowers } from './allocated-force';
import type { AllocationArrivalReader, AllocationLandRouteReader } from './allocation-arrival-query';
import { defenseThreatScenarios, type DefenseResponse } from './defense-risk';
import { defenseGatherPost } from './executors/defend-site';
import { goalFact, goalValueKey } from './goal-facts';
import { assessGoalDefenseCombatOption, type GoalMovementRisk } from './goal-naval-assessment';
import type { GoalCandidates, GoalCohortMember, GoalCombatOption, GoalEntityReference, GoalEstimate,
  GoalFact, GoalFactObservation, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import { landIdAt } from './regions';
import type { Target } from './types';

type Deferred = NonNullable<Extract<GoalCandidates<never>, { state: 'met' }>['deferred']>[number];
export type GoalCombatMovementRequest = Readonly<{
  effect: GoalFact; cohort: readonly GoalCohortMember[]; from: Target; target: Target;
  routes: readonly GoalFactObservation[]; arrivalTicks: GoalEstimate<number>; throughTick: number;
}>;
export type GoalNavalCombatGroundingPorts = Readonly<{
  arrival: AllocationArrivalReader; landRoute: AllocationLandRouteReader;
  resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']>;
  movementRisk?: (request: GoalCombatMovementRequest) => GoalEstimate<GoalMovementRisk>;
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
  const allowed = ports.allowedUnitIds === undefined ? null : new Set(ports.allowedUnitIds);
  const interrupted = new Set(ports.interruptedUnitIds ?? []);
  const actors = new Map(context.snapshot.units.map(unit => [unit.id, unit]));
  const locations = new Map(context.situation.units.map(unit => [unit.id, unit.location]));
  const eligible = (unit: Unit) => unit.owner === context.owner && unit.hp > 0 && unit.expiresTick === undefined
    && unitMover(unit.kind) === 'land' && (!allowed || allowed.has(unit.id)) && !interrupted.has(unit.id);
  const units = context.snapshot.units.filter(eligible).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const memo = new Map<string, GoalCandidates<GoalCombatOption>>();
  function cohorts(effect: GoalFact): GoalCandidates<readonly GoalCohortMember[]> {
    const p = effect.predicate;
    const workers = p.kind === 'assets-safe' || p.kind === 'worker-at';
    const refs = p.kind === 'assets-safe' ? sorted(p.unitIds).map(entityId => ({ kind: 'existing' as const, entityId }))
      : p.kind === 'worker-at' && p.worker ? [p.worker]
      : p.kind === 'force-at' || p.kind === 'force-available' ? p.cohort : undefined;
    const groups: GoalEntityReference[][] = [];
    if (refs) groups.push([...refs]);
    else {
      const lands = new Map<string, Unit[]>();
      for (const unit of units.filter(unit => workers ? unit.kind === 'worker' : unit.kind !== 'worker' && unit.attackDamage > 0)) {
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
      const id = `combat-cohort:${goalValueKey(group)}`, bound = ports.resolveCohort(group);
      if (bound.state === 'pending') { deferred.push({ id, requestIds: bound.requestIds, reason: bound.reason }); continue; }
      if (bound.state !== 'met') continue;
      const members = [...new Map(bound.candidates.map(member => [goalValueKey(member.reference), member])).values()];
      if (goalValueKey(sorted(members.map(member => goalValueKey(member.reference)))) !== goalValueKey(sorted(group.map(goalValueKey)))) continue;
      // Actual references use actual weapons/HP/location. A resolver may not
      // substitute a healthier assessment copy for a currently existing unit.
      const exact = members.flatMap(member => {
        const actor = member.reference.kind === 'existing' ? actors.get(member.reference.entityId) : undefined;
        return actor && eligible(actor)
          && (workers ? actor.kind === 'worker' : actor.kind !== 'worker' && actor.attackDamage > 0)
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
  function options(effect: GoalFact): GoalCandidates<GoalCombatOption> {
    const p = effect.predicate;
    if (!['site-safe', 'assets-safe', 'force-at', 'force-available', 'worker-at', 'garrison-ready'].includes(p.kind)) return unmet('not-naval-combat-effect', [effect.id]);
    const target = p.kind === 'site-safe' ? p.site : 'at' in p ? p.at : undefined;
    if (!target?.landId) return pending('combat-target-region-pending', [effect.id]);
    const throughTick = 'throughTick' in p ? p.throughTick : 'byTick' in p ? p.byTick : context.tick + context.situation.horizonTicks;
    const groups = cohorts(effect); if (groups.state !== 'met') return groups;
    const result: GoalCombatOption[] = [], deferred: Deferred[] = [...(groups.deferred ?? [])];
    let rejected: Extract<GoalCandidates<never>, { state: 'unmet' }> | undefined;
    for (const group of groups.candidates) {
      const location = locations.get(group[0]!.assessment.id), id = `combat-location:${goalValueKey(group.map(m => m.reference))}`;
      if (location?.kind !== 'land' && location?.kind !== 'aboard' || group.some(member => {
        const other = locations.get(member.assessment.id);
        return location?.kind === 'land' ? other?.kind !== 'land' || other.landId !== location.landId
          : location?.kind === 'aboard' ? other?.kind !== 'aboard' || other.shipId !== location.shipId : true;
      })) { deferred.push({ id, requestIds: [id], reason: reason('combat-cohort-region-pending', [effect.id]) }); continue; }
      const from: Target = location.kind === 'land' ? { landId: location.landId, point: { ...location.point } }
        : { seaId: location.seaId, point: { ...location.point } };
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
        const assessed = defense(effect, group, from, target, throughTick);
        if (assessed.state === 'met') { result.push(...assessed.candidates); deferred.push(...(assessed.deferred ?? [])); }
        else if (assessed.state === 'pending') deferred.push({ id, requestIds: assessed.requestIds, reason: assessed.reason });
        else rejected ??= assessed;
      } else result.push(movingOption(travel(effect, group, from, target, throughTick)));
    }
    return !result.length && !deferred.length && rejected ? rejected : choices(result, deferred, [effect.id]);
  }
  return { combatOptions: effect => {
    let answer = memo.get(effect.id);
    if (!answer) { answer = options(effect); memo.set(effect.id, answer); }
    return answer;
  } };
}
