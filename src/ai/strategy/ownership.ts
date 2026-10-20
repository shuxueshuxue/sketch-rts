import type { GameSnapshot, PlayerId } from '../../shared/types';
import { isOpponentOwner, type TeamPolicyOptions } from '../policy/ownership';

/** Strategy has one relation source. Explicit room teams override the snapshot;
 * absent teams mean the native free-for-all relation, never a guessed alliance.
 * Neutral camps remain separate from opponent players. */
export function strategyIsOpponent(snapshot: GameSnapshot, owner: PlayerId, other: string,
  teams: TeamPolicyOptions['teams'] = snapshot.teams): boolean {
  return isOpponentOwner(snapshot, owner, other, strategyTeamOptions(snapshot, teams));
}

/** The same relation for shared policy geometry helpers which accept options. */
export function strategyTeamOptions(snapshot: GameSnapshot, teams: TeamPolicyOptions['teams'] = snapshot.teams): TeamPolicyOptions {
  return teams === undefined ? {} : { teams };
}
