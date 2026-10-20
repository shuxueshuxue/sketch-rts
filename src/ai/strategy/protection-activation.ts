import type { GameSnapshot } from '../../shared/types';
import type { DecisionFacts } from './decision';
import { targetCoveringTowers } from './allocated-force';
import type { Situation, Target } from './types';

/** A previous claim is not evidence of a current invasion. Missing geometry
 * or an unobserved site does not prove safety; a present armed tower must not
 * disappear merely because SiteThreat's mobile army list is empty. */
export function currentSiteThreatIsClear(snapshot: GameSnapshot, situation: DecisionFacts<Situation>, target: Target): boolean {
  const threat = situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === target.entityId);
  return !!threat && threat.attackers.length === 0 && threat.arrivedStrength === 0 && threat.incomingStrength === 0
    && threat.lossProbability === 0 && targetCoveringTowers(snapshot, situation.owner, target, 'opponent').length === 0;
}
