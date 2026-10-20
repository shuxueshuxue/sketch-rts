import type { Unit } from '../../shared/types';
import type { NeutralCampExposure, NeutralCampExposureFacts } from './neutral-camp-exposure';

export type CampObjectivePoint = Readonly<{ id: string; x: number; y: number }>;

/** Classify facts against real commitments. The consumer supplies its existing
 * safety predicate: this layer invents neither camp IDs nor another safe radius.
 * Camps without a threatened objective remain transit costs.
 */
export function neutralCampObjectiveBlockers(facts: NeutralCampExposureFacts,
  targets: readonly CampObjectivePoint[], threatens: (guard: Unit, target: CampObjectivePoint) => boolean) {
  const result = new Map<NeutralCampExposure, readonly CampObjectivePoint[]>();
  for (const camp of facts.camps) {
    const blocked = targets.filter(target => camp.camp.creeps.some(guard => threatens(guard, target)));
    if (blocked.length) result.set(camp, blocked);
  }
  return result;
}
