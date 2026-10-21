import type { GameSnapshot, TrainableUnitKind } from '../../shared/types';
import type { ExecutionState, ExecutorFeedback, StrategyAllocationMemory } from './allocation-types';
import { sameAction } from './control';
import type { GoalOutputReceipt } from './goal-execution-types';
import { goalEntityId, goalRecord } from './goal-executor-parameters';

type NativeJob = { output: string; commandId: string; producerId: string; jobId: string;
  unitKind: TrainableUnitKind; remaining: number; observedTick: number };
function retainedJobs(state: ExecutionState): NativeJob[] {
  const rows = state.goalNativeJobs;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(row => {
    const item = goalRecord(row);
    return item && typeof item.output === 'string' && typeof item.commandId === 'string' && typeof item.producerId === 'string'
      && typeof item.jobId === 'string' && typeof item.unitKind === 'string' && typeof item.remaining === 'number'
      && Number.isFinite(item.remaining) && item.remaining >= 0 && typeof item.observedTick === 'number'
      && Number.isFinite(item.observedTick) ? [{ ...item } as NativeJob] : [];
  }).slice(0, 64);
}

/** The lifecycle owns these ACKs. Adapter state/proposals cannot introduce or
 * change a binding. Jobs are first witnessed in the actual paid native queue;
 * later births require the same job's clock and a unique new real entity. */
export function validateGoalOutputFeedback(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  feedback: ExecutorFeedback): ExecutorFeedback {
  const execution = memory.executions[feedback.action.actionId];
  if (!execution || execution.intent.kind !== 'goal-action') return feedback;
  const intent = execution.intent, bindings: Record<string, string> = {};
  const previous = goalRecord(execution.state.goalOutputBindings);
  for (const output of intent.outputs) if (typeof previous?.[output] === 'string') bindings[output] = previous[output] as string;
  const jobs = retainedJobs(execution.state);
  const commands = Object.values(memory.issuedCommands).filter(command => sameAction(command.action, execution.token)
    && command.executor === execution.executor).sort((a, b) => a.acceptedTick - b.acceptedTick || a.id.localeCompare(b.id));
  const paid = Object.values(memory.budgets).filter(budget => sameAction(budget.action, execution.token))
    .flatMap(budget => budget.nativePayments ?? []);
  if (intent.actionKind === 'train') {
    const producerId = goalEntityId(intent.parameters.producer);
    const trains = commands.filter(command => command.command.type === 'train' && command.command.buildingId === producerId
      && command.command.unitKind === intent.parameters.unitKind);
    trains.slice(0, intent.outputs.length).forEach((command, index) => {
      if (command.command.type !== 'train' || command.worldBefore?.kind !== 'production' || !command.worldBefore.unitIds) return;
      const train = command.command, before = command.worldBefore;
      const producer = snapshot.buildings.find(building => building.id === producerId && building.owner === memory.owner && building.hp > 0);
      const native = producer?.queue.filter(job => 'unitKind' in job && job.unitKind === train.unitKind
        && job.id && !before.jobs.some(old => old.id === job.id)
        && paid.some(payment => payment.kind === 'production' && payment.commandId === command.id && payment.entityId === job.id));
      if (native?.length !== 1) return;
      const job = native[0]!, existing = jobs.find(row => row.commandId === command.id);
      if (existing) {
        if (existing.jobId === job.id && job.remaining <= existing.remaining
          && job.remaining >= Math.max(0, existing.remaining - (snapshot.tick - existing.observedTick))) {
          existing.remaining = job.remaining; existing.observedTick = snapshot.tick;
        }
      } else if (job.id && producerId) jobs.push({ output: intent.outputs[index]!, commandId: command.id,
        producerId, jobId: job.id, unitKind: command.command.unitKind, remaining: job.remaining, observedTick: snapshot.tick });
    });
  }
  const used = new Map<string, string>();
  for (const action of Object.values(memory.executions)) {
    const known = goalRecord(action.state.goalOutputBindings);
    for (const [slot, id] of Object.entries(known ?? {})) if (typeof id === 'string') used.set(id, `${action.token.actionId}/${slot}`);
  }
  const valid = (receipt: GoalOutputReceipt): boolean => {
    if (!intent.outputs.includes(receipt.output) || receipt.observedTick !== snapshot.tick
      || bindings[receipt.output] && bindings[receipt.output] !== receipt.entityId) return false;
    const assigned = used.get(receipt.entityId);
    if (assigned && assigned !== `${execution.token.actionId}/${receipt.output}`) return false;
    const command = commands.find(command => command.id === receipt.proof.acceptedCommandId && command.acceptedTick <= snapshot.tick);
    if (!command) return false;
    if (receipt.proof.kind === 'foundation') {
      const build = command.command, before = command.worldBefore;
      if (intent.actionKind !== 'build' || build.type !== 'build' || before?.kind !== 'construction'
        || before.buildingIds.includes(receipt.entityId) || !paid.some(payment => payment.kind === 'foundation'
          && payment.commandId === command.id && payment.entityId === receipt.entityId)) return false;
      const building = snapshot.buildings.find(building => building.id === receipt.entityId && building.owner === memory.owner
        && building.hp > 0 && building.kind === build.buildingKind && building.x === build.x && building.y === build.y);
      return !!building;
    }
    const birth = receipt.proof, train = command.command, before = command.worldBefore;
    if (intent.actionKind !== 'train' || train.type !== 'train' || before?.kind !== 'production' || !before.unitIds
      || birth.producerId !== train.buildingId || before.buildingId !== birth.producerId
      || before.jobs.some(job => job.id === birth.jobId)) return false;
    const proof = jobs.find(job => job.output === receipt.output && job.commandId === command.id
      && job.jobId === birth.jobId && job.producerId === birth.producerId && job.unitKind === train.unitKind);
    const producer = snapshot.buildings.find(building => building.id === birth.producerId && building.owner === memory.owner && building.hp > 0);
    if (!proof || !producer || producer.queue.some(job => job.id === birth.jobId)
      || snapshot.tick - proof.observedTick < proof.remaining) return false;
    // Repeated publication of a verified slot is idempotent. A new proposal
    // must be the sole unbound birth since this command's actual baseline.
    if (bindings[receipt.output] === receipt.entityId) return snapshot.units.some(unit => unit.id === receipt.entityId && unit.owner === memory.owner && unit.kind === train.unitKind);
    const candidates = snapshot.units.filter(unit => unit.owner === memory.owner && unit.kind === train.unitKind && unit.hp > 0
      && unit.expiresTick === undefined && !before.unitIds!.includes(unit.id) && !used.has(unit.id));
    return candidates.length === 1 && candidates[0]!.id === receipt.entityId;
  };
  let rejected = 0;
  for (const proposal of feedback.goalOutputs ?? []) {
    if (!valid(proposal)) { rejected++; continue; }
    bindings[proposal.output] = proposal.entityId;
    used.set(proposal.entityId, `${execution.token.actionId}/${proposal.output}`);
  }
  const { goalOutputBindings: _untrustedBindings, goalNativeJobs: _untrustedJobs, ...domain } = feedback.state;
  const missing = intent.outputs.filter(output => !bindings[output]);
  const wait = feedback.status === 'complete' && missing.length > 0;
  return { ...feedback, state: { ...domain, goalOutputBindings: bindings, goalNativeJobs: jobs },
    ...(wait ? { status: 'active', phase: 'await-output-validation', commands: [] } : {}),
    reasons: rejected || wait ? [...feedback.reasons, { executor: execution.executor, outcome: 'blocked',
      reason: rejected ? 'goal-output-proof-rejected' : 'goal-output-proof-pending', taskId: execution.token.actionId, unitIds: [] }] : feedback.reasons };
}
