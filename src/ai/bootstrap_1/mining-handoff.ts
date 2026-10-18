import { GOLD_MINE_RULES } from '../../shared/mining';
import { routeTravelTicks } from '../../shared/route-selection';
import type { GameSnapshot, PlayerId, GameCommand } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { safeLandTravelTicks, armedFoes } from './safe-land-route';

/** Hand a completed mining hall's builder to its safe local income before the
 * ordinary claim cleanup forgets which construction that worker finished. */
export function miningHandoff(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand | undefined {
  for (const worker of snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker'
    && !unit.deck && unit.order.type === 'idle')) {
    const claim = options.memory.unitClaims[worker.id];
    if (claim?.kind !== 'build' || claim.expiresTick < snapshot.tick) continue;
    const hall = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall'
      && building.complete && building.x === claim.x && building.y === claim.y);
    if (!hall) continue;
    const foes = armedFoes(snapshot, owner, options);
    const mines = snapshot.resources.filter(mine => mine.amount > 0
      && Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange
      && snapshot.units.filter(unit => unit.owner === owner && unit.order.type === 'mine'
        && unit.order.resourceId === mine.id).length < GOLD_MINE_RULES.workstations
      && safeLandTravelTicks(snapshot, worker, mine, foes) !== undefined)
      .sort((a, b) => routeTravelTicks(snapshot.map, worker, a, 'land', worker.speed)!
        - routeTravelTicks(snapshot.map, worker, b, 'land', worker.speed)!);
    if (mines[0]) return { type: 'mine', unitIds: [worker.id], resourceId: mines[0].id };
  }
}
