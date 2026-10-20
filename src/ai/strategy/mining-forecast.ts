import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { constructionWorkers } from '../../shared/construction';
import { GOLD_MINE_RULES, miningIncomeRate } from '../../shared/mining';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { unitArrival } from './unit-arrivals';
import { MINING_WORKFORCE_CALIBRATION } from './mining-forecast-calibration';
import { discountedFlow, discountedValue } from './utility';
import type { DecisionFacts } from './decision';
import type { MiningCapacity, Situation, SituationUnit, ValuationWindow } from './types';

export type MiningWorkforceCalibration = Readonly<{
  id: string; dispatchTicks: number; localBirthToEntryTicks: number;
  firstDeliveryTicks: number; workerCountMae: number; workerCountP90Error: number;
}>;
export type MiningWorkerProjection = Readonly<{
  unitId: string; source: 'stationed' | 'engineer' | 'surplus' | 'paid-queue' | 'train-worker';
  arrivalTicks: number; producerId: string | null; conditional: boolean;
}>;
export type MiningTrainingProjection = Readonly<{
  id: string; jobId: string | null; producerId: string; lane: 'training'; paid: boolean; gold: number;
  startsInTicks: number; completesInTicks: number; onStationTicks: number;
  queueTicks: number; routeBasisUnitId: string | null;
}>;
export type MiningForecastSegment = Readonly<{
  fromTicks: number; untilTicks: number; workerCount: number; productiveWorkerCount: number;
  grossGoldPerTick: number; incomeGoldPerTick: number;
}>;
export type MiningWorkforceForecast = Readonly<{
  status: 'estimated' | 'unknown'; mineId: string; hallReadyTicks: number;
  workers: readonly MiningWorkerProjection[]; surplusWorkerIds: readonly string[];
  training: readonly MiningTrainingProjection[]; segments: readonly MiningForecastSegment[];
  trainingGold: number; presentTrainingGold: number; queueTicks: number;
  incomeGold: number | null; unknown: readonly Readonly<{ code: string; entityIds: readonly string[] }>[];
  calibration: MiningWorkforceCalibration; knownEffectsLowerBound: true;
}>;
export type MiningForecastInput = Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; mineId: string; hallReadyTicks: number;
  engineerId: string | null; window: ValuationWindow; calibration?: MiningWorkforceCalibration;
  /** Net cash after this method's hall/hulls and other reservations; omitted reserves an unlaid hall. */
  availableGold?: number; explicitWorkerIds?: readonly string[];
  allowedUnitIds?: readonly string[]; unavailableUnitIds?: readonly string[];
  /** Older captures can supply the identical native capacity explicitly. */
  capacity?: MiningCapacity;
}>;
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const job = (u: Unit) => u.order.type === 'mine' ? u.order : u.order.type === 'move'
  ? u.orderQueue?.find(order => order.type === 'mine') : undefined;
const finite = (n: number, name: string) => { if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid mining forecast ${name}: ${n}`); return n; };

/** Integrate each piece with the shared hyperbolic discount. Ore is depleted at
 * the gross rate; tax changes income, never the amount remaining in the mine. */
export function discountedMiningSegments(segments: readonly MiningForecastSegment[], remainingOre: number, window: ValuationWindow) {
  let ore = finite(remainingOre, 'ore'), result = 0, previousEnd = 0;
  for (const segment of segments) {
    const start = finite(segment.fromTicks, 'segment start'), end = finite(segment.untilTicks, 'segment end');
    const gross = finite(segment.grossGoldPerTick, 'gross rate'), net = finite(segment.incomeGoldPerTick, 'net rate');
    if (end < start || start < previousEnd || net > gross + 1e-9) throw new Error('Invalid mining forecast segment order/rate');
    previousEnd = end;
    const ticks = Math.max(0, Math.min(end, window.horizonTicks) - start);
    if (!gross || !ticks || !ore) continue;
    const usedOre = Math.min(ore, gross * ticks);
    result += discountedFlow({ goldPerTick: net, remainingGold: usedOre * net / gross, startsInTicks: start, window });
    ore -= usedOre;
  }
  return result;
}

/** An estimate of the existing economy's dispatch/production, not a grant or
 * permission to move a worker. All travel is read from the shared Situation.
 * The caller must realize the returned workforce/queue/cash prerequisites.
 * New workers are charged full recruitment price; their unpriced service after
 * the comparison window is optional upside, not a claimed incumbent loss. */
export function forecastMiningWorkforce(input: MiningForecastInput): MiningWorkforceForecast {
  const { snapshot, situation, mineId, engineerId, window } = input;
  const calibration = input.calibration ?? MINING_WORKFORCE_CALIBRATION;
  const ready = finite(input.hallReadyTicks, 'hall readiness'), owner = situation.owner;
  if (snapshot.tick !== situation.tick) throw new Error('Mining forecast requires one situation epoch');
  for (const name of ['dispatchTicks', 'localBirthToEntryTicks', 'firstDeliveryTicks', 'workerCountMae', 'workerCountP90Error'] as const)
    finite(calibration[name], name);
  const asset = situation.assets.find(asset => asset.id === mineId && asset.kind === 'mine');
  const mine = snapshot.resources.find(mine => mine.id === mineId), capacity = input.capacity ?? asset?.miningCapacity;
  const unknown: { code: string; entityIds: string[] }[] = [];
  const workers: MiningWorkerProjection[] = [], training: MiningTrainingProjection[] = [];
  const finish = (): MiningWorkforceForecast => {
    const arrivals = workers.map(worker => worker.arrivalTicks).sort((a, b) => a - b);
    const productive = workers.map(worker => worker.arrivalTicks + (worker.source === 'stationed' ? 0 : calibration.firstDeliveryTicks));
    const boundaries = [...new Set([ready, ...arrivals, ...productive, window.horizonTicks])].filter(t => t <= window.horizonTicks).sort((a, b) => a - b);
    const tax = miningIncomeRate(snapshot.players[owner]!.supplyUsed);
    const segments: MiningForecastSegment[] = boundaries.slice(0, -1).map((fromTicks, index) => {
      const workerCount = arrivals.filter(t => t <= fromTicks).length;
      const productiveWorkerCount = productive.filter(t => t <= fromTicks).length;
      const grossGoldPerTick = (capacity?.goldPerTickCap ?? 0) * Math.min(1, productiveWorkerCount / (capacity?.standardWorkers ?? 1));
      return { fromTicks, untilTicks: boundaries[index + 1]!, workerCount, productiveWorkerCount, grossGoldPerTick, incomeGoldPerTick: grossGoldPerTick * tax };
    });
    return { status: capacity && mine && workers.length ? 'estimated' : 'unknown', mineId, hallReadyTicks: ready,
      workers, surplusWorkerIds: workers.filter(w => w.source === 'surplus').map(w => w.unitId), training, segments,
      trainingGold: training.reduce((sum, t) => sum + t.gold, 0),
      presentTrainingGold: training.reduce((sum, t) => sum + discountedValue(t.gold, t.startsInTicks, window), 0),
      queueTicks: training.filter(t => !t.paid).reduce((sum, t) => sum + t.queueTicks, 0),
      incomeGold: capacity && mine && workers.length ? discountedMiningSegments(segments, mine.amount, window) : null,
      unknown, calibration, knownEffectsLowerBound: true };
  };
  if (!mine || !asset || !capacity) { unknown.push({ code: 'mining-capacity-missing', entityIds: [mineId] }); return finish(); }
  if (!asset.target.landId) { unknown.push({ code: 'mine-ground-unknown', entityIds: [mineId] }); return finish(); }
  const facts = new Map(situation.units.map(unit => [unit.id, unit]));
  // unitArrival's legacy public type includes explanations, but this numerical
  // lookup consumes only the compact row and never reads those properties.
  const arrivalOf = (id: string) => { const fact = facts.get(id); return fact && unitArrival(fact as SituationUnit, mineId); };
  const unavailable = new Set(input.unavailableUnitIds ?? []), allowed = input.allowedUnitIds && new Set(input.allowedUnitIds);
  const explicit = input.explicitWorkerIds && new Set([...input.explicitWorkerIds, ...(engineerId ? [engineerId] : [])]);
  const owned = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && unit.kind === 'worker');
  const safe = (unit: Unit) => !unavailable.has(unit.id) && (!allowed || allowed.has(unit.id)) && (!explicit || explicit.has(unit.id))
    && !facts.get(unit.id)?.commitments.some(c => /^(mobileCare|frontRecovery)\.|retreat|workerEvacuation/.test(c.source));
  const counts = new Map<string, number>();
  for (const unit of owned) { const order = job(unit); if (order && order.resourceId !== mineId) counts.set(order.resourceId, (counts.get(order.resourceId) ?? 0) + 1); }
  const spare = owned.filter(unit => {
    const order = job(unit); if (!order || order.resourceId === mineId) return false;
    const count = counts.get(order.resourceId)!; counts.set(order.resourceId, count - 1);
    return count > capacity.standardWorkers;
  });
  const candidates = [...new Map([...owned.filter(u => job(u)?.resourceId === mineId),
    ...owned.filter(u => u.id === engineerId), ...owned.filter(u => u.order.type === 'idle'), ...spare]
    .filter(safe).map(unit => [unit.id, unit])).values()];
  for (const unit of candidates) {
    const stationed = unit.order.type === 'mine' && unit.order.resourceId === mineId && !unit.deck && !unit.cabin
      && (unit.mineSlot === mineId || unit.order.phase === 'gather' || unit.order.phase === 'return');
    const arrival = arrivalOf(unit.id);
    if (!stationed && (!arrival || !('ticks' in arrival))) { unknown.push({ code: 'worker-arrival-unknown', entityIds: [unit.id] }); continue; }
    if (!stationed && arrival?.status === 'conditional' && !explicit?.has(unit.id) && unit.id !== engineerId) {
      unknown.push({ code: 'worker-transport-ungranted', entityIds: [unit.id] }); continue;
    }
    const routeTicks = stationed ? 0 : finite(arrival && 'ticks' in arrival ? arrival.ticks : 0, 'worker arrival');
    workers.push({ unitId: unit.id, source: stationed ? 'stationed' : unit.id === engineerId ? 'engineer' : 'surplus',
      arrivalTicks: stationed ? 0 : Math.max(ready, routeTicks) + calibration.dispatchTicks,
      producerId: null, conditional: arrival?.status === 'conditional' });
  }
  workers.sort((a, b) => a.arrivalTicks - b.arrivalTicks || a.unitId.localeCompare(b.unitId));
  workers.splice(capacity.standardWorkers);
  const ownHalls = snapshot.buildings.filter(h => h.owner === owner && h.kind === 'townHall' && h.hp > 0);
  const targetLand = asset.target.landId;
  const hallLand = (hall: Building) => situation.assets.find(a => a.id === hall.id)?.target.landId;
  const targetHall = ownHalls.find(h => targetLand && hallLand(h) === targetLand && gap(h, mine) <= GOLD_MINE_RULES.baseRange);
  type Producer = { id: string; next: number; travel: number; basis: string | null; hall: Building | null };
  const producers: Producer[] = [];
  // A new local hall has a measured birth-to-entry service delay. Remote halls
  // require a nearby real worker's shared ETA as an explicit route estimate;
  // there is no straight-line or hidden route calculation in this module.
  for (const hall of ownHalls) {
    const local = hall === targetHall;
    if (!local && (!targetLand || hallLand(hall) !== targetLand)) continue;
    const basis = owned.filter(unit => facts.get(unit.id)?.location.kind === 'land' && 'landId' in facts.get(unit.id)!.location
      && (facts.get(unit.id)!.location as {landId:string}).landId === hallLand(hall) && gap(unit, hall) <= GOLD_MINE_RULES.baseRange)
      .map(unit => ({ unit, arrival: arrivalOf(unit.id) }))
      .filter(pair => pair.arrival && 'ticks' in pair.arrival && pair.arrival.status === 'reachable')
      .sort((a, b) => gap(a.unit, hall) - gap(b.unit, hall) || a.unit.id.localeCompare(b.unit.id))[0];
    if (!local && !basis) continue;
    const travel = local ? calibration.localBirthToEntryTicks : finite(basis!.arrival && 'ticks' in basis!.arrival ? basis!.arrival.ticks : 0, 'producer route') + calibration.dispatchTicks;
    let next = hall.complete ? 0 : local ? ready : Math.max(0, hall.buildTime - hall.buildProgress);
    for (const queued of hall.queue) {
      const starts = next; next += queued.remaining;
      if ('unitKind' in queued && queued.unitKind === 'worker' && workers.length < capacity.standardWorkers) {
        if (!queued.id) { unknown.push({ code: 'paid-worker-job-id-unknown', entityIds: [hall.id] }); continue; }
        const id = queued.id, arrivalTicks = Math.max(ready, next + travel);
        training.push({ id, jobId: id, producerId: hall.id, lane: 'training', paid: true, gold: 0, startsInTicks: starts, completesInTicks: next,
          onStationTicks: arrivalTicks, queueTicks: queued.remaining, routeBasisUnitId: local ? null : basis!.unit.id });
        workers.push({ unitId: id, source: 'paid-queue', arrivalTicks, producerId: hall.id, conditional: false });
      }
    }
    producers.push({ id: hall.id, next, travel, basis: local ? null : basis!.unit.id, hall });
  }
  if (!targetHall) producers.push({ id: `planned-hall:${mineId}`, next: ready, travel: calibration.localBirthToEntryTicks, basis: null, hall: null });
  const queuedWorkers = ownHalls.reduce((sum, hall) => sum + hall.queue.filter(q => 'unitKind' in q && q.unitKind === 'worker').length, 0);
  const stock = snapshot.players[owner]!;
  // Reserve an unlaid hall's full cash capital before optional recruitment.
  // A negative balance is a funding wait, never negative spendable money.
  const budget = input.availableGold === undefined ? stock.gold - (targetHall ? 0 : BUILDING_DEFS.townHall.cost)
    : finite(input.availableGold, 'available gold');
  const rate = situation.assets.filter(a => a.kind === 'mine' && a.owner === owner && a.id !== mineId).reduce((sum, a) => sum + a.incomeGoldPerTick, 0);
  const queuedSupply = snapshot.buildings.filter(b => b.owner === owner).reduce((sum, b) => sum + b.queue.reduce((total, q) => total
    + ('unitKind' in q ? UNIT_DEFS[q.unitKind].supplyUsed : 0), 0), 0);
  const supplyEvents = snapshot.buildings.filter(b => b.owner === owner && !b.complete && b.hp > 0
    && BUILDING_DEFS[b.kind].supplyProvided > 0).flatMap(b => {
      const builders = constructionWorkers(snapshot, b).length;
      return b === targetHall || builders ? [{ at: b === targetHall ? ready : Math.max(0, b.buildTime - b.buildProgress) / builders,
        amount: BUILDING_DEFS[b.kind].supplyProvided }] : [];
    });
  if (!targetHall) supplyEvents.push({ at: ready, amount: BUILDING_DEFS.townHall.supplyProvided });
  let spent = 0, newSupply = 0, count = owned.length + queuedWorkers;
  const fundingTime = (required: number): number | null => {
    if (required <= budget) return 0;
    const tax = miningIncomeRate(stock.supplyUsed);
    const incomeEvents = workers.map(w => w.arrivalTicks + (w.source === 'stationed' ? 0 : calibration.firstDeliveryTicks));
    const ends = [...new Set([0, ...incomeEvents, window.horizonTicks])].filter(t => t <= window.horizonTicks).sort((a, b) => a - b);
    let money = budget, ore = mine.amount;
    for (let index = 0; index + 1 < ends.length; index++) {
      const from = ends[index]!, until = ends[index + 1]!, ticks = until - from;
      const gross = capacity.goldPerTickCap * Math.min(1, incomeEvents.filter(t => t <= from).length / capacity.standardWorkers);
      const active = gross ? Math.min(ticks, ore / gross) : 0, net = gross * tax;
      if (rate + net > 0 && required <= money + (rate + net) * active) return from + (required - money) / (rate + net);
      money += (rate + net) * active; ore -= gross * active;
      if (rate > 0 && required <= money + rate * (ticks - active)) return from + active + (required - money) / rate;
      money += rate * (ticks - active);
    }
    return null;
  };
  while (workers.length < capacity.standardWorkers && producers.length) {
    if (count >= 36) { unknown.push({ code: 'worker-capacity-required', entityIds: [] }); break; }
    const supplyAt = (t: number) => stock.supplyCap + supplyEvents.filter(e => e.at <= t).reduce((sum, e) => sum + e.amount, 0)
      - stock.supplyUsed - queuedSupply - newSupply;
    const supplyReady = [0, ...supplyEvents.map(e => e.at)].sort((a, b) => a - b).find(t => supplyAt(t) >= UNIT_DEFS.worker.supplyUsed);
    if (supplyReady === undefined) { unknown.push({ code: 'worker-supply-required', entityIds: [] }); break; }
    const funding = fundingTime(spent + UNIT_DEFS.worker.cost);
    if (funding === null) { unknown.push({ code: 'worker-training-income-unknown', entityIds: [] }); break; }
    producers.sort((a, b) => Math.max(a.next, funding, supplyReady) + a.travel - Math.max(b.next, funding, supplyReady) - b.travel || a.id.localeCompare(b.id));
    const producer = producers[0]!, starts = Math.max(producer.next, funding, supplyReady), complete = starts + UNIT_DEFS.worker.trainTime;
    const onStationTicks = Math.max(ready, complete + producer.travel), id = `train-worker:${mineId}:${workers.length}`;
    if (onStationTicks + calibration.firstDeliveryTicks >= window.horizonTicks) break;
    training.push({ id, jobId: null, producerId: producer.id, lane: 'training', paid: false, gold: UNIT_DEFS.worker.cost, startsInTicks: starts,
      completesInTicks: complete, onStationTicks, queueTicks: UNIT_DEFS.worker.trainTime, routeBasisUnitId: producer.basis });
    workers.push({ unitId: id, source: 'train-worker', arrivalTicks: onStationTicks, producerId: producer.id, conditional: false });
    producer.next = complete; spent += UNIT_DEFS.worker.cost; newSupply += UNIT_DEFS.worker.supplyUsed; count++;
  }
  if (workers.length < capacity.standardWorkers && !producers.length) unknown.push({ code: 'worker-producer-arrival-unknown', entityIds: ownHalls.map(h => h.id) });
  workers.sort((a, b) => a.arrivalTicks - b.arrivalTicks || a.unitId.localeCompare(b.unitId));
  // The native mine admits one worker per entry interval, including a cluster
  // of transferred workers arriving together. This is not five instant slots.
  let admitted = -Infinity;
  for (let index = 0; index < workers.length; index++) {
    const worker = workers[index]!, time = worker.source === 'stationed' ? 0 : Math.max(worker.arrivalTicks, admitted + capacity.entryIntervalTicks);
    workers[index] = { ...worker, arrivalTicks: time }; admitted = time;
    const trained = training.findIndex(t => t.id === worker.unitId);
    if (trained >= 0) training[trained] = { ...training[trained]!, onStationTicks: time };
  }
  return finish();
}
