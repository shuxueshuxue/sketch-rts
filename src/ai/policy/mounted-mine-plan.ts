import { GOLD_MINE_RULES } from '../../shared/mining';
import { sameGround } from '../../shared/terrain';
import type { Building, GameSnapshot, ResourceNode, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { distance } from './spatial';
import { neutralCamps } from './v7/creep';

/** One world read shares actual mine camps and their living mounted assignments. */
export function mountedMinePlan(snapshot: GameSnapshot, memory: AiPolicyMemory) {
  const crossings = new Set<string>();
  if (memory.naval?.ferries) for (const mission of Object.values(memory.naval.ferries)) {
    if (mission.purpose === 'creep' && mission.phase !== 'return') crossings.add(mission.targetId);
  }
  const camps = neutralCamps(snapshot);
  const covers = (camp: typeof camps[number], mine: ResourceNode) => sameGround(snapshot.map, camp.center, mine)
    && distance(camp.center, mine) <= GOLD_MINE_RULES.baseRange;
  const claimed = camps.filter(camp => memory.mounted?.some(job => job.objective.kind === 'camp'
    && snapshot.units.some(unit => job.unitIds.includes(unit.id) && !unit.deck && sameGround(snapshot.map, unit, camp.center))
    && job.objective.ids.some(id => camp.creeps.some(guard => guard.id === id))) === true);
  const clearing = new Set([...claimed, ...camps.filter(camp => snapshot.resources.some(mine => crossings.has(mine.id) && covers(camp, mine)))]
    .flatMap(camp => camp.creeps.map(guard => guard.id)));
  return {
    eligible: (mine: ResourceNode) => !crossings.has(mine.id) && !claimed.some(camp => covers(camp, mine)),
    guards: (mine: ResourceNode) => camps.filter(camp => covers(camp, mine)).flatMap(camp => camp.creeps),
    targetAvailable: (target: Unit | Building) => !clearing.has(target.id),
  };
}
