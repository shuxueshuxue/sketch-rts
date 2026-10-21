import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import type { AllocationArrivalReader } from './allocation-arrival-query';
import type { AllocationMethodQuoteInput, AllocationPrecondition, AllocationReason, ExecutableMethod, StrategyAllocationInput } from './allocation-types';
import type { AssemblyFacts, AssemblyFactsReader, AssemblyFactsRequest } from './assembly-facts';
import { readAssemblySupply, type AssemblyAssessmentCohort } from './assembly-supply-reader';
import { combineAssemblyContinuations } from './assembly-continuation';
import { adaptAssemblyDelayLoss } from './assembly-delay-adapter';
import { valueAssemblyDelayLoss, type AssemblyReadyTime } from './assembly-delay-loss';
import { assemblyContinuationValueCap } from './assembly-value-cap';
import { valueConquestContinuation, type ConquestContinuationInput } from './conquest-value';
import type { DecisionFacts } from './decision';
import type { ForceAssemblyForecast } from './force-assembly-forecast';
import type { Situation, ValuationWindow } from './types';
import { sameValuationWindow, valuationWindow } from './utility';
import type { VoyageRiskStages } from './voyage-risk';
import { CRITICAL_FACT_CANDIDATES, currentFactWork } from './fact-work';
import { canonicalProductionUses } from './production-use';

/** Assessment graphs live only in this think, never in allocation memory. */
export type AssemblyPathPreparation = Readonly<{
  pathId: string; readyTick: number; method: ExecutableMethod | null;
  materializedInput: AllocationMethodQuoteInput | null;
  settlement: ConquestContinuationInput | null;
  missing: readonly AllocationPrecondition[]; assumptions: readonly AllocationReason[];
  coverage: 'complete' | 'known-effects'; completedInTicks: number | null;
}>;
type Supply = ReturnType<typeof readAssemblySupply>;
type AssemblyRecord<Prepared extends AssemblyPathPreparation> = { request: AssemblyFactsRequest; supply: Supply; window: ValuationWindow;
  prepared: readonly Prepared[]; settled?: readonly Prepared[]; facts?: AssemblyFacts };
const sorted = (values: readonly string[] | undefined) => [...new Set(values ?? [])].sort();
const keyFor = (request: AssemblyFactsRequest) => JSON.stringify({ objective: request.objective.id, method: request.methodId,
  required: request.requiredForce, target: request.campTarget, posts: request.posts.map(post => ({ ...post, unitIds: sorted(post.unitIds) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), units: sorted(request.unitIds),
  response: sorted(request.responseEligibleUnitIds), interrupted: sorted(request.interruptedUnitIds),
  window: request.valuation?.window ?? null, allowed: sorted(request.valuation?.allowedUnitIds),
  unavailable: sorted(request.valuation?.unavailableUnitIds),
  allowedProduction: request.valuation?.allowedProduction ? [...request.valuation.allowedProduction]
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId) || a.lane.localeCompare(b.lane)) : null,
  unavailableProduction: canonicalProductionUses(request.valuation?.unavailableProduction) });

/** One shared supply/physical batch boundary for gross/net and displacement.
 * prepare may only consume this think's shared Arrival reader. settle only
 * consumes the single published risk map and cannot run navigation again. */
export function createAssemblyFactsTransaction<Prepared extends AssemblyPathPreparation>(input: Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; version: BootstrapAiVersion; arrival: AllocationArrivalReader;
  committedObjectiveIds?: readonly string[];
  prepare: (request: AssemblyFactsRequest, cohort: AssemblyAssessmentCohort) => Prepared;
  settle: (prepared: Prepared, risks: ReadonlyMap<string, VoyageRiskStages>) => Prepared;
  committedRequest: (objectiveId: string, methodId: string, unitIds: readonly string[]) => AssemblyFactsRequest | null;
}>) {
  const { snapshot } = input, records = new Map<string, AssemblyRecord<Prepared>>(), supplies = new Map<string, Supply>();
  let risks: ReadonlyMap<string, VoyageRiskStages> = new Map();
  const proofs = new Map<string, { quotation: ReturnType<typeof adaptAssemblyDelayLoss>;
    continuationCap: ReturnType<typeof assemblyContinuationValueCap> }>();
  const supply = (request: AssemblyFactsRequest) => {
    const key = keyFor(request), cached = supplies.get(key);
    if (cached) return cached;
    const value = readAssemblySupply({ ...input, request }); supplies.set(key, value); return value;
  };
  const prepare = (request: AssemblyFactsRequest, value: Supply) => value.cohorts.map(cohort => input.prepare(request, cohort));
  const precondition = (request: AssemblyFactsRequest, code: string, status: 'unknown' | 'unmet', factIds: readonly string[]): AllocationPrecondition => ({
    id: `${request.methodId}/${code}:${factIds.join(',')}`, kind: 'force', status,
    reason: { code, factIds, values: {} }, demand: null, subgoalIds: [`${request.methodId}/assemble-force`] });
  const get = (request: AssemblyFactsRequest): AssemblyRecord<Prepared> => {
    const key = keyFor(request), existing = records.get(key);
    if (existing) return existing;
    let value = supply(request), prepared = prepare(request, value);
    // Use one explicit whole-comparison window for every empirical path.
    // There is no conditional-mean ready-time money settlement.
    const window = request.valuation?.window ?? valuationWindow(Math.max(0,
      ...prepared.map(path => path.completedInTicks ?? path.readyTick - snapshot.tick)));
    if (!request.valuation?.window) {
      request = { ...request, valuation: { ...request.valuation, phase: request.valuation?.phase ?? 'gross', window } };
      value = supply(request); prepared = prepare(request, value);
    }
    const record = { request, supply: value, window, prepared };
    records.set(key, record); return record;
  };
  const read: AssemblyFactsReader = request => {
    const record = get(request);
    if (record.facts) return record.facts;
    const { forecast } = record.supply, missing: AllocationPrecondition[] = [];
    const requiredSupplyMissing = record.supply.missing.filter(fact => fact.code === 'assembly-target-camp-unobserved'
      || forecast.completionProbability === 0);
    missing.push(...requiredSupplyMissing.map(fact => precondition(request, fact.code, fact.status, fact.factIds)));
    const paths = record.prepared.map(path => input.settle(path, risks));
    record.settled = paths;
    for (const path of paths) if (!path.settlement) missing.push(...path.missing);
    for (const cohort of record.supply.cohorts) missing.push(...cohort.missing.map(fact => precondition(request, fact.code, fact.status, fact.factIds)));
    const combined = combineAssemblyContinuations({ forecast, window: record.window, paths: paths.map(path => ({
      pathId: path.pathId, readyTick: path.readyTick, window: record.window,
      utility: path.settlement ? valueConquestContinuation({ ...path.settlement, window: record.window }).utility : null,
      assumptions: path.assumptions })) });
    const limitations: AllocationReason[] = record.supply.calibration.limitations.map(limit => ({ ...limit,
      factIds: [record.supply.calibration.calibrationId] }));
    const continuation = combined.status === 'known' ? { utility: combined.utility, window: combined.window,
      assemblyDelayApplied: true as const, assumptions: [...combined.assumptions, ...limitations] } : null;
    if (!continuation && forecast.completionProbability > 0 && !missing.length)
      missing.push(...combined.missing.map(reason => ({ ...precondition(request, reason.code, 'unknown', reason.factIds), reason })));
    record.facts = { forecast, continuation, missing: [...new Map(missing.map(fact => [fact.id, fact])).values()] };
    return record.facts;
  };
  const ready = (forecast: ForceAssemblyForecast, pathId: string): AssemblyReadyTime => {
    const path = forecast.fillScenarios.find(path => path.id === pathId);
    if (path?.readyTick !== null && path?.readyTick !== undefined) return { status: 'ready', tick: path.readyTick };
    if (!path || forecast.missing.some(fact => fact.status === 'unknown'
      && (fact.code !== 'assembly-conditional-support-exhausted' || fact.factIds.includes(pathId)))) return { status: 'unknown' };
    return { status: 'not-filled' };
  };
  const delayUpperBound: NonNullable<StrategyAllocationInput['assemblyDelayLossUpperBound']> = request => {
    const base = input.committedRequest(request.objectiveId, request.methodId, request.unitIds);
    if (!base) return { status: 'unknown', reasonCode: 'assembly-continuation-value-unknown' };
    const beforeRequest: AssemblyFactsRequest = { ...base, unitIds: request.unitIds,
      valuation: { ...base.valuation, phase: 'gross', window: request.window,
        allowedUnitIds: base.valuation?.allowedUnitIds
          ? request.unitIds.filter(id => base.valuation!.allowedUnitIds!.includes(id)) : request.unitIds } };
    const beforeSupply = supply(beforeRequest);
    const before = [...records.values()].find(record => keyFor(record.request) === keyFor(beforeRequest)
      && sameValuationWindow(record.window, request.window));
    // Only the supply counterfactual is needed here. Reuse an already prepared
    // before cash schedule when available; an absent schedule uses the proved
    // whole cap and never launches another physical-plan batch from the oracle.
    const afterSupply = supply({ ...beforeRequest, unitIds: request.remainingUnitIds, valuation: { ...beforeRequest.valuation!,
      unavailableUnitIds: sorted([...(base.valuation?.unavailableUnitIds ?? []),
        ...request.unitIds.filter(id => !request.remainingUnitIds.includes(id))]),
      unavailableProduction: canonicalProductionUses([...(base.valuation?.unavailableProduction ?? []), ...request.unavailableProduction]) } });
    const cap = assemblyContinuationValueCap(snapshot, base.objective, request.window);
    const paired = beforeSupply.forecast.fillScenarios.map(path => {
      const prepared = before?.prepared.find(value => value.pathId === path.id);
      const settled = prepared && input.settle(prepared, risks);
      return { pathId: path.id, probability: path.probability,
        before: ready(beforeSupply.forecast, path.id), after: ready(afterSupply.forecast, path.id),
        plan: settled?.settlement ? { readyTick: settled.readyTick, coverage: settled.coverage, input: settled.settlement } : null };
    });
    const value = valueAssemblyDelayLoss({ forecastTick: snapshot.tick, window: request.window,
      valueCapGold: cap.status === 'known' ? cap.gold : null,
      capFactIds: cap.status === 'known' ? cap.components.flatMap(term => term.factIds) : cap.reason.factIds, scenarios: paired });
    const adapted = adaptAssemblyDelayLoss(base.objective.target.entityId ?? base.objective.id, value);
    // When the entire cap is charged, retain its native income/persistence
    // formation directly in the formal event, not merely a bare cap number.
    const quotation = adapted.status === 'known' && cap.status === 'known' && adapted.bound.mode === 'whole-value-cap'
      && adapted.bound.gold === cap.gold ? { ...adapted, bound: { ...adapted.bound, components: cap.components } } : adapted;
    proofs.set(JSON.stringify(request), { quotation, continuationCap: cap }); return quotation;
  };
  return { read, delayUpperBound,
    prioritizeFacts() {
      const committed = new Set(input.committedObjectiveIds ?? []);
      const candidates = [...new Set([...records.values()].filter(record => record.request.unitIds.length
        && record.supply.spawnRequests.some(request => request.status === 'pending'))
        .map(record => record.request.objective.id))].sort();
      const critical = new Set([...committed, ...candidates.filter(id => !committed.has(id)).slice(0, CRITICAL_FACT_CANDIDATES)]);
      currentFactWork()?.prioritizePoints([...records.values()].filter(record => critical.has(record.request.objective.id))
        .flatMap(record => record.supply.spawnRequests.filter(request => request.status === 'pending').map(request => request.goal)));
    },
    riskMethods: () => [...new Map([...records.values()].flatMap(record => record.prepared
      .flatMap(path => path.method && path.missing.every(condition => condition.status !== 'unmet')
        ? [[path.method.id, path.method] as const] : []))).values()],
    publishRisks(published: ReadonlyMap<string, VoyageRiskStages>) {
      risks = published;
      for (const record of records.values()) { delete record.facts; delete record.settled; }
    },
    /** Finite, numeric provenance only; never serialize projected snapshots,
     * callback functions or complete source/member-stock graphs into trace. */
    project: () => ({ spawnRequests: [...new Map([...supplies.values()].flatMap(value => value.spawnRequests.map(request => [request.id, request] as const))).values()],
      requests: [...records.values()].map(record => ({ objectiveId: record.request.objective.id,
      methodId: record.request.methodId, unitIds: record.request.unitIds, window: record.window,
      calibrationId: record.supply.calibration.calibrationId, forecast: { ...record.supply.forecast,
        conditionalProduction: record.supply.forecast.conditionalProduction ? {
          source: record.supply.forecast.conditionalProduction.source,
          calibrationId: record.supply.forecast.conditionalProduction.calibrationId,
          phase: record.supply.forecast.conditionalProduction.phase,
          sampleCount: record.supply.forecast.conditionalProduction.sampleCount,
          timeMaeTicks: record.supply.forecast.conditionalProduction.timeMaeTicks,
          timeP90ErrorTicks: record.supply.forecast.conditionalProduction.timeP90ErrorTicks,
        } : null },
      limitations: record.supply.calibration.limitations,
      paths: (record.settled ?? record.prepared).map(path => ({ pathId: path.pathId, readyTick: path.readyTick, methodId: path.method?.id ?? null,
        voyageIds: path.method?.voyagePlans?.map(voyage => voyage.id) ?? [], coverage: path.coverage,
        missing: path.missing, assumptions: path.assumptions })) })),
      delayProofs: [...proofs.values()] }),
  };
}
