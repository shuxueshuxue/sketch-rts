import { GOLD_MINE_RULES } from '../../shared/mining';
import type { GameSnapshot, PlayerId, ResourceNode } from '../../shared/types';
import { isOpponentOwner, type TeamPolicyOptions } from './ownership';
import { distance } from './spatial';

/** A teammate's mining hall or active miners reserve the mine for that teammate. */
export function mineClaimedByAlly(snapshot: GameSnapshot, owner: PlayerId, mine: ResourceNode, options: TeamPolicyOptions): boolean {
  const ally = (other: string) => other !== owner && other !== 'neutral' && !isOpponentOwner(snapshot, owner, other, options);
  return snapshot.buildings.some(hall => hall.kind === 'townHall' && ally(hall.owner)
    && distance(hall, mine) <= GOLD_MINE_RULES.baseRange)
    || snapshot.units.some(unit => unit.kind === 'worker' && ally(unit.owner)
      && unit.order.type === 'mine' && unit.order.resourceId === mine.id);
}
