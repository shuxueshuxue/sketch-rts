import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { FactWorkQueue } from './fact-work';
import { factPublicationPending } from './fact-work';
import { goalValueKey } from './goal-facts';
import { boundCache, retainCachePins, touchCache, type CacheCapacity, type CacheUse } from './bounded-cache';
import { observationJsonBytes } from './observation-json-bytes';
import type { StrategyObservationMemory } from './observation-memory';
import { assessVoyageRisks, VOYAGE_RISK_MEMORY_BYTES, type VoyageRisk, type VoyageRiskMemory, type VoyageRiskRequest } from './voyage-risk';

export type GoalVoyageRiskMemory = {
  model: VoyageRiskMemory;
  publications: ({ id: string; readyTick: number; readyThink?: number } & CacheUse)[];
  publicationCapacity?: CacheCapacity;
  batchCapacity?: CacheCapacity;
};

type VoyageEvidence = CacheUse & {
  id: string; publication?: GoalVoyageRiskMemory['publications'][number];
  progress?: VoyageRiskMemory['entries'][number]; nativeRoute?: NonNullable<VoyageRiskMemory['nativeRoutes']>[number];
};
function voyageEvidence(memory: GoalVoyageRiskMemory): VoyageEvidence[] {
  const entries = new Map<string, VoyageEvidence>();
  for (const publication of memory.publications) entries.set(publication.id, { ...publication, publication });
  for (const progress of memory.model.entries) entries.set(progress.id, { id: progress.id, ...entries.get(progress.id), progress });
  for (const nativeRoute of memory.model.nativeRoutes ?? []) entries.set(nativeRoute.id,
    { id: nativeRoute.id, ...entries.get(nativeRoute.id), nativeRoute });
  return [...entries.values()];
}
function modelPayload(model: VoyageRiskMemory, entries: readonly VoyageEvidence[]): VoyageRiskMemory {
  const nativeRoutes = entries.flatMap(entry => entry.nativeRoute ? [entry.nativeRoute] : []);
  return { ...model, entries: entries.flatMap(entry => entry.progress ? [entry.progress] : []),
    ...(model.nativeRoutes !== undefined || nativeRoutes.length ? { nativeRoutes } : {}) };
}
function evidencePayload(memory: GoalVoyageRiskMemory, entries: readonly VoyageEvidence[]) {
  return { model: modelPayload(memory.model, entries), publications: entries.flatMap(entry => entry.publication ? [entry.publication] : []) };
}

/** A publication and the native progress that makes it meaningful are one
 * cache entry. Diagnostics are outside the original 16KiB evidence payload. */
export function boundGoalVoyageRiskPublications(memory: GoalVoyageRiskMemory, thinkSequence: number) {
  const result = boundCache({ kind: 'goal-voyage-publications', entries: voyageEvidence(memory),
    id: entry => entry.id, lastUsed: entry => entry.lastUsedThink ?? entry.publication?.readyThink ?? entry.publication?.readyTick ?? 0,
    plans: entry => entry.planIds ?? [], maxEntries: 128, maxBytes: VOYAGE_RISK_MEMORY_BYTES,
    bytes: entries => observationJsonBytes(evidencePayload(memory, entries)), thinkSequence,
    ...(memory.publicationCapacity ? { capacity: memory.publicationCapacity } : {}) });
  const payload = evidencePayload(memory, result.entries);
  Object.assign(memory.model, payload.model); memory.publications = payload.publications;
  memory.publicationCapacity = result.capacity;
  return result;
}
export function retainGoalVoyageRiskPublications(memory: GoalVoyageRiskMemory,
  references: ReadonlyMap<string, ReadonlySet<string>>, thinkSequence: number) {
  retainCachePins(memory.publications, references, entry => entry.id, thinkSequence);
  const pressure = memory.batchCapacity?.pressure;
  if (pressure) {
    const planIds = pressure.planIds.filter(id => references.has(id));
    const requestIds = pressure.requestIds.filter(id => planIds.some(plan => pressure.thinkSequence === thinkSequence || references.get(plan)!.has(id)));
    memory.batchCapacity = { overflowCount: memory.batchCapacity!.overflowCount,
      ...(requestIds.length ? { pressure: { ...pressure, planIds, requestIds } } : {}) };
  }
  return boundGoalVoyageRiskPublications(memory, thinkSequence);
}
/** One native risk batch on the existing fact queue. Reads validate already
 * published model progress on a copy without sampling or native route work.
 * Only the registered batch can advance the live sampling cursor. */
export function createGoalVoyageRiskReader(input: Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; work: FactWorkQueue; observation: StrategyObservationMemory;
  memory: GoalVoyageRiskMemory;
  cacheUse?: Readonly<{ thinkSequence: number; planIds: () => readonly string[] }>;
}>) {
  const { snapshot, owner, work, observation, memory } = input;
  const requests = new Map<string, VoyageRiskRequest>(), answers = new Map<string, VoyageRisk>();
  const uses = new Map<string, CacheUse>();
  const sequence = input.cacheUse?.thinkSequence ?? work.receipt.thinkSequence ?? snapshot.tick;
  const pending = (reasonCode: string): VoyageRisk => ({ status: 'unknown', reasonCode, samples: 0, totalSamples: 0, threatIds: [] });
  const batchModel = (ids: ReadonlySet<string>) => structuredClone(modelPayload(memory.model, voyageEvidence(memory).filter(entry => ids.has(entry.id))));
  const pressure = (batch: readonly VoyageRiskRequest[], model: VoyageRiskMemory) => {
    const overflowCount = (memory.batchCapacity?.overflowCount ?? 0) + (memory.batchCapacity?.pressure ? 0 : 1);
    memory.batchCapacity = { overflowCount, pressure: { kind: 'goal-voyage-native-batch', thinkSequence: sequence,
      bytes: observationJsonBytes(model), limitBytes: VOYAGE_RISK_MEMORY_BYTES,
      planIds: [...new Set(batch.flatMap(request => uses.get(request.id)?.planIds ?? []))].sort(),
      requestIds: batch.map(request => request.id).sort(), overflowCount } };
  };
  const observedRisk = (request: VoyageRiskRequest) => {
    const model = batchModel(new Set([request.id]));
    if (observationJsonBytes(model) > VOYAGE_RISK_MEMORY_BYTES) return pending('goal-voyage-native-batch-capacity');
    return assessVoyageRisks(snapshot, owner, [request], model, observation, { advance: false }).results.get(request.id);
  };
  return (request: VoyageRiskRequest): VoyageRisk => {
    // A future producer without a budgeted launch port may not invoke native
    // shipLaunchPose through hullFor. Existing exact native routes suffice.
    if (!request.shipId || request.route?.partial || request.previousLegId)
      return pending('goal-voyage-exact-native-leg-required');
    if (!request.route) {
      // No-capable-basin-enemy is a current-world observation independent of
      // any proposed course. The existing model proves it before route work;
      // with advance:false a capable hazard stays unknown, never starts a
      // private path search and never turns an optimistic ETA into safe travel.
      const observed = observedRisk(request);
      if (observed?.status === 'known' && observed.basis === 'no-capable-basin-enemy') return observed;
    }
    const old = requests.get(request.id);
    if (old && goalValueKey(old) !== goalValueKey(request)) return pending('goal-voyage-identity-conflict');
    requests.set(request.id, request);
    let use = uses.get(request.id);
    if (!use) { use = {}; uses.set(request.id, use); }
    touchCache(use, sequence, input.cacheUse?.planIds() ?? []);
    const publication = memory.publications.find(item => item.id === request.id);
    if (publication) touchCache(publication, sequence, input.cacheUse?.planIds() ?? []);
    boundGoalVoyageRiskPublications(memory, sequence);
    const key = `goal-voyage-risk:${owner}`;
    work.register({ key, tier: 'critical-route', minimum: 1, run: allowance => {
      const batch = [...requests.values()].sort((a, b) => a.id.localeCompare(b.id));
      if (allowance < batch.length) return { work: 0, done: false };
      const ids = new Set(batch.map(item => item.id)), model = batchModel(ids);
      if (observationJsonBytes(model) > VOYAGE_RISK_MEMORY_BYTES) {
        pressure(batch, model); return { work: batch.length, done: true };
      }
      const result = assessVoyageRisks(snapshot, owner, batch, model, observation,
        { sampleAllowance: allowance - batch.length });
      if ([...result.results.values()].some(value => value.status === 'unknown' && value.reasonCode === 'voyage-risk-memory-budget-exceeded')) {
        // The native model remains unchanged. Discarding its failed candidate
        // must not erase earlier evidence for another still-referenced leg.
        pressure(batch, model); return { work: batch.length + result.samplesUsed, done: true };
      }
      memory.batchCapacity = { overflowCount: memory.batchCapacity?.overflowCount ?? 0 };
      const retained = voyageEvidence(memory).filter(entry => !ids.has(entry.id));
      Object.assign(memory.model, { ...model,
        entries: [...model.entries, ...retained.flatMap(entry => entry.progress ? [entry.progress] : [])],
        nativeRoutes: [...(model.nativeRoutes ?? []), ...retained.flatMap(entry => entry.nativeRoute ? [entry.nativeRoute] : [])] });
      memory.publications = [...memory.publications.filter(item => !ids.has(item.id)), ...batch.map(item => ({ id: item.id,
        readyTick: snapshot.tick, ...(work.receipt.thinkSequence === undefined ? {} : { readyThink: work.receipt.thinkSequence }),
        ...uses.get(item.id) }))];
      boundGoalVoyageRiskPublications(memory, sequence);
      // One request validation plus each sample are charged. An unfinished
      // native model cursor resumes in the next owner think, not a second batch.
      return { work: batch.length + result.samplesUsed, done: true };
    } });
    if (memory.batchCapacity?.pressure?.requestIds.includes(request.id)) return pending('goal-voyage-native-batch-capacity');
    const saved = answers.get(request.id); if (saved) return saved;
    if (!publication || factPublicationPending(publication.readyTick, publication.readyThink, snapshot.tick, work))
      return pending('goal-voyage-risk-publication-pending');
    const answer = observedRisk(request) ?? pending('goal-voyage-risk-unpublished');
    answers.set(request.id, answer); return answer;
  };
}
