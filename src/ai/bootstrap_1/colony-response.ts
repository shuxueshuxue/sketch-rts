import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { routeTravelTicks } from '../../shared/route-selection';
import { sameGround } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { Point } from '../../shared/ship-geometry';
import { isOpponentOwner } from '../policy/ownership';
import { effectiveCombatRating } from '../policy/v6/strength';
import type { AiPolicyContext } from '../policy/types';

/** Empty ground within400 is not a quiet colony when an observed land army
 * can reach it before a hall finishes. Sailing/boarding time is deliberately
 * not invented for enemy passengers; native landing defense still applies. */
export function colonyResponseDefense(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, target: Point): number {
  const horizon = BUILDING_DEFS.townHall.buildTime * SIM_TICKS_PER_SECOND;
  return snapshot.units.reduce((power, unit) => {
    if (unit.hp <= 0 || unit.deck || unit.kind === 'worker' || unitMover(unit.kind) !== 'land'
      || !isOpponentOwner(snapshot, owner, unit.owner, options) || !combatCapability(snapshot, unit).armed
      || !sameGround(snapshot.map, unit, target)) return power;
    const ticks = routeTravelTicks(snapshot.map, unit, target, 'land', unit.speed);
    if (ticks === undefined || ticks > horizon || unit.expiresTick !== undefined && unit.expiresTick <= snapshot.tick + ticks) return power;
    return power + effectiveCombatRating(snapshot, unit);
  }, 0);
}
