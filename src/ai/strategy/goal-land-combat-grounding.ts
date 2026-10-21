import { unitMover } from '../../shared/catalog';
import type { Building, Unit } from '../../shared/types';
import { effectiveCombatRating, structureRating } from '../policy/v6/strength';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { assessLandCombatAttrition, landCombatResponseCoverage, landCombatWorkTicks } from './land-combat-assessment';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalMovementRisk } from './goal-naval-assessment';
import type { GoalCombatMovementRequest, GoalNavalCombatGroundingPorts } from './goal-naval-combat-grounding';
import type { GoalCandidates, GoalCohortMember, GoalCohortOption, GoalCombatOption, GoalEstimate, GoalFact, GoalFactObservation,
  GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import type { Target } from './types';

type Deferred = NonNullable<Extract<GoalCandidates<never>, { state: 'met' }>['deferred']>[number];
export type GoalLandCombatGroundingPorts = Pick<GoalNavalCombatGroundingPorts,
  'arrival' | 'landRoute' | 'resolveCohort' | 'movementRisk' | 'allowedUnitIds' | 'interruptedUnitIds'>
  & Readonly<{ cohortOptions?: GoalGroundingReader['cohortOptions'] }>;
export type GoalLandOpponentArrival = Readonly<{ unitId: string; ticks: number | null }>;
export type GoalLandEngagementInput = Readonly<{
  context: GoalPlanningContext; request: GoalCombatMovementRequest;
  /** Executor/world-effect identity when contact occurs at a named threat. */
  actionTarget?: Target;
  /** Selected assembly prerequisite location, never the hostile building by default. */
  post?: Target;
  /** All observed hostile battle-role units, including known unreachable ones
   * (ticks=null). An omitted or unpublished responder is not zero opposition. */
  opponents: GoalEstimate<readonly GoalLandOpponentArrival[]>;
  movementRisk: GoalEstimate<GoalMovementRisk>;
}>;
const sorted = (items: readonly string[]) => [...new Set(items)].sort();
const reason = (code: string, factIds: readonly string[] = []) => ({ code, factIds: sorted(factIds), values: {} });
const known = <T>(value: T, factIds: readonly string[]): GoalEstimate<T> => ({ state: 'met', value, factIds: sorted(factIds) });
const pending = (code: string, ids: readonly string[], requests: readonly string[] = ids): Extract<GoalEstimate<never>, { state: 'pending' }> => ({
  state: 'pending', requestIds: sorted(requests.length ? requests : [`land-combat:${code}`]), reason: reason(code, ids),
});
const unmet = (code: string, ids: readonly string[] = []): Extract<GoalCandidates<never>, { state: 'unmet' }> => ({ state: 'unmet', reason: reason(code, ids) });
const battleRole = (unit: GoalPlanningContext['situation']['units'][number]) => unit.roles.some(role => role === 'frontline' || role === 'ranged' || role === 'caster');
function enemyPool(context: GoalPlanningContext) {
  return context.situation.units.filter(unit => unit.hp > 0 && battleRole(unit)
    && strategyIsOpponent(context.snapshot, context.owner, unit.owner));
}
function targetsFor(effect: GoalFact, context: GoalPlanningContext): GoalEstimate<readonly (Unit | Building)[]> {
  const p = effect.predicate;
  if (p.kind === 'route-controlled') return known([], [effect.id]);
  if (p.kind !== 'enemy-site-destroyed' && p.kind !== 'harassment-ended') return { state: 'unmet', reason: reason('not-land-combat-effect', [effect.id]) };
  const entity = [...context.snapshot.units, ...context.snapshot.buildings].find(unit => unit.id === p.site.entityId);
  if (p.kind === 'enemy-site-destroyed') return entity && entity.hp > 0 && entity.owner !== 'neutral'
    && strategyIsOpponent(context.snapshot, context.owner, entity.owner)
    ? known([entity], [effect.id]) : { state: 'unmet', reason: reason('land-combat-target-not-hostile', [effect.id]) };
  if (p.unitIds?.length) {
    const ids = sorted(p.unitIds);
    if (ids.length > 1) return pending('land-multi-target-engagement-unpublished', [effect.id, ...ids]);
    const named = context.snapshot.units.find(unit => unit.id === ids[0] && unit.hp > 0
      && strategyIsOpponent(context.snapshot, context.owner, unit.owner));
    return named ? known([named], [effect.id]) : pending('land-harassment-target-entity-pending', [effect.id, ...ids]);
  }
  const direct = context.snapshot.units.find(unit => unit.id === p.site.entityId && unit.hp > 0
    && strategyIsOpponent(context.snapshot, context.owner, unit.owner));
  if (direct) return known([direct], [effect.id]);
  const threat = context.situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === p.site.entityId);
  if (!threat || !threat.attackers.length) return pending('land-harassment-target-unpublished', [effect.id]);
  if (threat.attackers.length > 1) return pending('land-multi-target-engagement-unpublished', [effect.id, ...threat.attackers.map(row => row.unitId)]);
  const target = context.snapshot.units.find(unit => unit.id === threat.attackers[0]!.unitId && unit.hp > 0
    && strategyIsOpponent(context.snapshot, context.owner, unit.owner));
  return target ? known([target], [effect.id]) : pending('land-harassment-target-entity-pending', [effect.id]);
}

/** Exact-cohort adapter of the original land model, not defenseBattle. The
 * target's actual HP controls work time; field-strength controls the old P and
 * attrition formula. A separately measured combat-rating prerequisite never
 * relabels that field threshold. No target/army/route selector runs here. */
export function assessGoalLandEngagement(input: GoalLandEngagementInput): GoalCandidates<GoalCombatOption> {
  const { context, request } = input, { effect, cohort, target } = request;
  const p = effect.predicate;
  if (p.kind !== 'enemy-site-destroyed' && p.kind !== 'route-controlled' && p.kind !== 'harassment-ended') return unmet('not-land-combat-effect', [effect.id]);
  if (context.snapshot.tick !== context.tick || context.situation.tick !== context.tick || context.situation.owner !== context.owner)
    return pending('land-combat-epoch-pending', [effect.id]);
  const current = new Map(context.snapshot.units.map(unit => [unit.id, unit]));
  const unique = new Set(cohort.map(member => goalValueKey(member.reference)));
  if (!cohort.length || unique.size !== cohort.length) return unmet('land-combat-empty-or-duplicate-cohort', [effect.id]);
  const fighters = cohort.flatMap(member => {
    const raw = member.reference.kind === 'existing' ? current.get(member.reference.entityId) : undefined;
    return raw && raw.owner === context.owner && raw.hp > 0 && !raw.deck && !raw.cabin
      && unitMover(raw.kind) === 'land' && raw.kind !== 'worker' && raw.attackDamage > 0 ? [raw] : [];
  });
  if (cohort.some(member => member.reference.kind !== 'existing')) return pending('land-future-pool-projection-required', [effect.id]);
  if (fighters.length !== cohort.length) return unmet('land-combat-cohort-unavailable', [effect.id]);
  const ids = sorted([effect.id, ...request.routes.map(row => row.fact.id),
    ...(input.opponents.state === 'met' ? input.opponents.factIds : input.opponents.reason.factIds)]);
  const make = (estimates: Pick<GoalCombatOption, 'duration' | 'cost' | 'successProbability'>, requiredForce = 0): GoalCandidates<GoalCombatOption> => ({
    state: 'met', factIds: ids, candidates: [{ id: `land-combat:${goalValueKey([effect.id, cohort.map(member => member.reference), request.from, target])}`,
      target: input.actionTarget ?? target, ...(input.post ? { post: input.post } : {}), from: request.from,
      cohort: cohort.map(member => member.reference), requiredForce, byTick: request.throughTick,
      ...estimates, preconditions: request.routes.map(row => row.fact), factIds: ids }],
  });
  const unavailable = (estimate: Exclude<GoalEstimate<unknown>, { state: 'met' }>) => make({ duration: estimate, cost: estimate, successProbability: estimate });
  const targets = targetsFor(effect, context);
  if (targets.state !== 'met') return unavailable(targets);
  const unavailableRoute = request.routes.find(row => row.state !== 'met' || (row.availableTick ?? context.tick) > context.tick);
  if (unavailableRoute) return unavailable(unavailableRoute.state === 'unmet' ? { state: 'unmet', reason: unavailableRoute.reason }
    : pending('land-combat-route-pending', [unavailableRoute.fact.id], [unavailableRoute.state === 'pending' ? unavailableRoute.requestId : unavailableRoute.fact.id]));
  if (request.arrivalTicks.state !== 'met') return unavailable(request.arrivalTicks);
  if (!Number.isFinite(request.arrivalTicks.value) || request.arrivalTicks.value < 0 || !Number.isFinite(request.throughTick) || request.throughTick < context.tick)
    return unmet('land-combat-time-invalid', ids);
  if (input.opponents.state !== 'met') return unavailable(input.opponents);
  const arrivalTicks = request.arrivalTicks.value, holdingTicks = p.kind === 'route-controlled' ? p.throughTick - context.tick : undefined;
  if ([...fighters, ...targets.value].some(unit => ![unit.hp, unit.attackDamage, unit.attackCooldown].every(Number.isFinite)))
    return unavailable(pending('land-combat-native-stats-pending', ids));
  const workTicks = landCombatWorkTicks(targets.value, fighters, holdingTicks);
  // A continuing hold quotes observed combat only through the current
  // support horizon. Its action duration/through/lease remains the full
  // obligation and the executor must reassess protection on later thinks.
  const quoteWorkTicks = p.kind === 'route-controlled'
    ? Math.min(workTicks, Math.max(0, context.situation.horizonTicks - arrivalTicks)) : workTicks;
  const responseWindow = Math.min(context.situation.horizonTicks, arrivalTicks + quoteWorkTicks);
  if (arrivalTicks > context.situation.horizonTicks || p.kind !== 'route-controlled' && arrivalTicks + workTicks > context.situation.horizonTicks)
    return unavailable(pending('land-combat-response-window-uncovered', ids));
  const pool = enemyPool(context), observations = new Map(context.situation.units.map(unit => [unit.id, unit]));
  const arrivals = new Map(input.opponents.value.map(row => [row.unitId, row.ticks]));
  if (arrivals.size !== input.opponents.value.length || pool.length !== arrivals.size || pool.some(unit => !arrivals.has(unit.id))
    || input.opponents.value.some(row => row.ticks !== null && (!Number.isFinite(row.ticks) || row.ticks < 0)))
    return unavailable(pending('land-combat-responder-coverage-pending', ids));
  if (pool.some(unit => !current.has(unit.id))) return unavailable(pending('land-combat-responder-entity-pending', ids));
  const responders = pool.flatMap(unit => {
    const ticks = arrivals.get(unit.id)!;
    return ticks !== null && ticks <= responseWindow && (unit.expiresTick === null || unit.expiresTick > context.tick + ticks)
      ? [{ unit, raw: current.get(unit.id)!, ticks, coverage: landCombatResponseCoverage(context.tick, responseWindow, ticks, unit.expiresTick) }] : [];
  });
  // Exactly the original target-covering tower test. Incomplete batteries need
  // a published completion forecast; they must not silently disappear.
  const towers = context.snapshot.buildings.filter(building => building.hp > 0 && building.attackDamage > 0
    && strategyIsOpponent(context.snapshot, context.owner, building.owner)
    && Math.hypot(building.x - target.point.x, building.y - target.point.y) <= building.attackRange + building.radius);
  if (towers.some(tower => !tower.complete)) return unavailable(pending('land-combat-battery-completion-pending', ids));
  const requiredFieldStrength = responders.reduce((sum, row) => sum + row.unit.strength * row.coverage, 0)
    + towers.reduce((sum, tower) => sum + structureRating(tower), 0);
  const fieldStrength = fighters.reduce((sum, fighter) => sum + (observations.get(fighter.id)?.strength ?? 0), 0);
  if (fighters.some(fighter => !observations.has(fighter.id))) return unavailable(pending('land-combat-cohort-strength-pending', ids));
  const requiredForce = responders.reduce((sum, row) => sum + effectiveCombatRating(context.snapshot, row.raw) * row.coverage, 0)
    + towers.reduce((sum, tower) => sum + structureRating(tower), 0);
  const firing = [...responders.map(row => row.raw), ...towers, ...targets.value.filter(target => target.attackDamage > 0)];
  const assessed = assessLandCombatAttrition({ tick: context.tick, arrivalTicks, workTicks: quoteWorkTicks, fighters, fieldStrength, requiredFieldStrength,
    firing: firing.map(body => ({ body, arrivalTicks: arrivals.get(body.id) ?? null, expiresTick: observations.get(body.id)?.expiresTick ?? null })) });
  const duration = known(p.kind === 'route-controlled' ? workTicks : arrivalTicks + workTicks, ids), risk = input.movementRisk;
  if (risk.state !== 'met') return make({ duration, cost: risk, successProbability: risk }, requiredForce);
  if (!Number.isFinite(risk.value.expectedLossGold) || risk.value.expectedLossGold < 0 || !Number.isFinite(risk.value.survivalProbability)
    || risk.value.survivalProbability < 0 || risk.value.survivalProbability > 1) return unmet('land-combat-movement-risk-invalid', ids);
  return make({ duration, cost: known([
    { code: 'land-native-expected-attrition', gold: risk.value.survivalProbability * assessed.expectedLossGold, factIds: ids },
    { code: 'combat-movement-loss', gold: risk.value.expectedLossGold, factIds: ids },
  ], ids), successProbability: known(risk.value.survivalProbability * assessed.successProbability, ids) }, requiredForce);
}

/** Land-domain candidate source over this think's immutable observations and
 * published route/risk ports. It creates no Situation, query, work allowance,
 * macro chain, training order, future entity or second army selector. */
export function createGoalLandCombatGrounding(context: GoalPlanningContext, ports: GoalLandCombatGroundingPorts): Pick<GoalGroundingReader, 'combatOptions'> {
  const allowed = ports.allowedUnitIds === undefined ? null : new Set(ports.allowedUnitIds), interrupted = new Set(ports.interruptedUnitIds ?? []);
  const units = new Map(context.snapshot.units.map(unit => [unit.id, unit]));
  const eligible = (unit: Unit) => unit.owner === context.owner && unit.hp > 0 && unit.expiresTick === undefined && !unit.deck && !unit.cabin
    && unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0 && (!allowed || allowed.has(unit.id)) && !interrupted.has(unit.id);
  const groups = new Map<NonNullable<Target['landId']>, Unit[]>();
  for (const observed of [...context.situation.units].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const unit = units.get(observed.id);
    if (!unit || !eligible(unit) || observed.location.kind !== 'land') continue;
    const group = groups.get(observed.location.landId) ?? []; group.push(unit); groups.set(observed.location.landId, group);
  }
  const memo = new Map<string, GoalCandidates<GoalCombatOption>>();
  return { combatOptions(effect) {
    const retained = memo.get(effect.id); if (retained) return retained;
    const p = effect.predicate;
    if (p.kind !== 'enemy-site-destroyed' && p.kind !== 'route-controlled' && p.kind !== 'harassment-ended') return unmet('not-land-combat-effect', [effect.id]);
    const target = p.kind === 'route-controlled' ? p.at : p.site;
    if (!target.landId) return pending('land-combat-target-region-pending', [effect.id]);
    const throughTick = p.kind === 'enemy-site-destroyed' ? context.tick + context.situation.horizonTicks : p.throughTick;
    const choices: GoalCombatOption[] = [], deferred: Deferred[] = [], rejected: string[] = [], origins: GoalCohortOption[] = [];
    const shared = ports.cohortOptions?.(effect);
    if (shared?.state === 'met') { origins.push(...shared.candidates); deferred.push(...(shared.deferred ?? [])); }
    else if (shared?.state === 'pending') deferred.push({ id: `land-origins:${effect.id}`, requestIds: shared.requestIds, reason: shared.reason });
    else if (!shared) for (const [landId, group] of [...groups].sort(([a], [b]) => a < b ? -1 : 1)) {
      for (const selected of group.length > 1 ? [group, ...group.map(unit => [unit])] : [group]) origins.push({
        id: `land-cohort:${goalValueKey([effect.id, selected.map(unit => unit.id)])}`,
        from: { landId, point: { x: selected[0]!.x, y: selected[0]!.y } },
        members: selected.map(assessment => ({ reference: { kind: 'existing', entityId: assessment.id }, assessment })),
        preconditions: [], availableTick: context.tick, factIds: [effect.id],
      });
    }
    for (const origin of origins) {
        const id = origin.id, landId = origin.from.landId;
        if (!landId || landId !== target.landId) { deferred.push({ id, requestIds: [id],
          reason: reason('land-combat-crossing-projection-pending', [effect.id, ...origin.factIds]) }); continue; }
        if (origin.members.some(member => member.reference.kind !== 'existing') || origin.availableTick === null || origin.availableTick > context.tick) {
          deferred.push({ id, requestIds: [id], reason: reason('land-future-pool-projection-required', [effect.id, ...origin.factIds]) }); continue;
        }
        const refs = origin.members.flatMap(member => member.reference.kind === 'existing' ? [member.reference] : []);
        if (!refs.length || sorted(refs.map(goalValueKey)).length !== refs.length || refs.some(reference => {
          const unit = units.get(reference.entityId), location = context.situation.units.find(unit => unit.id === reference.entityId)?.location;
          return !unit || !eligible(unit) || location?.kind !== 'land' || location.landId !== landId;
        })) { rejected.push(...origin.factIds); continue; }
        const resolved = ports.resolveCohort(refs);
        if (resolved.state === 'pending') { deferred.push({ id, requestIds: resolved.requestIds, reason: resolved.reason }); continue; }
        if (resolved.state !== 'met') { rejected.push(...resolved.reason.factIds); continue; }
        const bound = sorted(resolved.candidates.map(member => goalValueKey(member.reference)));
        if (goalValueKey(bound) !== goalValueKey(sorted(refs.map(goalValueKey)))) { deferred.push({ id, requestIds: [id], reason: reason('land-combat-cohort-resolution-pending', [effect.id]) }); continue; }
        const cohort: GoalCohortMember[] = refs.map(reference => ({ reference, assessment: units.get(reference.entityId)! }));
        const from: Target = origin.from;
        const post = p.kind === 'route-controlled' ? target : from;
        const stationary = p.kind === 'route-controlled';
        const onPost = cohort.every(member => Math.hypot(member.assessment.x - post.point.x, member.assessment.y - post.point.y) <= ASSEMBLY_RANGE);
        const contact = targetsFor(effect, context), targetBody = contact.state === 'met' && contact.value.length === 1 ? contact.value[0] : undefined;
        const contactTarget: Target = targetBody ? { entityId: targetBody.id, landId, point: { x: targetBody.x, y: targetBody.y } } : target;
        const alreadyInRange = !stationary && !!targetBody && cohort.every(member => Math.hypot(member.assessment.x - targetBody.x,
          member.assessment.y - targetBody.y) <= member.assessment.attackRange + member.assessment.radius + targetBody.radius);
        // force-at is the assembler's obligation. A primitive never charges
        // current -> post again. Only its own post -> engagement movement is
        // priced; future unposted cohorts need the shared projected quote.
        const noMarch = stationary || onPost && alreadyInRange;
        const routes = noMarch ? [] : cohort.map(member => context.readFact(goalFact({ kind: 'route', mover: 'land', actor: member.reference,
          from: { landId, point: onPost ? { x: member.assessment.x, y: member.assessment.y } : post.point }, to: contactTarget })));
        let timing: GoalEstimate<number> = known(0, routes.map(row => row.fact.id));
        const pendingRoutes = routes.filter(row => row.state === 'pending' || row.state === 'met' && (row.availableTick ?? context.tick) > context.tick);
        const failed = routes.find(row => row.state === 'unmet');
        if (!stationary && !onPost) timing = pending('land-primitive-from-post-geometry-pending', [effect.id, ...origin.factIds], [origin.id]);
        else if (noMarch) timing = known(0, [effect.id]);
        else if (failed) timing = { state: 'unmet', reason: failed.reason };
        else if (pendingRoutes.length) timing = pending('land-combat-route-pending', routes.map(row => row.fact.id),
          pendingRoutes.map(row => row.state === 'pending' ? row.requestId : row.fact.id));
        else for (const member of cohort) {
          const route = ports.landRoute(member.assessment, contactTarget.point);
          if (route.status !== 'known') { timing = route.status === 'unreachable' ? { state: 'unmet', reason: reason('land-combat-route-unreachable', [effect.id]) }
            : pending('land-combat-route-pending', routes.map(row => row.fact.id)); break; }
          const arrival = ports.arrival(member.assessment, contactTarget);
          if (arrival.status !== 'reachable' || arrival.crossings.length) { timing = arrival.status === 'unreachable'
            ? { state: 'unmet', reason: reason('land-combat-route-unreachable', [effect.id]) } : pending('land-combat-arrival-pending', routes.map(row => row.fact.id)); break; }
          timing = known(Math.max(timing.state === 'met' ? timing.value : 0, arrival.ticks), routes.map(row => row.fact.id));
        }
        const request: GoalCombatMovementRequest = { effect, cohort, from: post, target: contactTarget, routes, arrivalTicks: timing, throughTick };
        const risk = noMarch ? known({ expectedLossGold: 0, survivalProbability: 1 }, [effect.id]) : timing.state !== 'met' ? timing
          : ports.movementRisk?.(request) ?? pending('land-combat-movement-risk-unquoted', [effect.id], routes.map(row => row.fact.id));
        const responseRows: GoalLandOpponentArrival[] = [], responseFacts: GoalFactObservation[] = [], unresolvedResponse: string[] = [];
        const crossingResponse = (raw: Unit) => {
          const arrival = ports.arrival(raw, contactTarget);
          if (arrival.status === 'reachable') responseRows.push({ unitId: raw.id, ticks: arrival.ticks });
          else if (arrival.status === 'unreachable') responseRows.push({ unitId: raw.id, ticks: null });
          else unresolvedResponse.push(...(arrival.status === 'conditional' ? arrival.unmet.flatMap(reason => reason.factIds ?? []) : arrival.reason.factIds ?? []),
            `land-response-crossing:${raw.id}:${effect.id}`);
        };
        for (const enemy of enemyPool(context)) {
          const raw = units.get(enemy.id);
          if (!raw) { unresolvedResponse.push(enemy.id); continue; }
          if (enemy.location.kind !== 'land' || enemy.location.landId !== target.landId || raw.deck || raw.cabin) {
            crossingResponse(raw); continue;
          }
          const enemyFrom: Target = { ...(enemy.location.kind === 'land' ? { landId: enemy.location.landId } : {}), point: { x: raw.x, y: raw.y } };
          const route = context.readFact(goalFact({ kind: 'route', mover: 'land', actor: { kind: 'existing', entityId: raw.id }, from: enemyFrom, to: contactTarget }));
          responseFacts.push(route);
          if (route.state === 'unmet') responseRows.push({ unitId: raw.id, ticks: null });
          else if (route.state === 'met' && (route.availableTick ?? context.tick) <= context.tick && route.route?.ticks !== null && route.route?.ticks !== undefined)
            responseRows.push({ unitId: raw.id, ticks: route.route.ticks });
        }
        const missing = responseFacts.filter(row => row.state === 'pending' || row.state === 'met' && ((row.availableTick ?? context.tick) > context.tick || row.route?.ticks === null || row.route?.ticks === undefined));
        const opponents: GoalLandEngagementInput['opponents'] = missing.length || unresolvedResponse.length ? pending('land-combat-opponent-arrival-pending', responseFacts.map(row => row.fact.id),
          [...missing.map(row => row.state === 'pending' ? row.requestId : row.fact.id), ...unresolvedResponse]) : known(responseRows, responseFacts.map(row => row.fact.id));
        const assessed = assessGoalLandEngagement({ context, request, post, actionTarget: target, opponents, movementRisk: risk });
        if (assessed.state === 'met') choices.push(...assessed.candidates.map(option => ({ ...option,
          preconditions: [...new Map([...origin.preconditions, ...option.preconditions].map(fact => [fact.id, fact])).values()],
          factIds: sorted([...option.factIds, ...origin.factIds]),
        })));
        else if (assessed.state === 'pending') deferred.push({ id, requestIds: assessed.requestIds, reason: assessed.reason });
        else rejected.push(...assessed.reason.factIds);
    }
    // Future pool members are resolved by the central projection. Their absence
    // here does not prove that training/transport can never satisfy the goal.
    if (!shared) deferred.push({ id: `land-future:${effect.id}`, requestIds: [`land-future:${effect.id}`], reason: reason('land-future-pool-projection-required', [effect.id]) });
    const result: GoalCandidates<GoalCombatOption> = choices.length ? { state: 'met', candidates: choices, factIds: [effect.id], deferred }
      : deferred.length ? pending('land-combat-candidate-facts-pending', [effect.id, ...rejected], deferred.flatMap(row => row.requestIds))
      : unmet('land-combat-no-eligible-cohort', [effect.id, ...rejected]);
    memo.set(effect.id, result); return result;
  } };
}
