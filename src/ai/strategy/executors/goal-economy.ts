import { BUILDING_DEFS, UNIT_DEFS, canTrainAt, requiredSupplyCap } from '../../../shared/catalog';
import { isBuildPlacementClear } from '../../../shared/build-placement';
import type { BuildingKind, TrainableUnitKind } from '../../../shared/types';
import type { ExecutorFeedback, ExecutorInput, StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, sameAction } from '../executor-grants';
import { currentAllocationLandRouteReader } from '../allocation-arrival-query';
import { goalAcceptedCommands, goalActionIntent, goalEntityId, goalGrantedCohort, goalHasLease, goalRecord, goalTarget } from '../goal-executor-parameters';
import { goalFact } from '../goal-facts';
import type { GoalOutputReceipt } from '../goal-execution-types';

const capital = (input: ExecutorInput, amount: number) => input.grant.budgets.find(budget => budget.objectiveId === input.objective.id
  && budget.methodId === input.method.id && sameAction(budget.action, input.execution.token) && budget.state === 'reserved'
  && budget.amountGold - budget.paidGold >= amount);
type TrainingJob = { commandId: string; jobId: string };
function trainingJobs(input: ExecutorInput): TrainingJob[] | null {
  const value = input.execution.state.goalTrainingJobs;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) return null;
  const jobs: TrainingJob[] = [];
  for (const item of value) {
    const job = goalRecord(item);
    if (!job || typeof job.commandId !== 'string' || typeof job.jobId !== 'string') return null;
    jobs.push({ commandId: job.commandId, jobId: job.jobId });
  }
  return new Set(jobs.map(job => job.commandId)).size === jobs.length
    && new Set(jobs.map(job => job.jobId)).size === jobs.length ? jobs : null;
}

/** Training settles quantities through the central job/pool reader. It never
 * chooses a born entity, publishes an output binding or waits for unit ACKs. */
export const goalTrainExecutor: StrategyExecutor = {
  id: 'goal.train',
  execute(input) {
    const intent = goalActionIntent(input, 'train');
    if (!intent) return blockedExecutor(input, 'invalid-goal-training-grant');
    const p = intent.parameters, producerId = goalEntityId(p.producer), count = p.count;
    if (!producerId || typeof p.unitKind !== 'string' || !Object.hasOwn(UNIT_DEFS, p.unitKind) || typeof count !== 'number'
      || !Number.isSafeInteger(count) || count < 1 || count > 64 || intent.outputs.length)
      return blockedExecutor(input, 'goal-training-parameters-unresolved');
    const kind = p.unitKind as TrainableUnitKind, rules = UNIT_DEFS[kind];
    if (!input.goalTraining) return blockedExecutor(input, 'goal-training-pool-reader-pending');
    if (!goalHasLease(input, `queue:${producerId}`)) return blockedExecutor(input, 'goal-training-queue-not-granted');
    const producer = input.snapshot.buildings.find(building => building.id === producerId && building.owner === input.owner && building.hp > 0 && building.complete);
    const player = input.snapshot.players[input.owner];
    if (!producer || !player || !canTrainAt(player.race, producer.kind, kind)) return blockedExecutor(input, 'goal-training-producer-unavailable');
    const jobs = trainingJobs(input);
    if (!jobs || jobs.length > count) return blockedExecutor(input, 'goal-training-state-invalid');
    const base = executorFeedback(input), commands = goalAcceptedCommands(input).filter(command => command.command.type === 'train'
      && command.command.buildingId === producerId && command.command.unitKind === kind);
    if (commands.length > count || jobs.some(job => !commands.some(command => command.id === job.commandId)))
      return blockedExecutor(input, 'goal-training-command-binding-invalid');
    const payments: NonNullable<ExecutorFeedback['payments']>[number][] = [];
    for (const command of commands.filter(command => !jobs.some(job => job.commandId === command.id))) {
      const before = command.worldBefore;
      if (before?.kind !== 'production' || before.buildingId !== producerId)
        return blockedExecutor(input, 'goal-training-command-baseline-required');
      const native = producer.queue.filter(job => 'unitKind' in job && job.unitKind === kind && job.id
        && !before.jobs.some(old => old.id === job.id) && !jobs.some(old => old.jobId === job.id));
      if (native.length !== 1) return blockedExecutor(input, 'goal-training-job-not-uniquely-observed');
      const job = native[0]!, budget = capital(input, rules.cost);
      jobs.push({ commandId: command.id, jobId: job.id! });
      if (budget) payments.push({ budgetId: budget.id, amountGold: rules.cost, proof: { kind: 'production', buildingId: producerId,
        jobId: job.id!, acceptedCommandId: command.id, unitKind: kind, queueIndex: producer.queue.indexOf(job) } });
    }
    const state = { ...input.execution.state, goalTrainingJobs: jobs };
    let fulfilled = 0, waiting = false;
    for (const job of jobs) {
      const query = { acceptedCommandId: job.commandId, producerId, jobId: job.jobId, unitKind: kind };
      const actual = input.goalTraining(query);
      if (actual.observedTick !== input.snapshot.tick || actual.acceptedCommandId !== query.acceptedCommandId
        || actual.producerId !== producerId || actual.jobId !== job.jobId || actual.unitKind !== kind)
        return { ...blockedExecutor(input, 'goal-training-pool-observation-pending'), state, payments };
      if (actual.state === 'cancelled') return { ...blockedExecutor(input, 'goal-training-job-cancelled'), state, payments, status: 'failed' };
      if (actual.state === 'fulfilled' && actual.creditedQuantity === 1) fulfilled++;
      else waiting = true;
    }
    if (fulfilled === count) return { ...base, state, payments, status: 'complete', phase: 'training-pool-quantity-fulfilled' };
    if (waiting) return { ...base, state, payments, status: 'active', phase: 'await-training-pool-credit' };
    if (producer.queue.length) return { ...blockedExecutor(input, 'goal-training-queue-occupied'), state, payments };
    if (!capital(input, rules.cost)) return { ...blockedExecutor(input, 'goal-training-capital-not-granted'), state, payments };
    if (player.gold < rules.cost || player.supplyCap < requiredSupplyCap(kind) || player.supplyCap - player.supplyUsed < rules.supplyUsed)
      return { ...blockedExecutor(input, 'goal-training-native-resources-insufficient'), state, payments };
    return { ...base, state, payments, status: 'active', phase: 'await-native-training',
      commands: [{ command: { type: 'train', buildingId: producerId, unitKind: kind }, purpose: 'task' }] };
  },
};

/** Builds only the exact declared site with the exact granted worker. Native
 * build/repair executes movement; this adapter never selects another site. */
export const goalBuildExecutor: StrategyExecutor = {
  id: 'goal.build',
  execute(input) {
    const intent = goalActionIntent(input, 'build');
    if (!intent) return blockedExecutor(input, 'invalid-goal-building-grant');
    const p = intent.parameters, at = goalTarget(p.at), approach = goalTarget(p.approach), workerId = goalEntityId(p.worker);
    if (!at || !approach || !workerId || typeof p.buildingKind !== 'string' || !(p.buildingKind in BUILDING_DEFS)
      || p.foundationId !== null && typeof p.foundationId !== 'string') return blockedExecutor(input, 'goal-building-parameters-unresolved');
    const kind = p.buildingKind as BuildingKind, base = executorFeedback(input), granted = goalGrantedCohort(input, [workerId]);
    const worker = granted.units[0];
    if (!worker || granted.missingIds.length || worker.kind !== 'worker' || worker.deck || worker.cabin)
      return blockedExecutor(input, 'goal-building-worker-not-granted');
    const matches = input.snapshot.buildings.filter(building => building.hp > 0 && building.kind === kind
      && building.x === at.point.x && building.y === at.point.y);
    if (matches.length > 1 || matches.some(building => building.owner !== input.owner)) return blockedExecutor(input, 'goal-building-site-occupied');
    const foundation = matches[0], priorId = p.foundationId;
    if (typeof priorId === 'string' && foundation?.id !== priorId) return blockedExecutor(input, 'goal-building-paid-foundation-missing');
    const command = goalAcceptedCommands(input).find(command => command.command.type === 'build' && command.command.unitId === workerId
      && command.command.buildingKind === kind && command.command.x === at.point.x && command.command.y === at.point.y
      && command.worldBefore?.kind === 'construction' && (!foundation || !command.worldBefore.buildingIds.includes(foundation.id)));
    if (foundation && !priorId && !command) return blockedExecutor(input, 'goal-building-foundation-provenance-required');
    const budget = capital(input, BUILDING_DEFS[kind].cost);
    const payments: ExecutorFeedback['payments'] = foundation && command && budget ? [{ budgetId: budget.id,
      amountGold: BUILDING_DEFS[kind].cost, proof: { kind: 'foundation', buildingId: foundation.id, acceptedCommandId: command.id } }] : [];
    const goalOutputs: GoalOutputReceipt[] = foundation && command && intent.outputs.includes('building') ? [{ output: 'building',
      entityId: foundation.id, observedTick: input.snapshot.tick, proof: { kind: 'foundation', acceptedCommandId: command.id } }] : [];
    if (foundation?.complete) return { ...base, status: 'complete', phase: 'building-complete', payments, goalOutputs };
    const route = currentAllocationLandRouteReader()?.(worker, approach.point);
    if (!route || route.status !== 'known') return { ...blockedExecutor(input,
      route?.status === 'unreachable' ? 'goal-building-route-unreachable' : 'goal-building-route-pending'), payments, goalOutputs };
    if (foundation) return { ...base, status: 'active', phase: 'constructing', payments, goalOutputs,
      commands: worker.order.type === 'repair' && worker.order.buildingId === foundation.id || worker.order.type === 'build'
        && worker.order.buildingKind === kind && worker.order.x === at.point.x && worker.order.y === at.point.y ? []
        : [{ command: { type: 'repair', unitIds: [workerId], buildingId: foundation.id }, purpose: 'task' }] };
    if (command) return worker.order.type === 'build' && worker.order.buildingKind === kind
      && worker.order.x === at.point.x && worker.order.y === at.point.y
      ? { ...base, status: 'active', phase: 'await-foundation' } : blockedExecutor(input, 'goal-building-order-ended-without-foundation');
    if (!budget) return blockedExecutor(input, 'goal-building-capital-not-granted');
    if (!isBuildPlacementClear(input.snapshot, kind, at.point)) return blockedExecutor(input, 'goal-building-geometry-changed');
    return { ...base, status: 'active', phase: 'await-foundation',
      commands: [{ command: { type: 'build', unitId: workerId, buildingKind: kind, ...at.point }, purpose: 'task' }] };
  },
};

export const goalWaitIncomeExecutor: StrategyExecutor = {
  id: 'goal.wait-income',
  execute(input) {
    const intent = goalActionIntent(input, 'wait-income');
    if (!intent) return blockedExecutor(input, 'invalid-goal-income-grant');
    const { minimumGold, byTick } = intent.parameters;
    if (typeof minimumGold !== 'number' || !Number.isFinite(minimumGold) || minimumGold < 0 || typeof byTick !== 'number' || !Number.isFinite(byTick))
      return blockedExecutor(input, 'goal-income-parameters-invalid');
    if (byTick < input.snapshot.tick) return { ...blockedExecutor(input, 'goal-income-deadline-expired'), status: 'failed' };
    const fact = goalFact({ kind: 'gold', minimum: minimumGold, byTick }), actual = input.goalFacts?.(fact);
    if (!actual || actual.observedTick !== input.snapshot.tick || actual.fact.id !== fact.id || actual.state === 'pending')
      return blockedExecutor(input, 'goal-income-free-gold-pending');
    if (actual.state !== 'met' || (actual.availableTick ?? input.snapshot.tick) > input.snapshot.tick)
      return { ...executorFeedback(input), status: 'active', phase: 'waiting-for-free-gold' };
    return { ...executorFeedback(input), status: 'complete', phase: 'free-gold-observed' };
  },
};

export const goalEconomyExecutors: readonly StrategyExecutor[] = [goalTrainExecutor, goalBuildExecutor, goalWaitIncomeExecutor];
