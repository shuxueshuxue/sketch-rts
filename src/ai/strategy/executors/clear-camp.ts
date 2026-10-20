import { unitMover } from '../../../shared/catalog';
import { sameGround, walkableGoal, walkingDistance } from '../../../shared/terrain';
import { bootstrapCampApproach } from '../../bootstrap_1/camp-geometry';
import { averagePoint, distance } from '../../policy/spatial';
import { V7_GATHERED_RANGE } from '../../policy/v7/creep';
import { neutralCampExposure } from '../../situation/neutral-camp-exposure';
import { assessPresentCampEngagement } from '../allocated-force';
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
    const cohort = grantedUnits(input).filter(unit => unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin && unit.attackDamage > 0
      && unit.kind !== 'worker' && sameGround(snapshot.map, unit, execution.target.point)
      && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    const assess = (unitIds: readonly string[]) => assessPresentCampEngagement({ snapshot, owner, target: execution.target,
      unitIds, campMemberIds: [...ids], radius: 650 });
    const power = assess(cohort.map(unit => unit.id)), { camp, hostile } = power, { center, creeps } = camp;
    // Native absence of the camp is not proof that its player opposition died.
    // The parent still sees living players in every subsequent asset-risk quote.
    if (!creeps.length && !hostile.length && !power.towers.length) return { ...base, status: 'complete', phase: 'beachhead-clear',
      state: { ...execution.state, remainingPlayerThreatIds: [] },
      progress: [{ kind: 'camp-cleared', unitIds: cohort.map(unit => unit.id), entityIds: [...ids], basis: 'observed-world' }] };
    const engaged = execution.phase === 'engage';
    const preemptions = input.events.filter(event => event.kind === 'preempted' && sameAction(event.action, execution.token));
    const handoffs: ExecutorFeedback['handoffs'] = preemptions.map(event => ({ eventId: event.id,
      disposition: power.sufficient ? 'shrink' : 'pause' }));
    const fail = (reason: string): ExecutorFeedback => {
      const refuge = point(execution.state.staging) ?? point(execution.state.refuge);
      const leaving = engaged && refuge ? cohort.filter(unit => unit.order.type !== 'cast' && unit.order.type !== 'charge'
        && walkingDistance(snapshot.map, unit, refuge) !== undefined) : [];
      return { ...blockedExecutor(input, reason, cohort.map(unit => unit.id)), handoffs,
        ...(leaving.length && refuge ? { phase: 'retreat', commands: leaving.filter(unit => !(unit.order.type === 'move'
          && unit.order.avoidCombat && distance(unit.order, refuge) < 40)).map(unit => ({ command: {
            type: 'move' as const, unitIds: [unit.id], ...refuge, avoidCombat: true }, purpose: 'life-saving' as const })) } : {}) };
    };
    if (!cohort.length) return fail(preemptions.length ? 'clearing-party-preempted' : 'no-granted-clearing-units-on-target-land');
    if (!engaged && !power.sufficient) return fail(preemptions.length ? 'clearing-force-insufficient-after-preemption' : 'insufficient-clearing-force');
    if (engaged && power.ourForce < power.actualOpponentForce) return fail('engaged-clearing-force-below-actual-opposition');
    if (!creeps.length && power.towers.length) return fail('enemy-structure-controls-beachhead');
    const all = neutralCampExposure(snapshot).camps.map(fact => fact.camp)
      .filter(other => !other.creeps.some(creep => ids.has(creep.id)));
    if (creeps.length) all.push(camp);
    const from = averagePoint(cohort), transport = input.method.demands.find(demand => demand.kind === 'transport');
    const refuge = point(execution.state.refuge) ?? (transport?.kind === 'transport' ? transport.landing : from);
    const home = walkableGoal(snapshot.map, refuge.x, refuge.y);
    if (!sameGround(snapshot.map, home, center)) return fail('clearing-refuge-on-wrong-land');
    const staging = point(execution.state.staging) ?? (creeps.length ? bootstrapCampApproach(snapshot, home, cohort, camp, from, all)?.staging
      : walkingDistance(snapshot.map, from, center) !== undefined ? walkableGoal(snapshot.map, center.x, center.y) : undefined);
    if (!staging) return fail('clearing-geometry-blocked');
    if (engaged && ![...creeps, ...hostile].some(unit => distance(unit, center) <= 650)
      && !power.towers.length) return fail('clearing-target-outside-beachhead-leash');
    const ready = cohort.filter(unit => distance(unit, staging) <= V7_GATHERED_RANGE && unit.hp >= unit.maxHp * .35);
    const gathered = assess(ready.map(unit => unit.id)).sufficient;
    const phase = engaged || gathered ? 'engage' : 'gather';
    const commands: ExecutorFeedback['commands'][number][] = [];
    for (const unit of cohort) {
      if (unit.order.type === 'cast' || unit.order.type === 'charge') continue;
      const retreating = phase === 'engage' && unit.hp < unit.maxHp * .35;
      if (phase === 'gather' || retreating || distance(unit, center) > 650) {
        if (distance(unit, staging) > V7_GATHERED_RANGE
          && !(unit.order.type === 'move' && distance(unit.order, staging) < 40))
          commands.push({ command: { type: 'move', unitIds: [unit.id], ...staging, avoidCombat: true }, purpose: retreating ? 'life-saving' : 'task' });
        else if (distance(unit, staging) <= V7_GATHERED_RANGE && unit.order.type !== 'hold')
          commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: retreating ? 'life-saving' : 'task' });
      } else {
        const target = [...hostile, ...creeps].filter(target => distance(target, center) <= 650)
          .sort((a, b) => distance(unit, a) - distance(unit, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
        if (target && !(unit.order.type === 'attack' && unit.order.targetId === target.id))
          commands.push({ command: { type: 'attack', unitIds: [unit.id], targetId: target.id }, purpose: 'task' });
        else if (!target && unit.order.type !== 'hold') commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: 'task' });
      }
    }
    return { ...base, status: 'active', phase, state: { ...execution.state, staging: { ...staging }, refuge: { ...home },
      remainingPlayerThreatIds: hostile.map(unit => unit.id).sort() }, commands, handoffs };
  },
};
