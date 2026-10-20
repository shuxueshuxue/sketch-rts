import { unitMover } from '../../../shared/catalog';
import { sameGround, walkableGoal } from '../../../shared/terrain';
import { bootstrapCampApproach } from '../../bootstrap_1/camp-geometry';
import { isOpponentOwner } from '../../policy/ownership';
import { averagePoint, distance } from '../../policy/spatial';
import { strengthOf } from '../../policy/v6/strength';
import { forceFor, V7_GATHERED_RANGE, type Camp } from '../../policy/v7/creep';
import { neutralCampExposure } from '../../situation/neutral-camp-exposure';
import { assessAllocatedForce } from '../allocated-force';
import type { ExecutorFeedback, JsonValue, StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, sameAction, validExecutorGrant } from '../executor-grants';

function point(value: JsonValue | undefined): { x: number; y: number } | undefined {
  return value && typeof value === 'object' && 'x' in value && 'y' in value
    && typeof value.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : undefined;
}

export const clearCampExecutor: StrategyExecutor = {
  id: 'strategy.clear-camp',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    if (input.execution.intent.kind !== 'clear-camp') return blockedExecutor(input, 'clearing-intent-required');
    const { snapshot, owner, execution } = input, base = executorFeedback(input);
    const ids = new Set(input.execution.intent.memberIds);
    const creeps = snapshot.units.filter(unit => unit.owner === 'neutral' && unit.hp > 0 && ids.has(unit.id));
    if (!creeps.length) return { ...base, status: 'complete', phase: 'cleared',
      progress: [{ kind: 'camp-cleared', unitIds: [], entityIds: [...ids], basis: 'observed-world' }] };
    const center = averagePoint(creeps.map(unit => ({ x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y })));
    const camp: Camp = { center, creeps, strength: strengthOf(creeps), reach: Math.max(...creeps.map(unit =>
      distance(center, { x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y }))) };
    const cohort = grantedUnits(input).filter(unit => unitMover(unit.kind) === 'land' && !unit.deck && unit.attackDamage > 0
      && unit.kind !== 'worker' && sameGround(snapshot.map, unit, center)
      && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    const power = assessAllocatedForce(owner, cohort, { metric: 'camp-force', camp });
    const engaged = execution.phase === 'engage';
    const preemptions = input.events.filter(event => event.kind === 'preempted' && sameAction(event.action, execution.token));
    const handoffs: ExecutorFeedback['handoffs'] = preemptions.map(event => ({ eventId: event.id,
      disposition: power.sufficient ? 'shrink' : 'pause' }));
    const fail = (reason: string): ExecutorFeedback => ({ ...blockedExecutor(input, reason, cohort.map(unit => unit.id)), handoffs });
    if (!cohort.length) return fail(preemptions.length ? 'clearing-party-preempted' : 'no-granted-clearing-units-on-target-land');
    if (!engaged && !power.sufficient) return fail(preemptions.length ? 'clearing-force-insufficient-after-preemption' : 'insufficient-clearing-force');
    if (engaged && power.force < camp.strength * .5) return fail('engaged-clearing-force-below-minimum');
    const hostile = snapshot.units.filter(unit => unit.hp > 0 && !unit.deck && isOpponentOwner(snapshot, owner, unit.owner, {})
      && sameGround(snapshot.map, unit, center) && (distance(unit, center) <= 900 || cohort.some(own => distance(unit, own) <= 900)));
    if (strengthOf(hostile) > strengthOf(cohort) * .5) return fail('enemy-force-at-clearing-party');
    const all = neutralCampExposure(snapshot).camps.map(fact => fact.camp)
      .filter(other => !other.creeps.some(creep => ids.has(creep.id)));
    all.push(camp);
    const from = averagePoint(cohort), transport = input.method.demands.find(demand => demand.kind === 'transport');
    const refuge = point(execution.state.refuge) ?? (transport?.kind === 'transport' ? transport.landing : from);
    const home = walkableGoal(snapshot.map, refuge.x, refuge.y);
    if (!sameGround(snapshot.map, home, center)) return fail('clearing-refuge-on-wrong-land');
    const staging = point(execution.state.staging) ?? bootstrapCampApproach(snapshot, home, cohort, camp, from, all)?.staging;
    if (!staging) return fail('clearing-geometry-blocked');
    const ready = cohort.filter(unit => distance(unit, staging) <= V7_GATHERED_RANGE && unit.hp >= unit.maxHp * .35);
    const gathered = assessAllocatedForce(owner, ready, { metric: 'camp-force', camp }).force >= forceFor(camp);
    const phase = engaged || gathered ? 'engage' : 'gather';
    const commands: ExecutorFeedback['commands'][number][] = [];
    for (const unit of cohort) {
      if (unit.order.type === 'cast' || unit.order.type === 'charge') continue;
      const retreating = phase === 'engage' && unit.hp < unit.maxHp * .35;
      if (phase === 'gather' || retreating) {
        if (distance(unit, staging) > V7_GATHERED_RANGE
          && !(unit.order.type === 'move' && distance(unit.order, staging) < 40))
          commands.push({ command: { type: 'move', unitIds: [unit.id], ...staging }, purpose: retreating ? 'life-saving' : 'task' });
        else if (distance(unit, staging) <= V7_GATHERED_RANGE && unit.order.type !== 'hold')
          commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: retreating ? 'life-saving' : 'task' });
      } else if (unit.order.type !== 'attack' && !(unit.order.type === 'attackMove' && distance(unit.order, center) < 140))
        commands.push({ command: { type: 'attackMove', unitIds: [unit.id], ...center }, purpose: 'task' });
    }
    return { ...base, status: 'active', phase, state: { ...execution.state, staging: { ...staging }, refuge: { ...home } }, commands, handoffs };
  },
};
