import type { GameSnapshot, PlayerId } from '../../shared/types';
import { mineClaimedByAlly } from '../policy/mine-claims';
import type { AiPolicyContext } from '../policy/types';
import { chooseV9ExpansionMine, type V6Intel } from '../policy/v6/intel';

/** Share land and naval ownership facts before applying the common expansion geometry. */
export function bootstrapExpansionMine(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, options: AiPolicyContext) {
  return chooseV9ExpansionMine(snapshot, intel, snapshot.resources.filter(mine => !mineClaimedByAlly(snapshot, owner, mine, options)));
}
