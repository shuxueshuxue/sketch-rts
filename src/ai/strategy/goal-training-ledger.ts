import { unitMover } from '../../shared/catalog';
import type { GameSnapshot, TrainableUnitKind } from '../../shared/types';
import type { ActionToken, CommandAdmission, StrategyAllocationMemory } from './allocation-types';
import { sameAction } from './control';
import type { GoalTrainingObservation, GoalTrainingQuery, GoalTrainingReader } from './goal-execution-types';
import { goalTarget } from './goal-executor-parameters';
import { goalValueKey } from './goal-facts';
import { landIdAt, seaIdAt } from './regions';
import type { Target } from './types';
import { readGoalIntent } from './goal-authority-references';

type Pool = { key: string; unitKind: TrainableUnitKind; at: Target; count: number; baseCount: number;
  credited: number; increases: number; assignedThrough: number; observedTick: number };
type Job = { query: GoalTrainingQuery; action: ActionToken; poolKey: string; creditFloor: number; acceptedTick: number;
  remaining: number; observedTick: number; state: 'training' | 'await-pool' | 'cancelled' | 'fulfilled'; reasonCode: string };
export type GoalTrainingMemory = Readonly<{ version: 1; owner: string; pools: readonly Pool[]; jobs: readonly Job[] }>;
const keyOf = (query: GoalTrainingQuery) => goalValueKey(query);
const count = (snapshot: GameSnapshot, owner: string, kind: TrainableUnitKind, at: Target) => {
  const mover = unitMover(kind), region = mover === 'land' ? at.landId : at.seaId;
  return snapshot.units.filter(unit => unit.owner === owner && unit.kind === kind && unit.hp > 0 && unit.expiresTick === undefined
    && !unit.deck && !unit.cabin && region !== undefined
    && (mover === 'land' ? landIdAt(snapshot.map, unit) : seaIdAt(snapshot.map, unit)) === region).length;
};
function mutable(memory: StrategyAllocationMemory) {
  return memory.goalTraining?.owner === memory.owner ? structuredClone(memory.goalTraining)
    : { version: 1 as const, owner: memory.owner, pools: [] as Pool[], jobs: [] as Job[] };
}
function refreshPools(state: GoalTrainingMemory, snapshot: GameSnapshot) {
  for (const pool of state.pools) {
    const quantity = count(snapshot, state.owner, pool.unitKind, pool.at);
    pool.increases += Math.max(0, quantity - pool.count);
    pool.count = quantity; pool.observedTick = snapshot.tick;
  }
}

/** Admission captures region quantities, not birth identities. Shared positive
 * increments are consumed once across every job / goal using the same pool. */
export function recordGoalTrainingAdmissions(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  admissions: readonly CommandAdmission[]): StrategyAllocationMemory {
  const relevant = admissions.filter(admission => admission.status === 'accepted' && admission.command.type === 'train'
    && admission.executor === 'goal.train' && admission.action);
  const cancellations = admissions.filter(admission => admission.status === 'accepted' && admission.command.type === 'cancelTraining');
  if (!relevant.length && !cancellations.length) return memory;
  const state = mutable(memory), issuedCommands = { ...memory.issuedCommands };
  refreshPools(state, snapshot);
  for (const admission of relevant) {
    const issued = issuedCommands[admission.commandId], execution = admission.action && memory.executions[admission.action.actionId];
    if (!issued || issued.command.type !== 'train' || issued.worldBefore?.kind !== 'production' || issued.worldBefore.pool
      || execution?.intent.kind !== 'goal-action' || execution.intent.actionKind !== 'train') continue;
    const at = goalTarget(readGoalIntent(memory, execution.intent).parameters.at), kind = issued.command.unitKind;
    if (!at || !(unitMover(kind) === 'land' ? at.landId : at.seaId)) continue;
    const key = goalValueKey([kind, unitMover(kind) === 'land' ? at.landId : at.seaId]);
    let pool = state.pools.find(pool => pool.key === key);
    if (!pool) {
      const quantity = count(snapshot, memory.owner, kind, at);
      pool = { key, at, unitKind: kind, count: quantity, baseCount: quantity, credited: 0,
        increases: 0, assignedThrough: 0, observedTick: snapshot.tick };
      (state.pools as Pool[]).push(pool);
    } else {
      const active = state.jobs.some(job => job.poolKey === key && (job.state === 'training' || job.state === 'await-pool'))
        || Object.values(issuedCommands).some(command => command.worldBefore?.kind === 'production' && command.worldBefore.pool?.key === key
          && memory.executions[command.action.actionId]?.status !== 'complete' && !state.jobs.some(job => job.query.acceptedCommandId === command.id));
      if (!active) { pool.baseCount = pool.count; pool.credited = 0; pool.increases = 0; pool.assignedThrough = 0; }
    }
    issuedCommands[issued.id] = { ...issued, worldBefore: { ...issued.worldBefore,
      pool: { key, at, quantity: pool.count, creditFloor: pool.increases } } };
  }
  for (const admission of cancellations) if (admission.command.type === 'cancelTraining') {
    const cancel = admission.command;
    for (const job of state.jobs) if (job.query.producerId === cancel.buildingId && job.query.jobId === cancel.jobId && job.state !== 'fulfilled') {
      job.state = 'cancelled'; job.reasonCode = 'native-training-cancelled';
    }
  }
  if (state.pools.length > 64) throw Error('Goal training pool bound exceeded');
  return { ...memory, issuedCommands, goalTraining: state };
}

/** Observe paid jobs and pool totals in one owner frame. An early disappearance
 * is permanently cancelled; a later unrelated increase cannot revive it. */
export function observeGoalTraining(memory: StrategyAllocationMemory, snapshot: GameSnapshot): StrategyAllocationMemory {
  const receipts = Object.values(memory.budgets).flatMap(budget => (budget.nativePayments ?? []).filter(payment => payment.kind === 'production')
    .map(payment => ({ payment, action: budget.action })));
  if (!memory.goalTraining && !receipts.length) return memory;
  const state = mutable(memory);
  refreshPools(state, snapshot);
  for (const { payment, action } of receipts) {
    const issued = memory.issuedCommands[payment.commandId], execution = memory.executions[action.actionId];
    if (execution?.intent.kind !== 'goal-action' || execution.intent.actionKind !== 'train' || !issued
      || !sameAction(issued.action, action) || issued.command.type !== 'train' || issued.worldBefore?.kind !== 'production' || !issued.worldBefore.pool) continue;
    const train = issued.command, before = issued.worldBefore, query: GoalTrainingQuery = { acceptedCommandId: issued.id,
      producerId: train.buildingId, unitKind: train.unitKind, jobId: payment.entityId };
    if (state.jobs.some(job => keyOf(job.query) === keyOf(query))) continue;
    const actual = snapshot.buildings.find(building => building.owner === memory.owner && building.id === train.buildingId && building.hp > 0)
      ?.queue.find(job => job.id === query.jobId && 'unitKind' in job && job.unitKind === train.unitKind);
    if (!actual || before.jobs.some(job => job.id === query.jobId)) continue;
    (state.jobs as Job[]).push({ query, action, poolKey: before.pool!.key, creditFloor: before.pool!.creditFloor,
      acceptedTick: issued.acceptedTick, remaining: actual.remaining, observedTick: snapshot.tick,
      state: 'training', reasonCode: 'native-paid-training-job-observed' });
  }
  for (const job of state.jobs) {
    if (job.state === 'fulfilled' || job.state === 'cancelled') continue;
    const producer = snapshot.buildings.find(building => building.id === job.query.producerId && building.owner === memory.owner && building.hp > 0);
    const actual = producer?.queue.find(item => item.id === job.query.jobId && 'unitKind' in item && item.unitKind === job.query.unitKind);
    if (actual) {
      if (actual.remaining > job.remaining || actual.remaining < Math.max(0, job.remaining - (snapshot.tick - job.observedTick))) {
        job.state = 'cancelled'; job.reasonCode = 'native-training-continuity-broken';
      } else { job.remaining = actual.remaining; job.observedTick = snapshot.tick; }
    } else if (!producer || snapshot.tick - job.observedTick < job.remaining) {
      job.state = 'cancelled'; job.reasonCode = 'native-training-job-ended-early';
    } else { job.state = 'await-pool'; job.reasonCode = 'native-training-awaits-pool-quantity'; }
  }
  for (const job of [...state.jobs].sort((a, b) => a.acceptedTick - b.acceptedTick || keyOf(a.query).localeCompare(keyOf(b.query)))) {
    if (job.state !== 'await-pool') continue;
    const pool = state.pools.find(pool => pool.key === job.poolKey);
    if (!pool) continue;
    const next = Math.max(job.creditFloor, pool.assignedThrough) + 1;
    if (next > pool.increases || pool.count - pool.baseCount < pool.credited + 1) continue;
    pool.assignedThrough = next; pool.credited++; job.state = 'fulfilled'; job.reasonCode = 'native-job-complete-pool-quantity-observed';
  }
  const retained = state.jobs.filter(job => memory.executions[job.action.actionId]
    && sameAction(memory.executions[job.action.actionId]!.token, job.action));
  if (retained.length > 256) throw Error('Goal training job bound exceeded');
  return { ...memory, goalTraining: { ...state, jobs: retained } };
}

export function goalTrainingReader(memory: StrategyAllocationMemory, snapshot: GameSnapshot): GoalTrainingReader {
  return query => {
    const job = memory.goalTraining?.jobs.find(job => keyOf(job.query) === keyOf(query));
    const state: GoalTrainingObservation['state'] = !job ? 'pending' : job.state === 'await-pool' ? 'pending' : job.state;
    return { ...query, state, observedTick: snapshot.tick, creditedQuantity: state === 'fulfilled' ? 1 : 0,
      reasonCode: job?.reasonCode ?? 'native-paid-training-observation-required' };
  };
}
