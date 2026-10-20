import { UNIT_DEFS } from '../../shared/catalog';
import type { AllocationMethodQuoteInput, AllocationPrecondition, ExecutableMethod, PlannedAllocationSpend,
  ProductionBinding } from './allocation-types';
import type { MiningWorkforceForecast } from './mining-forecast';
import { landIdAt } from './regions';

/** Turn a forecast into explicit resources and dependencies. Projections never
 * become unit IDs. Native queue jobs and observed births retain their original
 * action/spend identity when a method is materialized again. */
export function materializeMiningWorkforce(input: AllocationMethodQuoteInput, forecast: MiningWorkforceForecast,
  terminalId: string, buildActionId: string | null, garrisonId: string) {
  type Action = ExecutableMethod['actions'][number];
  const { method, snapshot, situation } = input;
  const terminal = method.actions.find(action => action.id === terminalId);
  if (!terminal) throw new Error(`Missing mining terminal ${terminalId}`);
  const actions: Action[] = [], spends: PlannedAllocationSpend[] = [], missing: AllocationPrecondition[] = [];
  const selected = new Set(input.unitIds), used = new Set<string>(), miners = new Set<string>();
  const prior = method.actions.filter(action => action.executor === 'strategy.train-worker');
  const executions = new Map(input.executions.map(execution => [execution.token.actionId, execution]));
  const producerKey = (production: ProductionBinding) => {
    if (production.producer.kind === 'existing') return `existing:${production.producer.buildingId}`;
    const actualId = executions.get(production.producer.actionId)?.state.hallId;
    return typeof actualId === 'string' ? `existing:${actualId}` : `action:${production.producer.actionId}`;
  };
  let ordinal = Math.max(-1, ...prior.map(action => Number(action.id.split('/mine-worker:')[1]))
    .filter(Number.isInteger)) + 1;
  const unavailable = (code: string, factIds: readonly string[]) => missing.push({ id: `${method.id}/${code}:${factIds.join(',')}`,
    kind: 'workers', status: 'unknown', reason: { code, factIds, values: {} }, demand: null, subgoalIds: [] });
  const ready = [...new Set([garrisonId, ...(buildActionId ? [buildActionId] : [])])];
  const mine = (id: string, unitIds: readonly string[], dependencies: readonly string[]) => {
    unitIds.forEach(id => miners.add(id));
    actions.push({ id, executor: 'strategy.start-mining', intent: { kind: 'start-mining' }, target: terminal.target,
      dependsOn: [...new Set([...ready, ...dependencies])], demands: [{ kind: 'workers', count: 1, at: terminal.target }],
      unitIds, spendIds: [], completionEffects: [] });
  };
  const trainings = new Map(forecast.training.map(training => [training.id, training]));
  const queueTail = new Map<string, string>();
  for (const worker of forecast.workers) {
    if (!['paid-queue', 'train-worker'].includes(worker.source)) {
      const actual = snapshot.units.find(unit => unit.id === worker.unitId && unit.owner === situation.owner && unit.hp > 0 && unit.kind === 'worker');
      if (!actual || !selected.has(worker.unitId)) { unavailable('forecast-worker-not-in-granted-bundle', [worker.unitId]); continue; }
      mine(`${method.id}/mine:${worker.unitId}`, [worker.unitId], []); continue;
    }
    const training = trainings.get(worker.unitId);
    if (!training) { unavailable('forecast-worker-production-missing', [worker.unitId]); continue; }
    const future = training.producerId === `planned-hall:${forecast.mineId}`;
    const producer: ProductionBinding['producer'] = future && buildActionId ? { kind: 'action-result', actionId: buildActionId }
      : { kind: 'existing', buildingId: training.producerId };
    const building = future ? undefined : snapshot.buildings.find(building => building.id === training.producerId
      && building.owner === situation.owner && building.hp > 0 && building.kind === 'townHall');
    if (future ? !buildActionId : !building) { unavailable('forecast-worker-producer-unresolved', [training.producerId]); continue; }
    if (building && landIdAt(snapshot.map, building) !== terminal.target.landId) {
      unavailable('forecast-worker-production-needs-transport-subgoal', [building.id]); continue;
    }
    const key = producer.kind === 'existing' ? `existing:${producer.buildingId}` : `action:${producer.actionId}`;
    const observedJob = building?.queue.find(job => job.id === training.jobId && 'unitKind' in job && job.unitKind === 'worker');
    if (training.paid && !observedJob) { unavailable('forecast-paid-worker-job-unobserved', [training.producerId, training.jobId ?? training.id]); continue; }
    const previous = prior.find(action => !used.has(action.id) && action.production
      && producerKey(action.production) === key && (training.paid
        ? action.production.request.kind === 'adopt-paid' && action.production.request.jobId === training.jobId
          || executions.get(action.id)?.state.observedNativeJobId === training.jobId
        : action.production.request.kind === 'submit' && !['complete', 'failed', 'abandoned'].includes(executions.get(action.id)?.status ?? 'pending')));
    const id = previous?.id ?? `${method.id}/mine-worker:${ordinal++}`, spendId = `${id}/capital`;
    used.add(id);
    const production: ProductionBinding = previous?.production ?? { producer, unitKind: 'worker', request: training.paid
      ? { kind: 'adopt-paid', jobId: training.jobId, queueIndex: building!.queue.indexOf(observedJob!),
        observedTick: snapshot.tick, remainingTicks: observedJob!.remaining }
      : { kind: 'submit', spendId } };
    if (production.request.kind === 'submit') spends.push({ spendId: production.request.spendId, amountGold: UNIT_DEFS.worker.cost,
      includedUtilityTermCodes: ['mining-worker-recruitment'], externalReservationIds: [] });
    const previousQueueAction = queueTail.get(key), execution = executions.get(id);
    const dependencies = [...(future ? [buildActionId!] : []), ...(previousQueueAction ? [previousQueueAction] : [])];
    actions.push({ ...(previous ?? {}), id, executor: 'strategy.train-worker', intent: { kind: 'train-worker' }, production,
      target: execution?.target ?? (building ? { entityId: building.id, point: { x: building.x, y: building.y },
        ...(terminal.target.landId ? { landId: terminal.target.landId } : {}) } : { point: terminal.target.point,
          ...(terminal.target.landId ? { landId: terminal.target.landId } : {}) }),
      dependsOn: dependencies, demands: [{ kind: 'production', buildingId: building?.id ?? null, unitKind: 'worker', count: 1 },
        ...(training.paid ? [] : [{ kind: 'gold' as const, amount: UNIT_DEFS.worker.cost },
          { kind: 'supply' as const, amount: UNIT_DEFS.worker.supplyUsed }])],
      unitIds: [], spendIds: production.request.kind === 'submit' ? [production.request.spendId] : [], completionEffects: [] });
    queueTail.set(key, id);
    const bornId = execution?.state.createdUnitId;
    const actual = typeof bornId === 'string' && snapshot.units.find(unit => unit.id === bornId && unit.owner === situation.owner && unit.kind === 'worker' && unit.hp > 0);
    if (actual && !selected.has(actual.id)) unavailable('produced-worker-not-in-granted-bundle', [actual.id]);
    mine(`${id}/mine`, actual && selected.has(actual.id) ? [actual.id] : [], [id]);
  }
  // A committed producer may already be paid or have a child in flight. It
  // cannot disappear merely because a new forecast chose another ordinal.
  for (const previous of prior.filter(action => !used.has(action.id))) {
    const execution = executions.get(previous.id);
    if (execution && !['complete', 'failed', 'abandoned'].includes(execution.status))
      unavailable('forecast-omits-committed-worker-production', [previous.id]);
    actions.push(previous);
  }
  const miningActions = actions.filter(action => action.executor === 'strategy.start-mining');
  actions.push({ ...terminal, unitIds: [...miners].sort(), dependsOn: [...new Set([...ready, ...miningActions.map(action => action.id)])] });
  return { actions, spends, missing };
}
