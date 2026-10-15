import { GOLD_MINE_RULES, miningIncomeRate, upkeepGoldIncome } from './mining';
import { roundGold } from './gold';
import { groundApproachRoute, routePrefix } from './route-selection';
import { groundTravelCost, sameGround } from './terrain';
import { SIM_TICKS_PER_SECOND, seconds } from './time';
import type { GameSnapshot, ResourceNode, Unit } from './types';
import type { Point } from './ship-geometry';

type Miner = Unit & { order: Extract<Unit['order'], { type: 'mine' }> };
type Harvest = { tick: number; amount: number };
const forecasts = new WeakMap<GameSnapshot, Map<string, { harvests: Harvest[]; depletionTicks?: number }>>();

/** Terrain travel stops at the actual mining/drop ranges, rather than charging for walking into a solid hall. */
function haulingTicks(snapshot: GameSnapshot, from: Point, to: Point, speed: number, startRange: number, endRange: number): number | undefined {
  const road = groundApproachRoute(snapshot.map, from, to);
  if (!road) return undefined;
  const length = road.reduce((sum, point, index) => sum + Math.hypot(point.x - (road[index - 1] ?? from).x,
    point.y - (road[index - 1] ?? from).y), 0);
  const end = routePrefix(from, road, Math.max(0, length - endRange));
  const begin = routePrefix(from, road, Math.min(startRange, Math.max(0, length - endRange))).at(-1)!;
  let skipped = startRange, previous = from;
  const trimmed = [begin];
  for (const point of end.slice(1)) {
    const segment = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (skipped < segment) trimmed.push(point);
    skipped -= segment;
    previous = point;
  }
  const cost = trimmed.slice(1).reduce((sum, point, index) => sum + groundTravelCost(snapshot.map, trimmed[index]!, point)!, 0);
  return Math.ceil(cost / speed * SIM_TICKS_PER_SECOND);
}

/** Existing orders continue at their observed mine phase. Future combat, body queues and new miners are separate decisions. */
function harvestForecast(snapshot: GameSnapshot, mine: ResourceNode) {
  let cached = forecasts.get(snapshot);
  if (!cached) { cached = new Map(); forecasts.set(snapshot, cached); }
  const known = cached.get(mine.id);
  if (known) return known;
  const miners = snapshot.units.filter((unit): unit is Miner => unit.hp > 0 && !unit.deck && unit.kind === 'worker'
    && unit.order.type === 'mine' && unit.order.resourceId === mine.id);
  const halls = snapshot.buildings.filter(hall => hall.kind === 'townHall' && hall.complete && hall.hp > 0
    && sameGround(snapshot.map, hall, mine));
  const gather = seconds(GOLD_MINE_RULES.gatherSeconds), interval = seconds(GOLD_MINE_RULES.entrySeconds);
  const queue: { tick: number; worker: Miner; gather: boolean; haul: number | undefined }[] = [];
  for (const worker of miners) {
    // Native delivery chooses the nearest own hall on this land, by center distance.
    const ownHalls = halls.filter(hall => hall.owner === worker.owner);
    const nearestHall = (point: Point) => ownHalls.reduce<typeof halls[number] | undefined>((best, hall) => !best
      || Math.hypot(point.x - hall.x, point.y - hall.y) < Math.hypot(point.x - best.x, point.y - best.y) ? hall : best, undefined);
    const hall = nearestHall(mine);
    const lane = hall && haulingTicks(snapshot, mine, hall, worker.speed, GOLD_MINE_RULES.entryRange, GOLD_MINE_RULES.dropRange);
    const haul = lane === undefined ? undefined : 2 * lane;
    if (worker.order.phase === 'gather') queue.push({ tick: worker.order.timer, worker, gather: true, haul });
    else if (worker.order.phase === 'toMine') {
      const approach = haulingTicks(snapshot, worker, mine, worker.speed, 0, GOLD_MINE_RULES.entryRange);
      if (approach !== undefined) queue.push({ tick: Math.max(1, approach), worker, gather: false, haul });
    } else {
      const destination = nearestHall(worker);
      const delivery = destination && haulingTicks(snapshot, worker, destination, worker.speed, 0, GOLD_MINE_RULES.dropRange);
      const returning = destination && haulingTicks(snapshot, destination, mine, worker.speed, GOLD_MINE_RULES.dropRange, GOLD_MINE_RULES.entryRange);
      if (delivery !== undefined && returning !== undefined) queue.push({ tick: Math.max(1, delivery) + returning, worker, gather: false, haul });
    }
  }
  const harvests: Harvest[] = [];
  let remaining = mine.amount, nextAdmission = Math.max(1, mine.harvestCooldownRemaining ?? 0);
  while (remaining > 0 && queue.length) {
    queue.sort((a, b) => a.tick - b.tick || Number(b.gather) - Number(a.gather)
      || (b.worker.order.phase === 'toMine' ? b.worker.order.timer : 0) - (a.worker.order.phase === 'toMine' ? a.worker.order.timer : 0)
      || (a.worker.id < b.worker.id ? -1 : a.worker.id > b.worker.id ? 1 : 0));
    const event = queue.shift()!;
    if (!event.gather) {
      const admission = Math.max(event.tick, nextAdmission);
      nextAdmission = admission + interval;
      queue.push({ ...event, tick: admission + gather, gather: true });
    } else {
      const amount = Math.min(remaining, GOLD_MINE_RULES.goldPerTrip);
      harvests.push({ tick: event.tick, amount });
      remaining -= amount;
      if (event.haul !== undefined) queue.push({ ...event, tick: event.tick + event.haul, gather: false });
    }
  }
  const result = { harvests, ...(remaining === 0 ? { depletionTicks: harvests.at(-1)?.tick ?? 0 } : {}) };
  cached.set(mine.id, result);
  return result;
}

/** Forecast the remaining resource at a supplied arrival time, using the supplied population for each delivery.
 * The caller owns its land/sea arrival plan. This does not substitute straight distance for a sailing voyage.
 * Net gold is a current-population forecast with native per-delivery rounding. Future population changes alter it.
 */
export function mineProspect(snapshot: GameSnapshot, mine: ResourceNode, arrivalTicks: number, supplyUsed: number) {
  const forecast = harvestForecast(snapshot, mine);
  const consumed = forecast.harvests.filter(harvest => harvest.tick <= arrivalTicks).reduce((sum, harvest) => sum + harvest.amount, 0);
  const amountAtArrival = Math.max(0, mine.amount - consumed);
  const incomeRate = miningIncomeRate(supplyUsed);
  const trips = Math.floor(amountAtArrival / GOLD_MINE_RULES.goldPerTrip);
  const remainder = amountAtArrival % GOLD_MINE_RULES.goldPerTrip;
  const netGold = roundGold(trips * upkeepGoldIncome(GOLD_MINE_RULES.goldPerTrip, supplyUsed)
    + upkeepGoldIncome(remainder, supplyUsed));
  return { amountAtArrival, consumedBeforeArrival: consumed, incomeRate, netGold, depletionTicks: forecast.depletionTicks };
}
