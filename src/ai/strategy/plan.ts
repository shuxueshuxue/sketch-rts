import { unitArrival } from './unit-arrivals';
import type { AiPolicyContext } from '../policy/types';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { distance } from '../policy/spatial';
import { snapshotUnitIndex } from './world-index';
import { withStrategyFrame } from './frame-reuse';
import { withGoalDistanceFieldLease } from '../../shared/terrain';
import { generateNavalObjectives, decomposeNavalObjective } from './naval-objectives';
import { LAND_OBJECTIVE_FAMILY } from './land-objectives';
import { evaluateSituation } from './situation';
import { observationHistory, observationMemory, retainObservationHistory } from './observation-memory';
import type { Assignment, BudgetEntry, IdleForce, MethodPlanner, ObjectiveGenerator, PlanningContext,
  Reason, Situation, SituationObservation, StrategyPlanTrace, Target, BlockedObjectiveQuote } from './types';
import { copiedDiagnosticRecord, deferredEvidence, deferredRecord, oneEvidenceProjection, projectedCopy, projectedValueReader } from './explanations';

/** Explicit read-only inputs, not a mutable global registry. A family owns no
 * evaluator; every family consumes exactly the same assessed Situation. */
export type ObjectiveFamily = Readonly<{
  id: string;
  generate: ObjectiveGenerator['generate'];
  decompose: MethodPlanner['decompose'];
  idleForces?: (situation: Situation, objectives: StrategyPlanTrace['objectives']) => readonly IdleForce[];
}>;
export const NAVAL_OBJECTIVE_FAMILY: ObjectiveFamily = { id: 'naval', generate: generateNavalObjectives, decompose: decomposeNavalObjective };

/** The ordinary objective generators, without method recipes or another
 * Situation evaluation. Goal planning consumes exactly this target list. */
export function generateStrategyObjectives(situation: Situation, context: PlanningContext,
  previous: readonly import('./observation-memory').PreviousObjective[] = [],
  families: readonly ObjectiveFamily[] = [NAVAL_OBJECTIVE_FAMILY, LAND_OBJECTIVE_FAMILY]) {
  return families.flatMap(family => family.generate(situation, context, previous)
    .map(objective => ({ family, objective })));
}

export function buildStrategyPlanTrace(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  _previous?: StrategyPlanTrace, families: readonly ObjectiveFamily[] = [NAVAL_OBJECTIVE_FAMILY, LAND_OBJECTIVE_FAMILY], observation?: SituationObservation, fieldBuildBudget = 1): StrategyPlanTrace {
  return withGoalDistanceFieldLease(snapshot.map, owner, snapshot.tick,
    () => withStrategyFrame(() => assembleStrategyPlanTrace(snapshot, owner, options, families, observation, fieldBuildBudget)));
}

function assembleStrategyPlanTrace(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  families: readonly ObjectiveFamily[], observation: SituationObservation | undefined, fieldBuildBudget: number): StrategyPlanTrace {
  const preparation = observationMemory(snapshot, owner, options.memory);
  const old = preparation.history && preparation.history.tick < snapshot.tick ? preparation.history : undefined;
  const context: PlanningContext = { snapshot, owner, memory: options.memory, ...(options.teams ? { teams: options.teams } : {}) };
  const situation = evaluateSituation(snapshot, owner, options.memory, old && observationHistory(preparation), options.teams ?? snapshot.teams, fieldBuildBudget, observation, preparation);
  const generated = generateStrategyObjectives(situation, context, old?.objectives ?? [], families);
  if (new Set(generated.map(entry => entry.objective.id)).size !== generated.length) throw new Error('Duplicate strategic objective id');
  const methods = generated.flatMap(({ family, objective }) => family.decompose(situation, objective, context));
  const idOrder = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const rows = generated.map(({ objective }) => ({ ...objective,
    utility: projectedCopy(objective.utility, { score: objective.status === 'blocked' ? null : objective.utility.score }),
    methodIds: methods.filter(method => method.objectiveId === objective.id).map(method => method.id) }));
  const feasible = rows.filter(objective => ['candidate', 'active'].includes(objective.status) && objective.utility.score !== null)
    .sort((a, b) => b.utility.score! - a.utility.score! || idOrder(a, b));
  const ranks = new Map(feasible.map((objective, index) => [objective.id, index + 1]));
  const candidates = rows.sort(idOrder).map(objective => ({ ...objective, rank: ranks.get(objective.id) ?? null }));
  const blockedObjectives: BlockedObjectiveQuote[] = candidates.filter(objective => objective.status === 'blocked').map(objective => {
    const alternatives = methods.filter(method => method.objectiveId === objective.id);
    return { objectiveId: objective.id,
      missingPreconditions: alternatives.flatMap(method => method.preconditions.flatMap(condition => condition.status === 'met' ? []
        : [{ methodId: method.id, preconditionId: condition.id, kind: condition.kind, status: condition.status, reason: condition.reason }])),
      potentialUtility: objective.conditionalQuote?.potentialUtility ?? null,
      potentialAssumptions: objective.conditionalQuote?.assumptions ?? objective.reasons,
      prerequisiteCost: alternatives.map(method => ({ methodId: method.id,
        knownGold: method.subgoals.reduce((sum, step) => sum + step.demands.reduce((sum, demand) => sum + (demand.kind === 'gold' ? demand.amount : 0), 0), 0),
        unknown: [...method.preconditions.filter(condition => condition.status === 'unknown').map(condition => condition.reason),
          ...method.subgoals.filter(step => step.kind === 'train-force' && !step.demands.some(demand => demand.kind === 'gold'))
            .flatMap(step => step.reasons)],
        alreadyIncludedUtilityCodes: objective.conditionalQuote?.includedPrerequisiteUtilityCodes ?? [] })) };
  });
  const objectives = candidates.map(objective => {
    const mines = objective.effects.flatMap(effect => effect.kind === 'mining-established' ? [effect.mineId] : []);
    const alternatives = candidates.filter(candidate => candidate.id !== objective.id && candidate.effects.some(effect =>
      effect.kind === 'mining-established' && mines.includes(effect.mineId))).map(candidate => candidate.id).sort();
    return alternatives.length ? { ...objective, alternativeObjectiveIds: alternatives } : objective;
  });
  const limitations: Reason[] = [...situation.limitations, { code: 'observation-not-control',
    detail: 'Scores, methods and budget below are proposals. Existing executors retain all command and ownership decisions.', evidence: [] },
  { code: 'no-formal-preemption-events', detail: 'Old modules retain no marginal-utility handoff record; inferred overlaps remain in unit commitments, not invented formal preemption events', evidence: [] }];
  const assignments: Assignment[] = [];
  const actors = snapshotUnitIndex(snapshot).all;
  const assetsById = new Map<string, Situation['assets'][number]>();
  for (const asset of situation.assets) if (!assetsById.has(asset.id)) assetsById.set(asset.id, asset);
  for (const unit of situation.units.filter(unit => unit.owner === owner)) for (const task of unit.commitments) {
    if (!task.objectiveId) continue;
    const taskEvidence = projectedValueReader(task, 'evidence');
    const objective = objectives.find(objective => objective.id === task.objectiveId);
    const claim = options.memory.unitClaims[unit.id];
    const separator = task.objectiveId.indexOf(':');
    const prefix = `${separator < 0 ? task.objectiveId : task.objectiveId.slice(0, separator)}:${owner}:`;
    const asset = !objective && task.objectiveId.startsWith(prefix) ? assetsById.get(task.objectiveId.slice(prefix.length)) : undefined;
    const target: Target = objective?.target ?? asset?.target ?? { point: { ...unit.location.point } };
    const arrival = (target.entityId ? unitArrival(unit, target.entityId) : undefined) ?? { status: 'unknown' as const,
      reason: deferredRecord({ code: 'assignment-route-unobserved', detail: 'No evaluated route to this retained task target; not zero ETA', evidence: [] }) };
    const raw = actors.get(unit.id)!;
    const followTarget = raw.order.type === 'follow' ? raw.order.targetId : null;
    const onStation = unit.location.kind === 'land' && unit.location.landId === target.landId && distance(unit.location.point, target.point) <= 650;
    const stage = onStation ? 'on-station' : unit.location.kind === 'aboard' || ['move', 'attackMove', 'attack', 'board', 'follow'].includes(raw.order.type) ? 'en-route' : 'assigned';
    const interruption = claim?.kind === 'workerSafety' ? 'worker-safety' as const
      : unit.commitments.some(commitment => ['frontRecovery.postRecoveryAssignments', 'mobileCare.claimsUnits', 'frontRecovery.accepted-plan', 'mobileCare.accepted-plan'].includes(commitment.source)) ? 'healing' as const
      : raw.order.type === 'move' && raw.order.avoidCombat && (claim?.kind === 'retreat' || raw.hp < raw.maxHp * .5) ? 'retreat' as const
      : followTarget && unit.hp < unit.maxHp && ['priest', 'fieldMedic'].includes(actors.get(followTarget)?.kind ?? '') ? 'healing' as const : undefined;
    const common = deferredEvidence({ id: `observed:${task.objectiveId}:${task.source}:${task.taskId}:${unit.id}`, objectiveId: task.objectiveId, methodId: null,
      unitId: unit.id, role: task.role, target: { ...target, point: { ...target.point } }, sinceTick: claim?.sinceTick ?? objective?.sinceTick ?? snapshot.tick,
      minimumStayUntilTick: objective?.stability.minimumStayUntilTick ?? snapshot.tick, arrival, authority: 'observed' as const }, oneEvidenceProjection(taskEvidence));
    assignments.push(interruption ? projectedCopy(common, { stage: 'life-saving-interruption' as const, resumeStage: stage,
      interruption: { kind: interruption, sinceTick: snapshot.tick, executor: 'inferred-current-order', reason: deferredEvidence(deferredRecord({ code: interruption,
        detail: 'Local interruption inferred from current order/claim; original task membership is retained' }), oneEvidenceProjection(taskEvidence)) } })
      : projectedCopy(common, { stage }));
    if (!objective) limitations.push(deferredEvidence({ code: 'unregistered-objective-family', detail: `${task.objectiveId}: ownership observed; its generator is not attached to this trace` }, oneEvidenceProjection(taskEvidence)));
  }
  const budget: BudgetEntry[] = methods.flatMap(method => method.subgoals.flatMap(subgoal => subgoal.demands.flatMap((demand, index) =>
    demand.kind === 'gold' ? [{ id: `${subgoal.id}/gold:${index}`, objectiveId: method.objectiveId, methodId: method.id,
      subgoalId: subgoal.id, gold: demand.amount, state: 'proposed' as const, authority: 'proposed' as const,
      sinceTick: snapshot.tick, releaseWhen: ['spent', 'completed', 'failed', 'abandoned', 'expired'] as const, releasedTick: null,
      evidence: [{ source: 'strategy.method.subgoals', tick: snapshot.tick, certainty: 'inferred' as const,
        detail: 'Alternative plan quote, not an additional cash reservation or already spent capital' }] }] : [])));
  const idleProviders = families.filter(family => family.idleForces);
  const idleQuotes = idleProviders.length ? idleProviders.flatMap(family => family.idleForces!(situation, objectives))
    : [{ unitIds: situation.units.filter(unit => unit.owner === owner && unit.location.kind === 'land' && !unit.roles.includes('worker')
      && !unit.commitments.length && unit.hp >= unit.maxHp * .8 && ['idle', 'hold'].includes(actors.get(unit.id)!.order.type)).map(unit => unit.id),
    opportunityCostGold: 0, alternativeObjectiveId: null, reason: { code: 'idle-alternative-unknown',
      detail: 'No land attack/pressure quotation provider attached; zero quoted cost is unknown, not proof that idling is optimal', evidence: [] } }].filter(idle => idle.unitIds.length);
  const idleForces = mergeIdleForces(idleQuotes, situation, objectives);
  retainObservationHistory(preparation, situation, objectives);
  if (preparation.truncated) limitations.push({ code: 'observation-history-truncated',
    detail: 'The bounded observation ledger discarded older facts; absent historical objectives and lost sites remain unknown', evidence: [] });
  return { schemaVersion: 1, tick: snapshot.tick, owner, mode: 'observe', situation, objectives, methods, assignments,
    feasibleObjectiveIds: feasible.map(objective => objective.id), blockedObjectives,
    preemptions: [], budget: budget.map(value => deferredRecord(value)),
    idleForces: idleForces.map(quote => ({ ...quote, reason: copiedDiagnosticRecord(quote.reason) })), limitations: limitations.map(value => deferredRecord(value)) };
}

/** Families quote alternatives against the complete objective set. A quote's
 * total is shared equally by its units before comparing overlapping offers;
 * a unit can forgo only one best alternative, not one per family. */
export function mergeIdleForces(quotes: readonly IdleForce[], situation: Situation,
  objectives: StrategyPlanTrace['objectives']): IdleForce[] {
  const chosen = new Map<string, IdleForce>();
  for (const quote of quotes) {
    const ids = [...new Set(quote.unitIds)];
    if (!Number.isFinite(quote.opportunityCostGold) || quote.opportunityCostGold < 0) throw new Error('Invalid idle opportunity cost');
    const alternative = objectives.find(objective => objective.id === quote.alternativeObjectiveId);
    const cost = alternative && alternative.utility.score !== null && alternative.utility.score > 0
      && ['candidate', 'active'].includes(alternative.status)
      ? quote.opportunityCostGold / Math.max(1, ids.length) : 0;
    for (const id of ids) {
      const unit = situation.units.find(unit => unit.id === id);
      if (!unit || unit.owner !== situation.owner || unit.location.kind !== 'land'
        || unit.commitments.length || unit.roles.some(role => ['worker', 'transport', 'warship'].includes(role))) continue;
      const next: IdleForce = { ...quote, unitIds: [id], opportunityCostGold: cost,
        alternativeObjectiveId: cost > 0 ? quote.alternativeObjectiveId : null,
        reason: cost > 0 || quote.alternativeObjectiveId === null ? quote.reason : { code: 'idle-alternative-not-feasible',
          detail: 'Quoted alternative is absent, completed, failed, abandoned or has no positive utility; opportunity cost remains unknown', evidence: quote.reason.evidence } };
      const previous = chosen.get(id);
      if (!previous || cost > previous.opportunityCostGold || cost === previous.opportunityCostGold
        && (next.alternativeObjectiveId ?? '') < (previous.alternativeObjectiveId ?? '')) chosen.set(id, next);
    }
  }
  return [...chosen].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, quote]) => quote);
}
