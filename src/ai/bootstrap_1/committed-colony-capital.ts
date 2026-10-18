import { BUILDING_DEFS } from '../../shared/catalog';
import { mineProspect } from '../../shared/mining-prospect';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';

/** Once income is exhausted, spending an outbound colony's foundation on home
 * reinforcements also cancels its voyage. Preserve that already committed
 * investment; an unlaunched or abandoned expedition has no such claim. */
export function committedColonyCapital(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): number {
  if (activeMiningBaseCount(snapshot, owner) > 0
    || snapshot.buildings.some(b => b.owner === owner && b.kind === 'townHall' && !b.complete)) return 0;
  for (const [shipId, mission] of Object.entries(options.memory.naval?.ferries ?? {})) {
    if (mission.purpose !== 'settle' || mission.phase !== 'sailing') continue;
    if (!snapshot.units.some(u => u.id === shipId && u.owner === owner && u.hp > 0 && u.sailing)) continue;
    const mine = snapshot.resources.find(m => m.id === mission.targetId && m.amount > 0);
    if (!mine || mineClaimedByAlly(snapshot, owner, mine, options)
      || mineProspect(snapshot, mine, 0, snapshot.players[owner]!.supplyUsed).netGold < BUILDING_DEFS.townHall.cost
      || snapshot.buildings.some(b => b.kind === 'townHall' && distance(b, mine) < 400)) continue;
    // crewIds tracks pending boarders and is emptied once they embark.
    const founders = snapshot.units.filter(u => u.owner === owner && u.kind === 'worker' && u.hp > 0
      && (u.deck?.shipId === shipId || mission.crewIds.includes(u.id) && !u.deck && sameGround(snapshot.map, u, mine)));
    if (founders.length) return BUILDING_DEFS.townHall.cost;
  }
  return 0;
}
