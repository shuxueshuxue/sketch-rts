import type { GameSnapshot, PlayerId } from '../../shared/types';
import { strikeGap } from '../../shared/combat-geometry';
import { unitMover } from '../../shared/catalog';
import { groundThreatWithin } from '../policy/ground-threat';
import type { Point } from '../../shared/ship-geometry';
import { strengthOf } from '../policy/v6/strength';
import { mineClaimedByAlly } from '../policy/mine-claims';
import type { AiPolicyContext } from '../policy/types';
import { chooseV9ExpansionMine, type V6Intel } from '../policy/v6/intel';

/** Share land and naval ownership facts before applying the common expansion geometry. */
export function bootstrapExpansionMine(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, options: AiPolicyContext) {
  return chooseV9ExpansionMine(snapshot, intel, snapshot.resources.filter(mine => !mineClaimedByAlly(snapshot, owner, mine, options)),
    (intel, point, range) => enemyExpansionPower(snapshot, intel, point, range));
}

/** Direct fire is physical; a land army outside firing range must actually walk to this expansion. */
export function enemyExpansionPower(snapshot: GameSnapshot, intel: V6Intel, point: Point, range: number) {
  return intel.enemies.reduce((power, enemy) => power + strengthOf(enemy.army.filter(unit => {
    // Fleet and deck threat retains its existing sea perimeter; land roads cannot model sailing or unloading.
    if (unitMover(unit.kind) === 'sea' || unit.deck) return strikeGap(unit, point) <= Math.max(range, unit.attackRange);
    return groundThreatWithin(snapshot, unit, point, range);
  })), 0);
}
