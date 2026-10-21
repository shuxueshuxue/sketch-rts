import type { GameSnapshot } from '../../shared/types';
import type { ExecutorFeedback, StrategyAllocationMemory } from './allocation-types';
import { sameAction } from './control';
import { goalRecord } from './goal-executor-parameters';
import { readGoalIntent } from './goal-authority-references';

/** Building outputs retain exact native foundation identity. Training settles
 * quantities in the shared job ledger and never publishes a unit binding. */
export function validateGoalOutputFeedback(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  feedback: ExecutorFeedback): ExecutorFeedback {
  const execution = memory.executions[feedback.action.actionId];
  if (!execution || execution.intent.kind !== 'goal-action') return feedback;
  const intent = readGoalIntent(memory, execution.intent);
  const { goalOutputBindings: _untrustedBindings, goalNativeJobs: _obsoleteBirths, ...domain } = feedback.state;
  if (intent.actionKind === 'train') {
    const jobs = memory.goalTraining?.jobs.filter(job => sameAction(job.action, execution.token)) ?? [];
    const count = intent.parameters.count;
    const fulfilled = jobs.filter(job => job.state === 'fulfilled').length;
    const cancelled = jobs.some(job => job.state === 'cancelled');
    const wait = feedback.status === 'complete' && (typeof count !== 'number' || fulfilled < count);
    return { ...feedback, state: domain, goalOutputs: [],
      ...(wait ? { status: cancelled ? 'failed' : 'active', phase: cancelled ? 'native-training-cancelled' : 'await-pool-quantity', commands: [] } : {}),
      reasons: wait ? [...feedback.reasons, { executor: execution.executor, outcome: 'blocked',
        reason: cancelled ? 'native-training-cancelled' : 'goal-training-quantity-pending', taskId: execution.token.actionId, unitIds: [] }] : feedback.reasons };
  }
  const bindings: Record<string, string> = {};
  const previous = goalRecord(execution.state.goalOutputBindings);
  for (const output of intent.outputs) if (typeof previous?.[output] === 'string') bindings[output] = previous[output] as string;
  const paid = Object.values(memory.budgets).filter(budget => sameAction(budget.action, execution.token))
    .flatMap(budget => budget.nativePayments ?? []);
  const used = new Map<string, string>();
  for (const action of Object.values(memory.executions)) {
    const known = goalRecord(action.state.goalOutputBindings);
    for (const [slot, id] of Object.entries(known ?? {})) if (typeof id === 'string') used.set(id, `${action.token.actionId}/${slot}`);
  }
  let rejected = 0;
  for (const receipt of feedback.goalOutputs ?? []) {
    const assigned = used.get(receipt.entityId);
    const issued = memory.issuedCommands[receipt.proof.acceptedCommandId], build = issued?.command, before = issued?.worldBefore;
    const building = build?.type === 'build' ? snapshot.buildings.find(building => building.id === receipt.entityId
      && building.owner === memory.owner && building.hp > 0 && building.kind === build.buildingKind
      && building.x === build.x && building.y === build.y) : undefined;
    const valid = intent.actionKind === 'build' && receipt.proof.kind === 'foundation' && intent.outputs.includes(receipt.output)
      && receipt.observedTick === snapshot.tick && (!bindings[receipt.output] || bindings[receipt.output] === receipt.entityId)
      && (!assigned || assigned === `${execution.token.actionId}/${receipt.output}`) && issued && sameAction(issued.action, execution.token)
      && issued.executor === execution.executor && issued.acceptedTick <= snapshot.tick && before?.kind === 'construction'
      && !before.buildingIds.includes(receipt.entityId) && building && paid.some(payment => payment.kind === 'foundation'
        && payment.commandId === issued.id && payment.entityId === receipt.entityId);
    if (!valid) { rejected++; continue; }
    bindings[receipt.output] = receipt.entityId; used.set(receipt.entityId, `${execution.token.actionId}/${receipt.output}`);
  }
  const wait = feedback.status === 'complete' && intent.outputs.some(output => !bindings[output]);
  return { ...feedback, state: { ...domain, ...(intent.outputs.length ? { goalOutputBindings: bindings } : {}) },
    ...(wait ? { status: 'active', phase: 'await-output-validation', commands: [] } : {}),
    reasons: rejected || wait ? [...feedback.reasons, { executor: execution.executor, outcome: 'blocked',
      reason: rejected ? 'goal-output-proof-rejected' : 'goal-output-proof-pending', taskId: execution.token.actionId, unitIds: [] }] : feedback.reasons };
}
