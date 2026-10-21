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
type TrainingSlot = { output: string; commandId: string; jobId: string; observedTick: number; remaining: number; entityId: string | null };
function trainingSlots(input: ExecutorInput): TrainingSlot[] | null {
  const value = input.execution.state.goalTrainingSlots;
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const slots: TrainingSlot[] = [];
  for (const item of value) {
    const slot = goalRecord(item);
    if (!slot || typeof slot.output !== 'string' || typeof slot.commandId !== 'string' || typeof slot.jobId !== 'string'
      || typeof slot.observedTick !== 'number' || !Number.isFinite(slot.observedTick) || typeof slot.remaining !== 'number'
      || !Number.isFinite(slot.remaining) || slot.remaining < 0 || slot.entityId !== null && typeof slot.entityId !== 'string') return null;
    slots.push({ output: slot.output, commandId: slot.commandId, jobId: slot.jobId, observedTick: slot.observedTick,
      remaining: slot.remaining, entityId: slot.entityId });
  }
  return slots;
}

/** One queue, native job and observed output at a time. Births are proposals;
 * the central lifecycle must validate them before publishing bindings. */
export const goalTrainExecutor: StrategyExecutor = {
  id: 'goal.train',
  execute(input) {
    const intent = goalActionIntent(input, 'train');
    if (!intent) return blockedExecutor(input, 'invalid-goal-training-grant');
    const p = intent.parameters, producerId = goalEntityId(p.producer), count = p.count;
    if (!producerId || typeof p.unitKind !== 'string' || !(p.unitKind in UNIT_DEFS) || typeof count !== 'number'
      || !Number.isSafeInteger(count) || count < 1 || count > 64 || intent.outputs.length !== count
      || new Set(intent.outputs).size !== count) return blockedExecutor(input, 'goal-training-parameters-unresolved');
    const kind = p.unitKind as TrainableUnitKind, rules = UNIT_DEFS[kind];
    if (!goalHasLease(input, `queue:${producerId}`)) return blockedExecutor(input, 'goal-training-queue-not-granted');
    const producer = input.snapshot.buildings.find(building => building.id === producerId && building.owner === input.owner && building.hp > 0 && building.complete);
    const player = input.snapshot.players[input.owner];
    if (!producer || !player || !canTrainAt(player.race, producer.kind, kind)) return blockedExecutor(input, 'goal-training-producer-unavailable');
    const slots = trainingSlots(input);
    if (!slots || slots.some((slot, index) => slot.output !== intent.outputs[index]) || slots.length > count)
      return blockedExecutor(input, 'goal-training-state-invalid');
    const base = executorFeedback(input), own = input.snapshot.units.filter(unit => unit.owner === input.owner && unit.kind === kind && unit.hp > 0);
    const saved = input.execution.state.goalTrainingKnownIds;
    const knownIds = Array.isArray(saved) && saved.every(id => typeof id === 'string') ? saved as string[] : own.map(unit => unit.id);
    const outputs = (): GoalOutputReceipt[] => slots.flatMap(slot => slot.entityId ? [{ output: slot.output, entityId: slot.entityId,
      observedTick: input.snapshot.tick, proof: { kind: 'birth', acceptedCommandId: slot.commandId, producerId, jobId: slot.jobId } }] : []);
    const state = () => ({ ...input.execution.state, goalTrainingSlots: slots, goalTrainingKnownIds: knownIds });
    const current = slots.at(-1);
    if (current && !current.entityId) {
      const job = producer.queue.find(job => 'unitKind' in job && job.id === current.jobId && job.unitKind === kind);
      if (job) {
        if (job.remaining > current.remaining || job.remaining < Math.max(0, current.remaining - (input.snapshot.tick - current.observedTick)))
          return blockedExecutor(input, 'goal-training-job-continuity-mismatch');
        current.remaining = job.remaining; current.observedTick = input.snapshot.tick;
        return { ...base, state: state(), status: 'active', phase: 'training', goalOutputs: outputs() };
      }
      if (input.snapshot.tick - current.observedTick < current.remaining)
        return blockedExecutor(input, 'goal-training-job-ended-early');
      const born = own.filter(unit => !knownIds.includes(unit.id) && !slots.some(slot => slot.entityId === unit.id));
      if (born.length !== 1) return blockedExecutor(input, born.length ? 'goal-training-birth-ambiguous' : 'goal-training-birth-not-observed');
      current.entityId = born[0]!.id;
    }
    const bindings = goalRecord(input.execution.state.goalOutputBindings);
    if (slots.length === count && slots.every(slot => slot.entityId)) return { ...base, state: state(), status: 'complete',
      phase: 'native-birth-proposed', goalOutputs: outputs() };
    if (current?.entityId && bindings?.[current.output] !== current.entityId)
      return { ...base, state: state(), status: 'active', phase: 'await-output-validation', goalOutputs: outputs() };
    const accepted = goalAcceptedCommands(input).filter(command => command.command.type === 'train'
      && command.command.buildingId === producerId && command.command.unitKind === kind && !slots.some(slot => slot.commandId === command.id));
    if (accepted.length > 1) return blockedExecutor(input, 'goal-training-command-ambiguous');
    const command = accepted[0];
    if (command) {
      const before = command.worldBefore;
      if (before?.kind !== 'production' || before.buildingId !== producerId)
        return blockedExecutor(input, 'goal-training-command-baseline-required');
      const jobs = producer.queue.filter(job => 'unitKind' in job && job.unitKind === kind && job.id && !before.jobs.some(old => old.id === job.id));
      if (jobs.length !== 1) return blockedExecutor(input, 'goal-training-job-not-uniquely-observed');
      const job = jobs[0]!, budget = capital(input, rules.cost);
      slots.push({ output: intent.outputs[slots.length]!, commandId: command.id, jobId: job.id!, observedTick: input.snapshot.tick,
        remaining: job.remaining, entityId: null });
      return { ...base, state: state(), status: 'active', phase: 'training', goalOutputs: outputs(),
        payments: budget ? [{ budgetId: budget.id, amountGold: rules.cost, proof: { kind: 'production', buildingId: producerId,
          jobId: job.id!, acceptedCommandId: command.id, unitKind: kind, queueIndex: producer.queue.indexOf(job) } }] : [] };
    }
    if (producer.queue.length) return blockedExecutor(input, 'goal-training-queue-occupied');
    if (!capital(input, rules.cost)) return blockedExecutor(input, 'goal-training-capital-not-granted');
    if (player.gold < rules.cost || player.supplyCap < requiredSupplyCap(kind) || player.supplyCap - player.supplyUsed < rules.supplyUsed)
      return blockedExecutor(input, 'goal-training-native-resources-insufficient');
    return { ...base, state: state(), status: 'active', phase: 'await-native-training', goalOutputs: outputs(),
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
    if (!route || route.status !== 'known') return blockedExecutor(input, route?.status === 'unreachable' ? 'goal-building-route-unreachable' : 'goal-building-route-pending');
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
