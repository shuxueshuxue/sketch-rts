import type { BootstrapAiVersion, GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiCommandEntry, AiPolicyContext, AiScript } from '../policy/types';
import { planAiCommandEntriesFromScripts } from '../policy/core';
import { bootstrapDoctrineContext, prepareBootstrapLandMission, prepareBootstrapSites } from '../bootstrap_1/policy';
import { buildObservedStrategyDecision, buildStrategyDecision, projectStrategyTrace,
  type ObservedStrategyDecision, type StrategyDecision } from './decision';
import type { CommandAdmission, ExecutorFeedback, ExecutorInput, StrategyAllocationMemory } from './allocation-types';
import type { StrategyPlanTrace } from './types';
import { allocateStrategy } from './allocator';
import { allocationGrants, applyExecutorFeedback, pruneAllocationProvenance, settleAllocationState, advanceAllocationLeases } from './allocation-lifecycle';
import { recordAllocationCommands } from './allocation-ledger';
import { projectStrategyAllocation } from './allocation-trace';
import { withAllocationArrivalQuery } from './allocation-arrival-query';
import { withAllocationMethodArrivals } from './method-arrivals';
import { prepareAllocationVoyageRisks } from './allocation-voyage-risk';
import { defenseMethodProvider } from './defense-methods';
import { conquestMethodProvider } from './conquest-methods';
import { defenseAndConquestExecutors } from './executors';
import { observeWorkerSafetyInterruption } from './executors/worker-safety';
import { createStrategyAllocationMemory } from './control';
import { importExecutedIncumbents, incumbentTasks, withFormalCommitments } from './incumbent-import';
import { handoffIncumbent } from './incumbent-handoff';
import { incumbentCommandActor, inheritIncumbentCommand } from './incumbent-command-source';
import { incumbentDisposition, recordCandidateReassignment, recordIncumbentCommands } from './incumbent-evidence';
import { importedMiningLossUpperBound } from './imported-loss-bound';
import { createStrategyCommandGateway, type StrategyCommandProposal } from './command-gateway';

export type BootstrapStrategyOutput = Readonly<{ decision: StrategyDecision; project?: () => StrategyPlanTrace }>;
const providers = [defenseMethodProvider, conquestMethodProvider];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function scriptProposals(scriptId: string, commands: readonly GameCommand[], authority: StrategyAllocationMemory,
  nextId: () => string): StrategyCommandProposal[] {
  return commands.flatMap(command => {
    const actor = incumbentCommandActor(command);
    const ids = 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
    const groups = new Map<string, { action: StrategyCommandProposal['action']; ids: string[] }>();
    for (const id of ids) {
      const lease = authority.leases[`unit:${id}`];
      const own = actor && lease?.origin === 'imported-task' && lease.incumbentTask?.source === actor.source
        && lease.incumbentTask.taskId === actor.taskId ? lease.action : null;
      const key = own ? `${own.actionId}:${own.generation}` : '';
      const group = groups.get(key) ?? { action: own, ids: [] };
      group.ids.push(id); groups.set(key, group);
    }
    if (!ids.length) groups.set('', { action: null, ids: [] });
    return [...groups.values()].map(group => ({ id: nextId(), source: group.action ? 'executor' as const : 'script' as const,
      executor: scriptId, action: group.action, allocationRevision: group.action ? authority.revision : null, purpose: 'task' as const,
      command: 'unitIds' in command ? inheritIncumbentCommand(command, { ...command, unitIds: group.ids }) : command }));
  });
}

/** Replacing these native unit orders has no cash fee and neither cancels a
 * paid production job nor destroys a foundation. Remaining travel/work value
 * is still charged by the same-window displaced-plan oracle, not waived here. */
function nativeSwitchCost(snapshot: GameSnapshot, resources: readonly string[]): number | null {
  const replaceable = new Set(['idle', 'hold', 'move', 'attackMove', 'attack', 'follow', 'board', 'mine', 'repair']);
  return resources.every(key => key.startsWith('unit:') && snapshot.units.some(unit => unit.id === key.slice(5)
    && !unit.deck && !unit.cabin && replaceable.has(unit.order.type))) ? 0 : null;
}

/** Controlled bootstrap transaction. It is opt-in while behavior acceptance is
 * incomplete; the caller's ordinary policy path remains available as baseline.
 * This entry evaluates once, leases before old prepare, and admits every final
 * order through the same authority. Observations project this exact evaluation. */
export function planControlledBootstrapCommands(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion,
  scripts: AiScript[], options: AiPolicyContext, observation: 'none' | 'facts' | 'trace' = 'none') {
  const policy = options.memory;
  const observed = observation === 'trace';
  const evaluation = observed ? buildObservedStrategyDecision(snapshot, owner, options) : buildStrategyDecision(snapshot, owner, options);
  const imported = importExecutedIncumbents(snapshot, policy, evaluation.situation,
    policy.strategyAllocation ?? createStrategyAllocationMemory(owner, snapshot.tick));
  policy.strategyAllocation = imported;
  const occupied = withFormalCommitments(evaluation.situation, imported);
  const methods = evaluation.objectives.flatMap(objective => providers.flatMap(provider => provider.buildMethods({ snapshot,
    situation: occupied, objective, previous: imported.objectives[objective.id] ?? null,
    executions: Object.values(imported.executions), blocked: Object.values(imported.blocked) })));
  const situation = withAllocationMethodArrivals(snapshot, owner, policy, occupied, methods);
  let handoffPolicy: typeof policy | undefined;
  const allocation = withAllocationArrivalQuery(snapshot, owner, policy, fixedVoyageArrival => allocateStrategy({ snapshot,
    situation, objectives: evaluation.objectives, methods, providers, previous: imported, fixedVoyageArrival,
    importedUpperBound: (objectiveId, window) => {
      const targetId = imported.objectives[objectiveId]?.target.entityId;
      return targetId ? importedMiningLossUpperBound(situation, evaluation.objectives, targetId, window) : null;
    },
    prepareVoyageRisks: materialized => prepareAllocationVoyageRisks(snapshot, owner, policy, materialized),
    switchingCost: request => nativeSwitchCost(snapshot, request.resourceKeys),
    handoffImported(requests) {
      const draft = structuredClone(policy), acknowledgements = [];
      for (const request of requests) {
        const actor = request.leases[0]?.incumbentTask;
        if (!actor || request.leases.some(lease => lease.incumbentTask?.source !== actor.source || lease.incumbentTask?.taskId !== actor.taskId)) return null;
        const result = handoffIncumbent(snapshot, owner, draft, actor, request.resourceKeys.filter(key => key.startsWith('unit:')).map(key => key.slice(5)), request.eventId);
        if (!result) return null;
        acknowledgements.push({ eventId: result.eventId, disposition: result.disposition });
      }
      handoffPolicy = draft; return acknowledgements;
    },
  }));
  if (handoffPolicy) for (const key of ['unitClaims', 'landExpansion', 'expansionGarrisons', 'naval'] as const) {
    // Only the producer's acknowledged membership transaction is adopted.
    if (handoffPolicy[key] === undefined) delete policy[key];
    else Object.assign(policy, { [key]: handoffPolicy[key] });
  }
  policy.strategyAllocation = allocation.memory;
  // Candidate reservations have no executed loss. Their producer still gets
  // an explicit cleanup event, including repeated-reassignment diagnostics.
  for (const task of incumbentTasks(policy)) {
    const members = task.unitIds.filter(id => {
      const unit = snapshot.units.find(unit => unit.id === id), lease = policy.strategyAllocation!.leases[`unit:${id}`];
      return !!unit && lease?.origin === 'allocator' && incumbentDisposition(snapshot, unit, policy.strategyAllocation!, task.actor) === 'proposed';
    });
    for (const objectiveId of [...new Set(members.map(id => policy.strategyAllocation!.leases[`unit:${id}`]!.objectiveId))].sort()) {
      const unitIds = members.filter(id => policy.strategyAllocation!.leases[`unit:${id}`]!.objectiveId === objectiveId);
      const lease = policy.strategyAllocation.leases[`unit:${unitIds[0]}`]!;
      const eventId = `${owner}:allocation:${policy.strategyAllocation.nextEventSequence}`;
      if (!handoffIncumbent(snapshot, owner, policy, task.actor, unitIds, eventId, 'candidate-reassigned'))
        throw new Error('Candidate producer did not acknowledge reassignment');
      policy.strategyAllocation = recordCandidateReassignment({ memory: policy.strategyAllocation, snapshot, task: task.actor,
        unitIds, objectiveId, methodId: lease.methodId, action: lease.action });
    }
  }
  prepareBootstrapSites(snapshot, owner, options);
  const context = bootstrapDoctrineContext(snapshot, owner, version, options);
  prepareBootstrapLandMission(snapshot, owner, context);
  const authority = policy.strategyAllocation, grants = allocationGrants(authority);
  let sequence = 0;
  const nextId = () => `${owner}:strategy-command:${snapshot.tick}:${authority.revision}:${sequence++}`;
  const preflight = createStrategyCommandGateway({ snapshot, owner, memory: authority, grants, queuedTick: null });
  const rejected: CommandAdmission[] = [];
  const oldEntries = planAiCommandEntriesFromScripts(snapshot, owner, scripts, context, {
    admitCommands(script, commands) {
      const result = preflight.admit(scriptProposals(script.id, commands, authority, nextId));
      rejected.push(...result.admissions.filter(item => item.status === 'rejected'));
      return result.accepted.map(item => item.command);
    },
  });
  const feedbacks: ExecutorFeedback[] = [], formal: StrategyCommandProposal[] = [];
  for (const grant of grants) {
    const execution = authority.executions[grant.action.actionId]!, executor = defenseAndConquestExecutors.find(executor => executor.id === execution.executor);
    const objective = evaluation.objectives.find(objective => objective.id === grant.objectiveId), method = authority.methods[grant.methodId];
    // Imported producers run through the script adapter above, not a second
    // execution of their old module with a reconstructed target.
    if (!executor || !objective || !method) continue;
    const input: ExecutorInput = { snapshot, owner, objective, method, execution, grant, events: authority.events };
    const task = executor.execute(input), safety = observeWorkerSafetyInterruption(input);
    const feedback = safety ? { ...task, status: safety.status, blocked: safety.blocked,
      commands: [...safety.commands, ...task.commands], reasons: [...safety.reasons, ...task.reasons] } : task;
    feedbacks.push(feedback);
    for (const entry of feedback.commands) {
      const quote = entry.purpose === 'life-saving' && safety?.blocked.find(quote => 'unitIds' in entry.command
        && entry.command.unitIds.includes(quote.interruptedUnitId));
      formal.push({ id: nextId(), source: 'executor', executor: quote ? 'strategy.worker-safety' : execution.executor,
        ...(quote ? { interruptedCommandId: quote.interruptedCommandId } : {}),
        action: execution.token, allocationRevision: authority.revision, purpose: entry.purpose, command: entry.command });
    }
    for (const reason of feedback.reasons) context.executorReason?.(reason);
  }
  const scriptFinal = oldEntries.flatMap(entry => scriptProposals(entry.scriptId, [entry.command], authority, nextId));
  // Final admission includes afterPlan output. Preflight never records issued
  // orders or spends money; only the final admitted subset becomes provenance.
  let memory = authority;
  for (const feedback of feedbacks) memory = applyExecutorFeedback(memory, snapshot, feedback);
  const gateway = createStrategyCommandGateway({ snapshot, owner, memory, grants: allocationGrants(memory), queuedTick: null });
  const result = gateway.admit([...formal.filter(item => item.purpose === 'life-saving'), ...scriptFinal,
    ...formal.filter(item => item.purpose !== 'life-saving')]);
  memory = recordAllocationCommands(memory, snapshot, result.admissions);
  for (const scriptId of [...new Set(result.accepted.map(item => item.executor))].sort(compare))
    memory = recordIncumbentCommands(memory, snapshot, scriptId, result.accepted.filter(item => item.executor === scriptId).map(item => item.command), nextId);
  memory = pruneAllocationProvenance(advanceAllocationLeases(settleAllocationState(memory, snapshot), snapshot)); policy.strategyAllocation = memory;
  const admissions = [...rejected, ...result.admissions];
  const entries: AiCommandEntry[] = result.accepted.map(item => ({ scriptId: item.executor, command: item.command }));
  const output: BootstrapStrategyOutput = { decision: { ...evaluation, situation }, ...(observed ? { project: () => ({
    ...projectStrategyTrace(evaluation as ObservedStrategyDecision), allocation: projectStrategyAllocation(memory, admissions) }) } : {}) };
  return { entries, context, strategy: output };
}
