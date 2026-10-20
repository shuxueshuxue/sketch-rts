import { UNIT_DEFS } from '../../../shared/catalog';
import { walkableGoal } from '../../../shared/terrain';
import { isTransportKind } from '../../../shared/transport-role';
import { distance } from '../../policy/spatial';
import type { StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, sameAction, validExecutorGrant } from '../executor-grants';
import { seaIdAt } from '../regions';

export const trainTransportExecutor: StrategyExecutor = {
  id: 'strategy.train-transport',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { snapshot, owner, execution, grant } = input, base = executorFeedback(input);
    const queueIds = new Set(grant.leases.filter(lease => lease.resourceKey.startsWith('queue:') && lease.objectiveId === input.objective.id
      && sameAction(lease.action, execution.token))
      .map(lease => lease.resourceKey.slice(6)));
    const yard = snapshot.buildings.find(building => queueIds.has(building.id) && building.owner === owner && building.complete && building.hp > 0
      && building.kind === 'shipyard');
    if (!yard) return blockedExecutor(input, 'no-granted-complete-shipyard');
    const hulls = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && isTransportKind(unit.kind));
    const known = Array.isArray(execution.state.knownHullIds) ? execution.state.knownHullIds : [];
    const job = yard.queue.find(job => 'unitKind' in job && isTransportKind(job.unitKind));
    const command = grant.commands.find(entry => entry.command.type === 'train' && entry.command.buildingId === yard.id
      && isTransportKind(entry.command.unitKind) && sameAction(entry.action, execution.token));
    if (execution.state.observedJobId && !job) {
      const sea = execution.target.seaId ?? seaIdAt(snapshot.map, walkableGoal(snapshot.map, yard.x, yard.y, 'sea'));
      const born = hulls.filter(unit => !known.includes(unit.id) && distance(unit, yard) <= 500
        && sea !== undefined && seaIdAt(snapshot.map, unit) === sea);
      if (born.length === 1) return { ...base, status: 'complete', phase: 'transport-built',
        state: { ...execution.state, createdShipId: born[0]!.id } };
      return blockedExecutor(input, born.length ? 'trained-transport-birth-ambiguous' : 'training-job-ended-without-observed-transport');
    }
    if (job && command) return { ...base, status: 'active', phase: 'training',
      state: { ...execution.state, knownHullIds: execution.state.knownHullIds ?? hulls.map(unit => unit.id), observedJobId: job.id ?? command.id } };
    if (command) return { ...base, status: 'active', phase: 'await-training-start' };
    if (yard.queue.length) return blockedExecutor(input, 'shipyard-queue-occupied');
    if (!grant.budgets.some(budget => sameAction(budget.action, execution.token) && budget.objectiveId === input.objective.id
      && budget.state === 'reserved' && budget.amountGold - budget.paidGold >= UNIT_DEFS.transport.cost))
      return blockedExecutor(input, 'no-granted-transport-capital');
    return { ...base, status: 'active', phase: 'await-training-start',
      state: { ...execution.state, knownHullIds: hulls.map(unit => unit.id) },
      commands: [{ command: { type: 'train', buildingId: yard.id, unitKind: 'transport' }, purpose: 'task' }] };
  },
};
