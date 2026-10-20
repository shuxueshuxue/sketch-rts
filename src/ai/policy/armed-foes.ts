import type { GameSnapshot, PlayerId } from '../../shared/types';
import { isEnemyOwner, type TeamPolicyOptions } from './ownership';

/** The complete hostile set used by role exposure and its execution veto. */
export function armedFoes(snapshot: GameSnapshot, owner: PlayerId, options: TeamPolicyOptions = {}) {
  return [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
}
