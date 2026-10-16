import { UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { sameGround } from '../../shared/terrain';
import { currentBerthLandings, passengerLandingSpot } from '../../shared/naval';
import { isInCabin } from '../../shared/ship-cabin';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { projectedSupplyUsed } from '../policy/world-model';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { mineClaimedByAlly } from '../policy/mine-claims';
import type { TeamPolicyOptions } from '../policy/ownership';
import type { Point } from '../policy/spatial';
import { towerRushConstructionCrew } from './tower-rush';
import { longHaulInvestment } from './long-haul-investment';
import { miningJobOrder } from './mining-jobs';

type MiningWorkforceOptions = TeamPolicyOptions & { memory?: AiPolicyContext['memory'] };

/** Fill a mining base while it rises, before competing army and technology purchases. */
export const miningWorkforce: AiScript = {
  id: 'miningWorkforce',
  phase: 'economy',
  run(snapshot, owner, options) {
    const crew = towerRushConstructionCrew(snapshot, owner, options);
    return planMiningWorkforcePurchase(snapshot, owner, crew, options);
  },
};

/** Without an owned mining hall, more distant labor competes with buying one.
 * A native construction already present in buildings has paid for its hall.
 * Keep the first worker and existing construction crew on the ordinary path. */
export function needsRemoteLaborInvestment(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number) {
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker');
  return workers.length > 0 && workers.length >= constructionCrew
    && !snapshot.buildings.some(hall => hall.owner === owner && hall.kind === 'townHall' && hall.hp > 0
      && snapshot.resources.some(mine => mine.amount > 0
        && Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange));
}

/** One purchase planner is shared by early workforce and later worker goals. */
export function planMiningWorkforcePurchase(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number, options: AiPolicyContext): GameCommand[] {
  return needsRemoteLaborInvestment(snapshot, owner, constructionCrew)
    ? longHaulInvestment(snapshot, owner, options, constructionCrew)
    : planMiningWorkforce(snapshot, owner, constructionCrew, options);
}

export function planMiningWorkforce(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number, options: MiningWorkforceOptions): GameCommand[] {
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
export function missingMiningWorkers(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number, options: MiningWorkforceOptions) {
  return totalMissing(miningWorkerDemand(snapshot, owner, constructionCrew, options));
}

/** Mining labor belongs to its walk-connected land; embarked labor is credited only once. */
function miningWorkerDemand(snapshot: GameSnapshot, owner: PlayerId, constructionCrew: number, options: MiningWorkforceOptions) {
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall');
  const mining = halls.filter(hall => snapshot.resources.some(mine => mine.amount > 0
    && Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange));
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker');
  const queued = halls.reduce((total, hall) => total + hall.queue.filter(job => job.unitKind === 'worker').length, 0);
  const outlying = snapshot.resources.filter(mine => mine.amount > 0
    && workers.some(worker => miningJobOrder(worker)?.resourceId === mine.id)
    && !mining.some(hall => Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange)
    && !mineClaimedByAlly(snapshot, owner, mine, options));
  const origins: Point[] = [...mining, ...outlying];
  const regions: { origins: Point[]; missing: number }[] = [];
  for (const origin of origins) {
    const region = regions.find(region => sameGround(snapshot.map, origin, region.origins[0]!));
    if (region) region.origins.push(origin); else regions.push({ origins: [origin], missing: 0 });
  }
  const embarked = new Set(workers.filter(worker => worker.deck));
  for (const region of regions) {
    const land = region.origins[0]!;
    const local = workers.filter(worker => !worker.deck && sameGround(snapshot.map, worker, land)).length
      + halls.filter(hall => sameGround(snapshot.map, hall, land)).reduce((total, hall) => total + hall.queue.filter(job => job.unitKind === 'worker').length, 0);
    const deficit = Math.max(0, region.origins.length * GOLD_MINE_RULES.workstations - local);
    let inTransit = 0;
    if (deficit > 0) for (const worker of embarked) {
      if (!miningArrival(snapshot, worker, land, options)) continue;
      embarked.delete(worker);
      if (++inTransit === deficit) break;
    }
    region.missing = deficit - inTransit;
  }
  return { halls, regions, globalMissing: Math.min(36, origins.length * GOLD_MINE_RULES.workstations + constructionCrew) - workers.length - queued,
    capacity: Math.max(0, 36 - workers.length - queued) };
}

/** Credit a real economic destination, or labor that can actually step back
 * onto this land while its ship has no assigned journey. Sea goals do not
 * identify an island by their nearest shore. */
function miningArrival(snapshot: GameSnapshot, worker: Unit, land: Point, options: MiningWorkforceOptions) {
  const boat = snapshot.units.find(unit => unit.id === worker.deck?.shipId && unit.owner === worker.owner);
  if (!boat || isInCabin(worker)) return false;
  const mission = options.memory?.naval?.ferries?.[boat.id];
  if (mission) {
    if (mission.phase === 'return') return sameGround(snapshot.map, mission.from, land)
      || currentBerthLandings(snapshot.map, boat, land, snapshot.units).some(landing => landing.passengerId === worker.id);
    const target = snapshot.resources.find(mine => mine.id === mission.targetId)
      ?? snapshot.buildings.find(building => building.id === mission.targetId);
    return ['settle', 'rebase', 'evacuate'].includes(mission.purpose) && !!target && sameGround(snapshot.map, target, land);
  }
  if (boat.order.type === 'unload')
    return currentBerthLandings(snapshot.map, boat, land, snapshot.units).some(landing => landing.passengerId === worker.id);
  if (boat.order.type !== 'idle' && boat.order.type !== 'hold') return false;
  const landing = passengerLandingSpot(snapshot.map, boat, worker.id, snapshot.units);
  return !!landing && sameGround(snapshot.map, landing, land);
}

function totalMissing(demand: ReturnType<typeof miningWorkerDemand>) {
  return Math.min(demand.capacity, Math.max(demand.globalMissing, demand.regions.reduce((total, region) => total + region.missing, 0)));
}
