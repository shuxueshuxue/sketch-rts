import { sameGround } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AllocationPrecondition } from './allocation-types';
import type { DecisionFacts } from './decision';
import type { Objective, Situation, Target } from './types';

/** A candidate refuge is not proved unsafe by an unquoted potential redirect.
 * Retain its real target so the common arrival/risk evaluator can price it.
 * This uses existing strength facts; it introduces no alternate risk formula. */
export function evacuationShelter(snapshot: GameSnapshot, situation: DecisionFacts<Situation>, objective: DecisionFacts<Objective>,
  methodId: string, selected?: Target): { target: Target | undefined; condition: AllocationPrecondition | null } {
  const halls = situation.assets.filter(asset => asset.owner === situation.owner && asset.kind === 'hall'
    && asset.complete && (asset.hp === null || asset.hp > 0) && asset.id !== objective.target.entityId);
  const inspect = (target: Target | undefined) => {
    const hall = halls.find(asset => asset.id === target?.entityId);
    const threat = hall && situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === hall.id);
    const code = !hall ? 'evacuation-shelter-unavailable'
      : !threat || threat.arrivedStrength + threat.incomingStrength <= threat.friendlyOnStationStrength ? null
      : threat.arrivedStrength > threat.friendlyOnStationStrength ? 'evacuation-shelter-unsafe'
      : 'evacuation-shelter-safety-unknown';
    return { target: hall ? target ?? hall.target : undefined, condition: code ? { id: `${methodId}/shelter`, kind: 'shore-safe' as const,
      status: code.endsWith('unknown') ? 'unknown' as const : 'unmet' as const,
      reason: { code, factIds: hall ? [hall.id, ...(threat?.attackers.map(attacker => attacker.unitId) ?? [])] : [],
        values: { siteId: hall?.id ?? null, x: target?.point.x ?? hall?.target.point.x ?? null, y: target?.point.y ?? hall?.target.point.y ?? null,
          landId: target?.landId ?? hall?.target.landId ?? null, arrivedStrength: threat?.arrivedStrength ?? 0,
          incomingStrength: threat?.incomingStrength ?? 0, friendlyStrength: threat?.friendlyOnStationStrength ?? 0,
          needsArrivalFact: !!hall, needsSiteRiskFact: code.endsWith('unknown') } },
      demand: hall ? { kind: 'workers' as const, count: 1, at: target ?? hall.target } : null, subgoalIds: [] } : null };
  };
  const specified = selected ?? objective.effects.find(effect => effect.kind === 'assets-evacuated')?.destination;
  // A retained voyage's shore/refuge is binding. A later quote must report the
  // old target's invalidity rather than silently choosing another destination.
  if (specified) return inspect(specified);
  const ranked = halls.map(hall => inspect(hall.target)).sort((a, b) => {
    const rank = (candidate: typeof a) => candidate.condition === null ? 0 : candidate.condition.status === 'unknown' ? 1 : 2;
    return rank(a) - rank(b)
      || Number(sameGround(snapshot.map, b.target!.point, objective.target.point)) - Number(sameGround(snapshot.map, a.target!.point, objective.target.point))
      || distance(a.target!.point, objective.target.point) - distance(b.target!.point, objective.target.point);
  });
  return ranked[0] ?? inspect(undefined);
}
