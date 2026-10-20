import { unitMover } from '../../shared/catalog';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { nativeLandRoad } from './land-road';
import { isOpponentOwner } from './ownership';
import { distance, type Point } from './spatial';
import type { AiPolicyContext } from './types';

export const HOME_RAID_HORIZON = 45 * SIM_TICKS_PER_SECOND;
export const HOME_RAID_ARRIVAL_RANGE = 240;

/** The same building-aware arrival forecast supplies mine cover and ferry reserves. */
export function incomingLandArmy(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  point: Point, horizon = HOME_RAID_HORIZON, candidates: readonly Unit[] = snapshot.units,
  forecast?: (unit: Unit) => { ticks: number; endpoint: Point } | undefined) {
  return candidates.filter(unit => unit.hp > 0 && unit.kind !== 'worker' && !unit.deck
    && unit.attackDamage > 0 && unitMover(unit.kind) === 'land' && isOpponentOwner(snapshot, owner, unit.owner, options))
    .flatMap(unit => {
      const road = forecast ? forecast(unit) : nativeLandRoad(snapshot, unit, point);
      const endpoint = road && ('endpoint' in road ? road.endpoint : road.points.at(-1)!);
      return road && road.ticks <= horizon && distance(endpoint!, point) <= HOME_RAID_ARRIVAL_RANGE
        && (unit.expiresTick === undefined || unit.expiresTick > snapshot.tick + road.ticks)
        ? [{ unit, ticks: road.ticks }] : [];
    }).sort((a, b) => a.ticks - b.ticks);
}
