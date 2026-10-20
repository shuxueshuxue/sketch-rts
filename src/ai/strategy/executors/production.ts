import { UNIT_DEFS } from '../../../shared/catalog';
import { sameGround, walkableGoal } from '../../../shared/terrain';
import { distance } from '../../policy/spatial';
import type { StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, sameAction, validExecutorGrant } from '../executor-grants';
import { seaIdAt } from '../regions';

/** Production consumes one explicitly leased queue and a registered capital
 * grant. The native queue/payment and the later unique birth are distinct facts. */
export function nativeProductionExecutor(kind: 'worker' | 'transport'): StrategyExecutor {
  const boat = kind === 'transport', buildingKind = boat ? 'shipyard' : 'townHall';
  const name = boat ? 'transport' : 'worker', intent = boat ? 'train-transport' : 'train-worker';
  const knownKey = boat ? 'knownHullIds' : 'knownUnitIds';
  return {
    id: `strategy.${intent}`,
    execute(input) {
      if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
      const { snapshot, owner, execution, grant } = input, base = executorFeedback(input);
      if (execution.intent.kind !== intent) return blockedExecutor(input, 'production-intent-mismatch');
      const queueIds = new Set(grant.leases.filter(lease => lease.resourceKey.startsWith('queue:')
        && lease.objectiveId === input.objective.id && sameAction(lease.action, execution.token))
        .map(lease => lease.resourceKey.slice(6)));
      const building = snapshot.buildings.find(building => queueIds.has(building.id) && building.id === execution.target.entityId
        && building.owner === owner && building.complete && building.hp > 0 && building.kind === buildingKind);
      if (!building) return blockedExecutor(input, boat ? 'no-granted-complete-shipyard' : 'no-granted-complete-worker-production');
      const units = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && unit.kind === kind);
      const previousUnits = execution.state[knownKey], known = Array.isArray(previousUnits) ? previousUnits : [];
      const command = grant.commands.find(entry => entry.command.type === 'train' && entry.command.buildingId === building.id
        && entry.command.unitKind === kind && sameAction(entry.action, execution.token));
      const baseline = command?.worldBefore?.kind === 'production' ? command.worldBefore.jobs
        : Array.isArray(execution.state.nativeQueueBefore) ? execution.state.nativeQueueBefore : undefined;
      const observed = execution.state.observedNativeJobId;
      const job = building.queue.find((job, index) => {
        if (!('unitKind' in job) || job.unitKind !== kind) return false;
        if (typeof observed === 'string') return job.id === observed;
        if (!baseline) return false;
        return job.id ? !baseline.some(previous => previous && typeof previous === 'object' && 'id' in previous && previous.id === job.id)
          : index >= baseline.length;
      });
      if (execution.state.observedProduction === true && !job) {
        const elapsed = snapshot.tick - (typeof execution.state.productionObservedTick === 'number' ? execution.state.productionObservedTick : snapshot.tick);
        const remaining = typeof execution.state.nativeRemainingTicks === 'number' ? execution.state.nativeRemainingTicks : 0;
        if (elapsed < remaining) return blockedExecutor(input, 'production-job-ended-before-observed-completion');
        const sea = execution.target.seaId ?? (boat ? seaIdAt(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, 'sea')) : undefined);
        const born = units.filter(unit => !known.includes(unit.id) && distance(unit, building) <= 500
          && (boat ? sea !== undefined && seaIdAt(snapshot.map, unit) === sea : sameGround(snapshot.map, unit, building)));
        if (born.length === 1) return { ...base, status: 'complete', phase: boat ? 'transport-built' : 'worker-trained',
          state: { ...execution.state, createdUnitId: born[0]!.id, ...(boat ? { createdShipId: born[0]!.id } : {}) } };
        return blockedExecutor(input, born.length ? `trained-${name}-birth-ambiguous` : `training-job-ended-without-observed-${name}`);
      }
      const capital = grant.budgets.find(budget => sameAction(budget.action, execution.token) && budget.objectiveId === input.objective.id
        && budget.state === 'reserved' && budget.amountGold - budget.paidGold >= UNIT_DEFS[kind].cost);
      if (job && 'unitKind' in job && command) return { ...base, status: 'active', phase: 'training',
        state: { ...execution.state, [knownKey]: execution.state[knownKey] ?? units.map(unit => unit.id), observedProduction: true,
          observedNativeJobId: job.id ?? null, observedCommandId: command.id,
          productionObservedTick: snapshot.tick, nativeRemainingTicks: job.remaining },
        payments: capital ? [{ budgetId: capital.id, amountGold: UNIT_DEFS[kind].cost, proof: { kind: 'production', buildingId: building.id,
          jobId: job.id ?? null, acceptedCommandId: command.id, unitKind: job.unitKind, queueIndex: building.queue.indexOf(job) } }] : [] };
      if (command) return baseline ? { ...base, status: 'active', phase: 'await-training-start' }
        : blockedExecutor(input, 'production-command-baseline-unknown');
      if (building.queue.length) return blockedExecutor(input, boat ? 'shipyard-queue-occupied' : 'worker-production-queue-occupied');
      if (!capital) return blockedExecutor(input, `no-granted-${name}-capital`);
      return { ...base, status: 'active', phase: 'await-training-start',
        state: { ...execution.state, [knownKey]: units.map(unit => unit.id), nativeQueueBefore: [] },
        commands: [{ command: { type: 'train', buildingId: building.id, unitKind: kind }, purpose: 'task' }] };
    },
  };
}
