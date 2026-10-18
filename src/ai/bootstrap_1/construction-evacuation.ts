import { GOLD_MINE_RULES } from '../../shared/mining';
import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { isOpponentOwner } from '../policy/ownership';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';

/** A coast evacuation must not abandon safe paid construction or mining
 * elsewhere on the same landmass. Recheck every think; nearby danger wins. */
export function keepMiningWork(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, worker: Unit, boat: Unit): boolean {
  if (options.memory.naval?.ferries?.[boat.id]?.purpose !== 'evacuate'
    || worker.deck || worker.kind !== 'worker' || (worker.order.type !== 'repair' && worker.order.type !== 'mine')) return false;
  const order = worker.order;
  const hall = order.type === 'repair'
    ? snapshot.buildings.find(building => building.id === order.buildingId && building.owner === owner
      && building.kind === 'townHall' && !building.complete && building.hp > 0)
    : snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall'
      && building.complete && building.hp > 0 && snapshot.resources.some(mine => mine.id === order.resourceId
        && mine.amount > 0 && Math.hypot(mine.x - building.x, mine.y - building.y) < GOLD_MINE_RULES.baseRange));
  if (!hall || !snapshot.resources.some(mine => mine.amount > 0
    && Math.hypot(hall.x - mine.x, hall.y - mine.y) < GOLD_MINE_RULES.baseRange)) return false;
  const foes = armedFoes(snapshot, owner, options);
  // Match the evacuation's local danger radius; a distant threatened miner
  // does not make this worker's separate worksite an evacuation zone.
  if (foes.some(foe => 'order' in foe && unitMover(foe.kind) === 'land'
    && isOpponentOwner(snapshot, owner, foe.owner, options) && sameGround(snapshot.map, worker, foe)
    && Math.hypot(worker.x - foe.x, worker.y - foe.y) < 700)) return false;
  return safeLandTravelTicks(snapshot, worker, hall, foes) !== undefined && (order.type !== 'mine'
    || safeLandTravelTicks(snapshot, worker, snapshot.resources.find(mine => mine.id === order.resourceId)!, foes) !== undefined);
}
