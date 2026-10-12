import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { createUnit } from '../../shared/map';
import { GOLD_MINE_RULES, miningIncomeRate } from '../../shared/mining';
import { landSpawnPoint } from '../../shared/production-spawn';
import { nearestByRoute, routeTravelTicks } from '../../shared/route-selection';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { mineClaimedByAlly } from '../policy/mine-claims';
import type { AiPolicyContext } from '../policy/types';
import { projectedSupplyUsed } from '../policy/world-model';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';

/** Buy remote labor only when its travel and payback precede saving for a replacement hall. */
export function longHaulInvestment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, constructionCrew: number): GameCommand[] {
  const player = snapshot.players[owner]!, supply = projectedSupplyUsed(snapshot, owner);
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker');
  if (activeMiningBaseCount(snapshot, owner) > 0 || workers.length < constructionCrew
    || player.gold < UNIT_DEFS.worker.cost || player.gold >= BUILDING_DEFS.townHall.cost
    || supply + UNIT_DEFS.worker.supplyUsed > player.supplyCap) return [];
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall' && building.complete);
  const queued = halls.reduce((count, hall) => count + hall.queue.filter(job => job.unitKind === 'worker').length, 0);
  const lanes = snapshot.resources.filter(mine => mine.amount > 0 && !mineClaimedByAlly(snapshot, owner, mine, options))
    .map(mine => ({ mine, workers: workers.filter(unit => !unit.deck && unit.order.type === 'mine' && unit.order.resourceId === mine.id) }))
    .filter(lane => lane.workers.length > 0);
  const foes = armedFoes(snapshot, owner, options);
  for (const producer of halls.filter(hall => hall.queue.length === 0)) {
    const probe = createUnit('long-haul-worker-probe', owner, 'worker', producer.x, producer.y);
    const spawn = landSpawnPoint(snapshot, producer, probe);
    if (!spawn) continue;
    Object.assign(probe, spawn);
    for (const lane of lanes) {
      if (lane.workers.length + queued >= GOLD_MINE_RULES.workstations) continue;
      const hall = nearestByRoute(snapshot.map, halls, lane.mine, 'land');
      if (!hall) continue;
      const approach = safeLandTravelTicks(snapshot, probe, lane.mine, foes);
      const haul = safeLandTravelTicks(snapshot, { ...probe, x: lane.mine.x, y: lane.mine.y }, hall, foes);
      const road = routeTravelTicks(snapshot.map, lane.mine, hall, 'land', probe.speed);
      if (approach === undefined || haul === undefined || road === undefined) continue;
      const cycle = road * 2 + GOLD_MINE_RULES.gatherSeconds * SIM_TICKS_PER_SECOND;
      const capacity = 1 / (GOLD_MINE_RULES.entrySeconds * SIM_TICKS_PER_SECOND);
      const income = Math.min(capacity, (lane.workers.length + queued) / cycle) * GOLD_MINE_RULES.goldPerTrip * miningIncomeRate(supply);
      const next = Math.min(capacity, (lane.workers.length + queued + 1) / cycle) * GOLD_MINE_RULES.goldPerTrip
        * miningIncomeRate(supply + UNIT_DEFS.worker.supplyUsed);
      const marginal = next - income;
      const payback = UNIT_DEFS.worker.trainTime + approach + UNIT_DEFS.worker.cost / marginal;
      const saving = (BUILDING_DEFS.townHall.cost - player.gold) / income;
      if (marginal > 0 && payback < saving && lane.mine.amount >= BUILDING_DEFS.townHall.cost - player.gold + UNIT_DEFS.worker.cost) {
        return [{ type: 'train', buildingId: producer.id, unitKind: 'worker' }];
      }
    }
  }
  return [];
}
