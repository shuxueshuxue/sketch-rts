import type { BootstrapAiVersion, GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiCommandEntry, AiPolicyContext, AiScript } from '../policy/types';
import { planAiCommandEntriesFromScripts } from '../policy/core';
import { bootstrapDoctrineContext } from '../bootstrap_1/policy';
import { migrateExpansionClaims } from '../bootstrap_1/expansion-mission';
import { maintainExpansionGarrisons } from '../bootstrap_1/expansion-garrison';
import type { StrategyDecision } from './decision';
import type { AllocationPrecondition, AllocationReason, CommandAdmission, ExecutorFeedback, ExecutorInput,
  PlannedVoyage } from './allocation-types';
import type { VoyageRiskStages } from './voyage-risk';
import type { StrategyPlanTrace, Target } from './types';
import { allocateStrategy } from './allocator';
import { allocationGrants, applyExecutorFeedback, pruneAllocationProvenance, settleAllocationState, advanceAllocationLeases } from './allocation-lifecycle';
import { recordAllocationCommands, refreshAllocationCapital, releaseEndedGoalCapital } from './allocation-ledger';
import { projectStrategyAllocation } from './allocation-trace';
import { withAllocationLandRoutes } from './allocation-arrival-query';
import { observeWorkerSafetyInterruption } from './executors/worker-safety';
import { createStrategyAllocationMemory } from './control';
import { importExecutedIncumbents, incumbentTasks, withFormalCommitments, continuesImportedProgress } from './incumbent-import';
import { handoffIncumbent } from './incumbent-handoff';
import { incumbentDisposition, recordCandidateReassignment, recordIncumbentCommands } from './incumbent-evidence';
import { importedMiningLossUpperBound } from './imported-loss-bound';
import { createStrategyCommandGateway, type StrategyCommandProposal } from './command-gateway';
import { FactWorkQueue, withFactWork } from './fact-work';
import { beginObservationThink, boundObservationMemory, observationMemory } from './observation-memory';
import { isLifeSavingScript, recordScriptSafetyInterruptions } from './script-safety';
import { withNavigationPhase } from '../../shared/navigation-audit';
import { withGoalPlannerInput, type GoalPlannerNativeFrame } from './goal-planner-input';
import { planGoals } from './goal-planner';
import type { GoalPlannerInput, GoalPlannerOutput } from './goal-planner-types';
import { reserveAdmittedGoalCapital } from './goal-capital-commitment';
import { createGoalPlanMethods } from './goal-plan-methods';
import { goalEconomyExecutors } from './executors/goal-economy';
import { goalLandExecutors } from './executors/goal-land';
import { goalNavalExecutors } from './goal-naval-executors';
import { goalTrainingReader, observeGoalTraining } from './goal-training-ledger';
import { continuedIncumbentScripts, isIncumbentStrategyScript } from './incumbent-scripts';
import { settleCommittedGoals } from './goal-commitment-objectives';
import { readGoalObjective, restoreGoalAuthorityReferences } from './goal-authority-references';
import { reconcileGoalCapitalReceipts } from './goal-capital-receipts';
const goalExecutors = [...goalEconomyExecutors, ...goalLandExecutors, ...goalNavalExecutors];

export type AllocationCandidateRequest = Readonly<{ objectiveId: string; methodId: string; phase: 'skeleton' | 'gross' | 'net';
  /** These are proposed bundles, not an assertion that authority was granted. */
  unitIds: readonly string[]; actions: readonly Readonly<{ actionId: string; target: Target; unitIds: readonly string[] | null }>[];
  voyages: readonly PlannedVoyage[];
  quotation: Readonly<{ status: 'feasible' | 'blocked'; score: number | null; reason: AllocationReason;
    missingPreconditions: readonly AllocationPrecondition[] }> | null;
  stageRisks: readonly Readonly<{ voyageId: string; risk: VoyageRiskStages | null }>[] }>;
export type BootstrapStrategyOutput = Readonly<{ decision: StrategyDecision; project?: () => StrategyPlanTrace;
  /** Same-think sidecar; never stored in memory or the plan trace. */
  candidateRequests?: readonly AllocationCandidateRequest[];
  goalPlanner?: GoalPlannerOutput }>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function scriptProposals(scriptId: string, commands: readonly GameCommand[],
  nextId: () => string): StrategyCommandProposal[] {
  // Imported bookkeeping neither turns a native producer into a formal
  // executor nor splits its bulk commands or charges a fictional budget.
  return commands.map(command => ({ id: nextId(), source: 'script', executor: scriptId,
    action: null, allocationRevision: null, purpose: isLifeSavingScript(scriptId) ? 'life-saving' : 'task', command }));
}

/** Replacing these native unit orders has no cash fee and neither cancels a
 * paid production job nor destroys a foundation. Remaining travel/work value
 * is charged for a different use by the same-window displaced-plan oracle.
 * Continuing an explicitly matched goal adopts that progress instead. */
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
  if (options.memory.strategyAllocation) options.memory.strategyAllocation = restoreGoalAuthorityReferences(options.memory.strategyAllocation);
  if (options.memory.strategyAllocation) options.memory.strategyAllocation = reconcileGoalCapitalReceipts(options.memory.strategyAllocation, snapshot);
  if (options.memory.strategyAllocation) options.memory.strategyAllocation = refreshAllocationCapital(options.memory.strategyAllocation,
    snapshot.players[owner]?.gold ?? 0, snapshot.tick);
  const preparation = observationMemory(snapshot, owner, options.memory);
  const work = new FactWorkQueue(snapshot.tick, undefined, preparation.factWork, beginObservationThink(preparation));
  return withFactWork(work, () => {
    try { return controlledBootstrapCommands(snapshot, owner, version, scripts, options, observation); }
    finally { preparation.factWork = work.flush(); boundObservationMemory(preparation); }
  });
}
function controlledAllocation(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  observation: 'none' | 'facts' | 'trace', planning: GoalPlannerInput, frame: GoalPlannerNativeFrame) {
  const policy = options.memory, evaluation = frame.decision;
  let imported = importExecutedIncumbents(snapshot, policy, evaluation.situation,
    observeGoalTraining(policy.strategyAllocation ?? createStrategyAllocationMemory(owner, snapshot.tick), snapshot));
  policy.strategyAllocation = imported;
  const situation = withFormalCommitments(evaluation.situation, imported);
  const goalPlanner = planGoals(planning); policy.goalPlanning!.cache = goalPlanner.cache;
  imported = settleCommittedGoals(imported, [], evaluation.objectives, snapshot.tick);
  imported = releaseEndedGoalCapital(imported, goalPlanner.plans, snapshot.tick);
  imported = reserveAdmittedGoalCapital(imported, goalPlanner.plans, snapshot.players[owner]?.gold ?? 0, snapshot.tick);
  policy.strategyAllocation = imported;
  const bundle = createGoalPlanMethods({ snapshot, objectives: evaluation.objectives, output: goalPlanner,
    resolve: frame.resolveReference, requote: frame.requote });
  const candidateRequests = observation === 'none' ? undefined : new Map<string, AllocationCandidateRequest>();
  const continuesImported = (fromId: string, toId: string) => {
    const objective = evaluation.objectives.find(objective => objective.id === toId);
    return !!objective && continuesImportedProgress(snapshot, policy, imported, fromId, objective);
  };
  let handoffPolicy: typeof policy | undefined;
  const allocation = allocateStrategy({ snapshot, situation, objectives: evaluation.objectives,
    methods: bundle.methods, providers: [bundle.provider], previous: imported,
    continuesImported,
    importedUpperBound: (objectiveId, window) => {
      const targetId = imported.objectives[objectiveId]?.target.entityId;
      return targetId ? importedMiningLossUpperBound(situation, evaluation.objectives, targetId, window) : null;
    },
    ...(candidateRequests ? { observeCandidate: request => {
      const row: AllocationCandidateRequest = { objectiveId: request.objectiveId, methodId: request.method.id,
        phase: request.phase, unitIds: request.unitIds,
        actions: request.method.actions.map(action => ({ actionId: action.id, target: action.target, unitIds: action.unitIds ?? null })),
        voyages: [], quotation: { status: request.quote.status, score: request.quote.utility?.score ?? null,
          reason: request.quote.reason, missingPreconditions: request.quote.missingPreconditions }, stageRisks: [] };
      candidateRequests.set(JSON.stringify(row), row);
    } } : {}),
    switchingCost: request => continuesImported(request.fromObjectiveId, request.toObjectiveId) ? 0 : nativeSwitchCost(snapshot, request.resourceKeys),
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
  });
  return { policy, evaluation, situation, candidateRequests, handoffPolicy, allocation, goalPlanner };
}
function controlledBootstrapCommands(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion,
  scripts: AiScript[], options: AiPolicyContext, observation: 'none' | 'facts' | 'trace') {
  return withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner, version, memory: options.memory,
    captureTrace: observation === 'trace', interruptedUnitIds: Object.values(options.memory.strategyAllocation?.assignments ?? {})
      .filter(assignment => assignment.interruption).map(assignment => assignment.unitId) },
    (planning, frame) => executeControlledBootstrapCommands(snapshot, owner, version, scripts, options, observation, planning, frame)));
}
function executeControlledBootstrapCommands(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion,
  scripts: AiScript[], options: AiPolicyContext, observation: 'none' | 'facts' | 'trace',
  planning: GoalPlannerInput, frame: GoalPlannerNativeFrame) {
  const { policy, evaluation, situation, candidateRequests, handoffPolicy, allocation, goalPlanner }
    = controlledAllocation(snapshot, owner, options, observation, planning, frame);
  const landRouteReader = frame.landRoute;
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
      const lease = policy.strategyAllocation!.leases[`unit:${unitIds[0]}`]!;
      const eventId = `${owner}:allocation:${policy.strategyAllocation!.nextEventSequence}`;
      if (!handoffIncumbent(snapshot, owner, policy, task.actor, unitIds, eventId, 'candidate-reassigned'))
        throw new Error('Candidate producer did not acknowledge reassignment');
      policy.strategyAllocation = recordCandidateReassignment({ memory: policy.strategyAllocation!, snapshot, task: task.actor,
        unitIds, objectiveId, methodId: lease.methodId, action: lease.action });
    }
  }
  const context = withNavigationPhase('incumbent', () => {
    // Keep established post bookkeeping. New land/island missions belong to
    // the goal planner; receipt-backed old producers prepare their own task.
    migrateExpansionClaims(snapshot, policy);
    maintainExpansionGarrisons(snapshot, owner, options);
    return bootstrapDoctrineContext(snapshot, owner, version, options);
  });
  const authority = policy.strategyAllocation!, grants = allocationGrants(authority);
  const incumbentScripts = continuedIncumbentScripts(scripts, authority);
  const incumbentOnlyScripts = new Set(incumbentScripts.filter(isIncumbentStrategyScript).map(script => script.id));
  const managedExpansionSites = evaluation.objectives.filter(objective => ['ExpandLand', 'ConquerIsland'].includes(objective.kind)
    && !['complete', 'failed', 'abandoned'].includes(objective.status)).map(objective => objective.target);
  let sequence = 0;
  const nextId = () => `${owner}:strategy-command:${snapshot.tick}:${authority.revision}:${sequence++}`;
  const preflight = createStrategyCommandGateway({ snapshot, owner, memory: authority, grants, queuedTick: null, incumbentOnlyScripts, managedExpansionSites });
  const rejected: CommandAdmission[] = [];
  const oldEntries = withNavigationPhase('incumbent', () => planAiCommandEntriesFromScripts(snapshot, owner, incumbentScripts, context, {
    admitCommands(script, commands) {
      const result = preflight.admit(scriptProposals(script.id, commands, nextId));
      rejected.push(...result.admissions.filter(item => item.status === 'rejected'));
      return result.accepted.map(item => item.command);
    },
  }));
  const feedbacks: ExecutorFeedback[] = [], formal: StrategyCommandProposal[] = [];
  for (const grant of grants) {
    const execution = authority.executions[grant.action.actionId]!, executor = goalExecutors.find(executor => executor.id === execution.executor);
    const objective = evaluation.objectives.find(objective => objective.id === grant.objectiveId)
      ?? (execution.intent.kind === 'goal-action' ? readGoalObjective(authority, grant.objectiveId) : undefined);
    const method = authority.methods[grant.methodId];
    // Imported producers run through the script adapter above, not a second
    // execution of their old module with a reconstructed target.
    if (!executor || !objective || !method) continue;
    const input: ExecutorInput = { snapshot, owner, objective, method, execution, grant, events: authority.events,
      ...(authority.goalReferences ? { goalReferences: authority.goalReferences } : {}),
      goalFacts: frame.executionFacts(authority, grant.objectiveId), goalTraining: goalTrainingReader(authority, snapshot) };
    const { task, safety } = withNavigationPhase('strategy-planning', () => withAllocationLandRoutes(landRouteReader,
      () => ({ task: executor.execute(input), safety: observeWorkerSafetyInterruption(input) })));
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
  const scriptFinal = oldEntries.flatMap(entry => scriptProposals(entry.scriptId, [entry.command], nextId));
  // Final admission includes afterPlan output. Preflight never records issued
  // orders or spends money; only the final admitted subset becomes provenance.
  let memory = authority;
  for (const feedback of feedbacks) memory = applyExecutorFeedback(memory, snapshot, feedback);
  const gateway = createStrategyCommandGateway({ snapshot, owner, memory, grants: allocationGrants(memory), queuedTick: null, incumbentOnlyScripts, managedExpansionSites });
  const result = gateway.admit([...formal.filter(item => item.purpose === 'life-saving'), ...scriptFinal,
    ...formal.filter(item => item.purpose !== 'life-saving')]);
  memory = recordAllocationCommands(memory, snapshot, result.admissions);
  memory = recordScriptSafetyInterruptions(memory, snapshot, situation, result.admissions);
  for (const scriptId of [...new Set(result.accepted.map(item => item.executor))].sort(compare))
    memory = recordIncumbentCommands(memory, snapshot, scriptId, result.accepted.filter(item => item.executor === scriptId).map(item => item.command), nextId);
  memory = settleCommittedGoals(memory, goalPlanner.plans, evaluation.objectives, snapshot.tick);
  memory = pruneAllocationProvenance(advanceAllocationLeases(settleAllocationState(memory, snapshot), snapshot)); policy.strategyAllocation = memory;
  const admissions = [...rejected, ...result.admissions];
  const entries: AiCommandEntry[] = result.accepted.map(item => ({ scriptId: item.executor, command: item.command }));
  const output: BootstrapStrategyOutput = { decision: { ...evaluation, mode: 'control', situation },
    goalPlanner,
    ...(candidateRequests ? { candidateRequests: [...candidateRequests.values()] } : {}), ...(frame.project ? { project: () => ({
    ...frame.project!(), mode: 'control', allocation: projectStrategyAllocation(memory, admissions) }) } : {}) };
  return { entries, context, strategy: output };
}
