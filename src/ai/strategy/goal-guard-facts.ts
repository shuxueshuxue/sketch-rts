import { GOLD_MINE_RULES } from '../../shared/mining';
import { structureRating } from '../policy/v6/strength';
import { withinExpansionGarrisonCoverage } from '../bootstrap_1/expansion-garrison-rules';
import { allocationGrants } from './allocation-lifecycle';
import type { StrategyAllocationMemory } from './allocation-types';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { sameAction } from './control';
import { goalEntityIds, goalTarget } from './goal-executor-parameters';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import { landIdAt } from './regions';
import type { Target } from './types';
import { readGoalIntent } from './goal-authority-references';

const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const sameSite = (a: Target, b: Target) => a.entityId === b.entityId && a.landId === b.landId
  && a.point.x === b.point.x && a.point.y === b.point.y;

/** An ongoing protection obligation is observed from the real cohort, native
 * post, current grant and retained leases together. A foundation, accepted
 * command or executor state alone cannot prove the world effect. */
export function readGoalGuardFact(fact: GoalFact, context: GoalPlanningContext, authority: StrategyAllocationMemory | undefined,
  allowedUnitIds?: readonly string[], interruptedUnitIds: readonly string[] = []): GoalFactObservation | null {
  const p = fact.predicate;
  if (p.kind !== 'garrison-ready' || !authority || authority.owner !== context.owner || authority.evaluatedTick > context.tick) return null;
  const target = p.at;
  if (!target.landId || context.snapshot.tick !== context.tick || context.situation.tick !== context.tick) return null;
  const allowed = allowedUnitIds === undefined ? null : new Set(allowedUnitIds), interrupted = new Set(interruptedUnitIds);
  let uncovered: GoalFactObservation | null = null;
  const outside = (code: string, post: Target, ids: readonly string[] = []): GoalFactObservation => ({
    fact, state: 'unmet', observedTick: context.tick, revision: goalValueKey([fact.id, code, post, ids]), evidence: [], entityIds: [],
    reason: { code, factIds: [fact.id, ...ids], values: { postToMine: gap(post.point, target.point) } },
  });
  for (const grant of allocationGrants(authority)) {
    const execution = authority.executions[grant.action.actionId], intent = execution?.intent;
    if (!execution || execution.status !== 'active' || intent?.kind !== 'goal-action'
      || intent.actionKind !== 'hold-position' || !sameAction(execution.token, grant.action)
      || authority.methods[execution.methodId]?.kind !== 'goal-plan') continue;
    const params = readGoalIntent(authority, intent).parameters, post = goalTarget(params.target), protectedSite = goalTarget(params.garrisonAt);
    const through = params.throughTick, since = execution.state.goalHoldingSince;
    if (!post?.landId || !protectedSite || typeof through !== 'number' || !Number.isFinite(through) || through <= context.tick
      || typeof since !== 'number' || !Number.isFinite(since) || since > context.tick || since < execution.sinceTick) continue;
    if (params.garrisonMineId !== p.mineId || !sameSite(protectedSite, target)) continue;
    if (post.landId !== target.landId || !withinExpansionGarrisonCoverage(post.point, target.point)) {
      uncovered = outside('garrison-post-outside-mine-coverage', post); continue;
    }
    const ids = goalEntityIds(params.cohort);
    if (!ids?.length || ids.some(id => allowed && !allowed.has(id) || interrupted.has(id))) continue;
    const members = ids.map(id => context.snapshot.units.find(unit => unit.id === id));
    if (members.some(unit => !unit || unit.owner !== context.owner || unit.hp <= 0 || unit.expiresTick !== undefined || unit.deck || unit.cabin
      || unit.order.type !== 'hold'
      || landIdAt(context.snapshot.map, unit) !== post.landId || gap(unit, post.point) > ASSEMBLY_RANGE)) continue;
    if (members.some(unit => !withinExpansionGarrisonCoverage(unit!, target.point))) {
      uncovered = outside('garrison-cohort-outside-mine-coverage', post, ids); continue;
    }
    if (ids.some(id => {
      const lease = authority.leases[`unit:${id}`], assignment = authority.assignments[`assignment:${id}`];
      return !lease || lease.origin !== 'allocator' || lease.objectiveId !== grant.objectiveId || !sameAction(lease.action, grant.action)
        || lease.minimumStayUntilTick < through || !assignment || !sameAction(assignment.action, grant.action) || assignment.interruption;
    })) continue;
    const observed = ids.map(id => context.situation.units.find(unit => unit.id === id));
    if (observed.some(unit => !unit || !unit.roles.some(role => role === 'frontline' || role === 'ranged')
      || unit.roles.some(role => role === 'worker' || role === 'caster' || role === 'healer'))) continue;
    const hall = context.readFact(goalFact({ kind: 'hall-complete', mineId: p.mineId, at: p.at }));
    if (hall.state !== 'met' || hall.observedTick !== context.tick || (hall.availableTick ?? context.tick) > context.tick) continue;
    const actualHall = context.snapshot.buildings.find(building => building.owner === context.owner
      && building.kind === 'townHall' && building.hp > 0 && building.complete && landIdAt(context.snapshot.map, building) === target.landId
      && gap(building, target.point) <= GOLD_MINE_RULES.baseRange);
    if (!actualHall) continue;
    const threat = context.situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === actualHall.id);
    if (threat?.attackers.some(attacker => !('ticks' in attacker.arrival))) continue;
    const arrivals = [...(threat?.attackers ?? [])].filter(attacker => 'ticks' in attacker.arrival && context.tick + attacker.arrival.ticks <= through)
      .sort((a, b) => ('ticks' in a.arrival ? a.arrival.ticks : 0) - ('ticks' in b.arrival ? b.arrival.ticks : 0) || a.unitId.localeCompare(b.unitId));
    // Preserve the ordinary mining handoff's two-raider threshold. This is a
    // garrison handoff, not proof that every future site threat is destroyed.
    const required = arrivals.slice(0, 2).reduce((sum, row) => sum + row.strength, 0);
    const staticPower = context.snapshot.buildings.filter(building => building.owner === context.owner && building.hp > 0
      && building.complete && building.attackDamage > 0 && gap(building, actualHall) <= building.attackRange + actualHall.radius
      && gap(building, target.point) <= building.attackRange).reduce((sum, building) => sum + structureRating(building), 0);
    const power = observed.reduce((sum, unit) => sum + unit!.strength, 0) + staticPower;
    if (power <= 0 || power < required) continue;
    return { fact, state: 'met', observedTick: context.tick, availableTick: context.tick, quantity: power, entityIds: ids,
      revision: goalValueKey([fact.id, grant.action, since, through, members.map(unit => [unit!.id, unit!.hp, unit!.x, unit!.y]),
        power, required, hall.revision, ids.map(id => authority.leases[`unit:${id}`])]), evidence: [],
      reason: { code: 'observed-formal-guard-obligation', factIds: [fact.id, grant.action.actionId, hall.fact.id],
        values: { supportedThroughTick: through, assumesObservedMembership: true, assumesNoNewOrdersOrThreats: true,
          nativePostObserved: true, retainedLease: true, fieldStrength: power, requiredFieldStrength: required } } };
  }
  return uncovered;
}
