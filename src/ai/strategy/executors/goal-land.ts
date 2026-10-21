import { unitMover } from '../../../shared/catalog';
import type { Unit } from '../../../shared/types';
import type { ExecutorFeedback, ExecutorInput, StrategyExecutor } from '../allocation-types';
import { currentAllocationLandRouteReader } from '../allocation-arrival-query';
import { ASSEMBLY_RANGE } from '../assembly-posts';
import { blockedExecutor, executorFeedback } from '../executor-grants';
import { goalActionIntent, goalEntityIds, goalGrantedCohort, goalTarget } from '../goal-executor-parameters';
import { goalFact } from '../goal-facts';
import { strategyIsOpponent } from '../ownership';
import { landIdAt } from '../regions';

/** Atomic land orders only. Goal regression selected the target and exact
 * cohort; no force selection, training, target substitution or route fallback. */
function executor(kind: 'destroy-target' | 'hold-position' | 'engage-units'): StrategyExecutor {
  return { id: `goal.${kind}`, execute(input) {
    const intent = goalActionIntent(input, kind);
    if (!intent) return blockedExecutor(input, 'invalid-goal-land-grant');
    const at = goalTarget(intent.parameters.target), ids = goalEntityIds(intent.parameters.cohort);
    if (!at?.landId || !ids?.length) return blockedExecutor(input, 'goal-land-parameters-unresolved');
    const granted = goalGrantedCohort(input, ids), units = granted.units;
    if (granted.missingIds.length || units.some(unit => unitMover(unit.kind) !== 'land' || unit.deck || unit.cabin))
      return blockedExecutor(input, 'goal-land-cohort-not-granted', granted.missingIds);
    if (units.some(unit => landIdAt(input.snapshot.map, unit) !== at.landId))
      return blockedExecutor(input, 'goal-land-cohort-on-wrong-region', ids.slice());
    const base = executorFeedback(input), commands: ExecutorFeedback['commands'][number][] = [];
    const through = intent.parameters.throughTick;
    if (kind === 'hold-position') {
      if (typeof through !== 'number' || !Number.isFinite(through)) return blockedExecutor(input, 'goal-hold-window-invalid');
      const since = input.execution.state.goalHoldingSince;
      if (through <= input.snapshot.tick && typeof since !== 'number') return blockedExecutor(input, 'goal-hold-window-already-expired');
      if (units.some(unit => Math.hypot(unit.x - at.point.x, unit.y - at.point.y) > ASSEMBLY_RANGE))
        return blockedExecutor(input, 'goal-hold-cohort-not-on-post');
      const horizon = intent.parameters.protectionWindowTicks;
      let protection = {};
      if (typeof horizon === 'number') {
        if (!Number.isFinite(horizon) || horizon <= 0) return blockedExecutor(input, 'goal-hold-protection-window-invalid');
        const checkedThrough = Math.max(input.snapshot.tick, Math.min(through, input.snapshot.tick + horizon));
        const fact = goalFact({ kind: 'site-safe', site: at, throughTick: checkedThrough });
        const quote = typeof intent.parameters.garrisonMineId !== 'string' ? input.goalProtection?.('hold-position', at, ids, checkedThrough) : undefined;
        const observed = input.goalFacts?.(fact);
        if (quote ? quote.state !== 'met' : !observed || observed.fact.id !== fact.id || observed.observedTick !== input.snapshot.tick
          || observed.state !== 'met' || (observed.availableTick ?? input.snapshot.tick) > input.snapshot.tick)
          return blockedExecutor(input, (quote?.state ?? observed?.state) === 'unmet' ? 'goal-hold-protection-unmet' : 'goal-hold-protection-pending');
        const leaseThrough = Math.min(...ids.map(id => input.grant.leases.find(lease => lease.resourceKey === `unit:${id}`)?.minimumStayUntilTick ?? -1));
        if (leaseThrough < through) return blockedExecutor(input, 'goal-hold-protection-lease-too-short');
        if (units.every(unit => unit.order.type === 'hold')) protection = {
          goalProtectionCheckedTick: input.snapshot.tick, goalProtectionCheckedThrough: checkedThrough,
          goalProtectionLeaseThrough: leaseThrough, goalProtectionMemberIds: ids };
      }
      // The declaration requires actual force-at. Do not add an implicit move
      // and publish start control before this cohort is on its declared post.
      for (const unit of units) if (unit.order.type !== 'hold' && unit.order.type !== 'cast' && unit.order.type !== 'charge')
        commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: 'task' });
      const interrupted = units.some(unit => unit.order.type === 'cast' || unit.order.type === 'charge');
      const holding = units.every(unit => unit.order.type === 'hold');
      return { ...base, commands, state: { ...input.execution.state, ...protection,
        ...(holding ? { goalHoldingSince: typeof since === 'number' ? since : input.snapshot.tick } : {}) },
        status: input.snapshot.tick >= through && holding && !interrupted ? 'complete' : 'active', phase: 'holding-position' };
    }
    let targets: readonly (Unit | ExecutorInput['snapshot']['buildings'][number])[];
    if (kind === 'destroy-target') {
      if (!at.entityId) return blockedExecutor(input, 'goal-destroy-target-identity-required');
      const target = [...input.snapshot.units, ...input.snapshot.buildings].find(entity => entity.id === at.entityId);
      if (target && !strategyIsOpponent(input.snapshot, input.owner, target.owner))
        return blockedExecutor(input, 'goal-destroy-target-not-hostile');
      const fact = goalFact({ kind: 'enemy-site-destroyed', site: at }), observed = input.goalFacts?.(fact);
      if (target && target.hp <= 0 || observed?.state === 'met' && observed.observedTick === input.snapshot.tick && observed.fact.id === fact.id)
        return { ...base, status: 'complete', phase: 'hostile-target-destroyed' };
      if (!target) return blockedExecutor(input, 'goal-destroy-target-lifecycle-pending');
      targets = [target];
    } else {
      if (typeof through !== 'number' || !Number.isFinite(through)) return blockedExecutor(input, 'goal-engage-window-invalid');
      const named = intent.parameters.threatUnitIds;
      if (named !== undefined && (!Array.isArray(named) || named.some(id => typeof id !== 'string')))
        return blockedExecutor(input, 'goal-engage-threats-unresolved');
      const threatIds = named as readonly string[] | undefined;
      const ended = goalFact({ kind: 'harassment-ended', site: at, throughTick: through,
        ...(threatIds ? { unitIds: threatIds } : {}) }), actual = input.goalFacts?.(ended);
      if (actual?.state === 'met' && actual.observedTick === input.snapshot.tick && actual.fact.id === ended.id)
        return { ...base, status: 'complete', phase: 'harassment-ended-observed' };
      const capability = goalFact({ kind: 'interception-capability', site: at, throughTick: through,
        cohort: ids.map(entityId => ({ kind: 'existing', entityId })) });
      const observed = input.goalFacts?.(capability);
      if (!observed || observed.observedTick !== input.snapshot.tick || observed.fact.id !== capability.id || observed.state === 'pending')
        return blockedExecutor(input, 'goal-interception-capability-pending');
      if (observed.state !== 'met') return blockedExecutor(input, 'goal-interception-capability-unmet');
      targets = input.snapshot.units.filter(unit => observed.interception?.threatIds.includes(unit.id) && unit.hp > 0
        && (!threatIds || threatIds.includes(unit.id)) && strategyIsOpponent(input.snapshot, input.owner, unit.owner));
      if (!targets.length) return { ...base, status: 'active', phase: 'await-harassment-world-proof' };
    }
    const read = currentAllocationLandRouteReader();
    const pending: string[] = [], unreachable: string[] = [];
    for (const unit of units) {
      if (unit.order.type === 'cast' || unit.order.type === 'charge' || unit.attackDamage <= 0) continue;
      // Target choice is local within the explicitly bound threats, never a
      // global army/target selector. Stable IDs break equal-distance ties.
      const target = [...targets].sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!;
      const inRange = Math.hypot(target.x - unit.x, target.y - unit.y) <= unit.attackRange + unit.radius + target.radius;
      if (!inRange) {
        const route = read?.(unit, at.point);
        if (!route || route.status === 'unknown') { pending.push(unit.id); continue; }
        if (route.status === 'unreachable') { unreachable.push(unit.id); continue; }
      }
      if (!(unit.order.type === 'attack' && unit.order.targetId === target.id))
        commands.push({ command: { type: 'attack', unitIds: [unit.id], targetId: target.id }, purpose: 'task' });
    }
    return { ...base, commands, status: 'active', phase: 'engaging-bound-targets', reasons: pending.length || unreachable.length
      ? [{ executor: input.execution.executor, outcome: 'paused', reason: pending.length ? 'goal-land-route-pending' : 'goal-land-route-unreachable',
        unitIds: [...pending, ...unreachable] }] : [] };
  } };
}
export const goalDestroyTargetExecutor = executor('destroy-target');
export const goalHoldPositionExecutor = executor('hold-position');
export const goalEngageUnitsExecutor = executor('engage-units');
export const goalLandExecutors: readonly StrategyExecutor[] = [goalDestroyTargetExecutor, goalHoldPositionExecutor, goalEngageUnitsExecutor];
