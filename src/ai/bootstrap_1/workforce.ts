import { UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { projectedSupplyUsed } from '../policy/world-model';
import type { AiScript } from '../policy/types';
import { mineClaimedByAlly } from '../policy/mine-claims';
import type { TeamPolicyOptions } from '../policy/ownership';
import type { Point } from '../policy/spatial';
import { towerRushConstructionCrew } from './tower-rush';
import { longHaulInvestment } from './long-haul-investment';

/** Fill a mining base while it rises, before competing army and technology purchases. */
export const miningWorkforce: AiScript = {
  id: 'miningWorkforce',
  phase: 'economy',
  run(snapshot, owner, options) {
    const crew = towerRushConstructionCrew(snapshot, owner, options);
    return [...planMiningWorkforce(snapshot, owner, crew, options), ...longHaulInvestment(snapshot, owner, options, crew)];
  },
};

export function planMiningWorkforce(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number, options: TeamPolicyOptions): GameCommand[] {
  const demand = miningWorkerDemand(snapshot, owner, constructionCrew, options);
  const halls = demand.halls.filter(hall => hall.complete && hall.queue.length === 0);
  let missing = totalMissing(demand);
  const localMissing = (hall: typeof halls[number]) => demand.regions.filter(region => sameGround(snapshot.map, hall, region.origins[0]!))
    .reduce((sum, region) => sum + region.missing, 0);
  let gold = snapshot.players[owner]!.gold;
  let supply = projectedSupplyUsed(snapshot, owner);
  const commands: GameCommand[] = [];
  while (halls.length && missing > 0 && gold >= UNIT_DEFS.worker.cost && supply + UNIT_DEFS.worker.supplyUsed <= snapshot.players[owner]!.supplyCap) {
    halls.sort((a, b) => localMissing(b) - localMissing(a));
    const hall = halls.shift()!, region = demand.regions.find(region => sameGround(snapshot.map, hall, region.origins[0]!));
    if (localMissing(hall) === 0 && demand.globalMissing <= 0) break;
    commands.push({ type: 'train', buildingId: hall.id, unitKind: 'worker' });
    if (region && region.missing > 0) region.missing -= 1;
    demand.globalMissing -= 1;
    missing -= 1;
    gold -= UNIT_DEFS.worker.cost;
    supply += UNIT_DEFS.worker.supplyUsed;
  }
  return commands;
}

/** A living worker in transit or a paid recruit still belongs to the mining workforce. */
export function missingMiningWorkers(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number, options: TeamPolicyOptions) {
  return totalMissing(miningWorkerDemand(snapshot, owner, constructionCrew, options));
}

/** Mining labor belongs to its walk-connected land; embarked labor is credited only once. */
function miningWorkerDemand(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number, options: TeamPolicyOptions) {
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall');
  const mining = halls.filter(hall => snapshot.resources.some(mine => mine.amount > 0
    && Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange));
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker');
  const queued = halls.reduce((total, hall) => total + hall.queue.filter(job => job.unitKind === 'worker').length, 0);
  const outlying = snapshot.resources.filter(mine => mine.amount > 0
    && workers.some(worker => worker.order.type === 'mine' && worker.order.resourceId === mine.id)
    && !mining.some(hall => Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange)
    && !mineClaimedByAlly(snapshot, owner, mine, options));
  const origins: Point[] = [...mining, ...outlying];
  const regions: { origins: Point[]; missing: number }[] = [];
  for (const origin of origins) {
    const region = regions.find(region => sameGround(snapshot.map, origin, region.origins[0]!));
    if (region) region.origins.push(origin); else regions.push({ origins: [origin], missing: 0 });
  }
  let embarked = workers.filter(worker => worker.deck).length;
  for (const region of regions) {
    const land = region.origins[0]!;
    const local = workers.filter(worker => !worker.deck && sameGround(snapshot.map, worker, land)).length
      + halls.filter(hall => sameGround(snapshot.map, hall, land)).reduce((total, hall) => total + hall.queue.filter(job => job.unitKind === 'worker').length, 0);
    const deficit = Math.max(0, region.origins.length * GOLD_MINE_RULES.workstations - local);
    const inTransit = Math.min(embarked, deficit);
    region.missing = deficit - inTransit;
    embarked -= inTransit;
  }
  return { halls, regions, globalMissing: Math.min(36, origins.length * GOLD_MINE_RULES.workstations + constructionCrew) - workers.length - queued,
    capacity: Math.max(0, 36 - workers.length - queued) };
}

function totalMissing(demand: ReturnType<typeof miningWorkerDemand>) {
  return Math.min(demand.capacity, Math.max(demand.globalMissing, demand.regions.reduce((total, region) => total + region.missing, 0)));
}
