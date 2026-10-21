import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { FactWorkQueue } from './fact-work';
import { factPublicationPending } from './fact-work';
import { goalValueKey } from './goal-facts';
import type { StrategyObservationMemory } from './observation-memory';
import { assessVoyageRisks, type VoyageRisk, type VoyageRiskMemory, type VoyageRiskRequest } from './voyage-risk';

export type GoalVoyageRiskMemory = {
  model: VoyageRiskMemory;
  publications: { id: string; readyTick: number; readyThink?: number }[];
};
/** One native risk batch on the existing fact queue. Reads validate already
 * published model progress on a copy without sampling or native route work.
 * Only the registered batch can advance the live sampling cursor. */
export function createGoalVoyageRiskReader(input: Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; work: FactWorkQueue; observation: StrategyObservationMemory;
  memory: GoalVoyageRiskMemory;
}>) {
  const { snapshot, owner, work, observation, memory } = input;
  const requests = new Map<string, VoyageRiskRequest>(), answers = new Map<string, VoyageRisk>();
  const pending = (reasonCode: string): VoyageRisk => ({ status: 'unknown', reasonCode, samples: 0, totalSamples: 0, threatIds: [] });
  return (request: VoyageRiskRequest): VoyageRisk => {
    // A future producer without a budgeted launch port may not invoke native
    // shipLaunchPose through hullFor. Existing exact native routes suffice.
    if (!request.shipId || !request.route || request.route.partial || request.previousLegId)
      return pending('goal-voyage-exact-native-leg-required');
    const old = requests.get(request.id);
    if (old && goalValueKey(old) !== goalValueKey(request)) return pending('goal-voyage-identity-conflict');
    requests.set(request.id, request);
    const key = `goal-voyage-risk:${owner}`;
    work.register({ key, tier: 'critical-route', minimum: 1, run: allowance => {
      const batch = [...requests.values()].sort((a, b) => a.id.localeCompare(b.id));
      if (allowance < batch.length) return { work: 0, done: false };
      const result = assessVoyageRisks(snapshot, owner, batch, memory.model, observation,
        { sampleAllowance: allowance - batch.length });
      const ids = new Set(batch.map(item => item.id));
      memory.publications = [...memory.publications.filter(item => !ids.has(item.id)), ...batch.map(item => ({ id: item.id,
        readyTick: snapshot.tick, ...(work.receipt.thinkSequence === undefined ? {} : { readyThink: work.receipt.thinkSequence }) }))].slice(-128);
      // One request validation plus each sample are charged. An unfinished
      // native model cursor resumes in the next owner think, not a second batch.
      return { work: batch.length + result.samplesUsed, done: true };
    } });
    const saved = answers.get(request.id); if (saved) return saved;
    const publication = memory.publications.find(item => item.id === request.id);
    if (!publication || factPublicationPending(publication.readyTick, publication.readyThink, snapshot.tick, work))
      return pending('goal-voyage-risk-publication-pending');
    const result = assessVoyageRisks(snapshot, owner, [request], structuredClone(memory.model), observation, { advance: false });
    const answer = result.results.get(request.id) ?? pending('goal-voyage-risk-unpublished');
    answers.set(request.id, answer); return answer;
  };
}
