import { missingMiningWorkers, needsRemoteLaborInvestment, planMiningWorkforcePurchase } from './workforce';
import { BUILDING_DEFS, UNIT_DEFS, canTrainAt, requiredSupplyCap, trainableUnitsAt } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { BuildingKind, GameCommand, GameSnapshot, PlayerId, TrainableUnitKind, Unit } from '../../shared/types';
import { colonyNavalWantWithMineEligibility, navalBudgetReserve, navalReservePurchase } from '../policy/naval';
import { mountedMinePlan } from '../policy/mounted-mine-plan';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { ageV6Goals, availableV6ConstructionWorkers, collectV6Goals, healingPostGoals, issueV6Construction, v6ExpansionGoal, type rankV6Goals } from '../policy/v6/economy';
import { v6Memory } from '../policy/v6/memory';
import { readV6Intel } from '../policy/v6/intel';
import { v6Doctrine } from '../policy/v6/select';
import { projectedSupplyUsed } from '../policy/world-model';
import { towerRushGoal, towerRushConstructionCrew } from './tower-rush';
import { isOpponentOwner } from '../policy/ownership';
import { recoveryPatients } from './medical-recovery';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { bootstrapExpansionMine, enemyExpansionPower } from './expansion-target';
import { safeBuildPointAt, towerPointFor } from '../policy/build-layout';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { distance } from '../policy/spatial';
import { controlledMercenaryGoals } from './mercenary-goals';
import { shoppingGoals } from './shopping';
import { routeArrivals } from '../../shared/route-selection';
import { colonyRecoveryGoals } from './colony-recovery';
import { armedFoes, retreatLandTravelTicks } from './safe-land-route';
import { freeIncomeCapitalGoals } from './free-income-capital';

export const bootstrapEconomy: AiScript = {
  id: 'v6Economy',
  phase: 'economy',
  run: planBootstrapEconomy,
};

function wantedUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const player = snapshot.players[owner]!;
  const own = snapshot.buildings.filter(building => building.owner === owner);
  const army = snapshot.units.filter(unit => unit.owner === owner);
  const { strategy } = v6Doctrine(snapshot, owner, options);
  const phase = strategy.phases[v6Memory(options).phase!]!;
  const wanted = new Set<TrainableUnitKind>();
  for (const want of [...phase.wants, ...options.armyWants!]) {
    if (!('unit' in want) || requiredSupplyCap(want.unit) > player.supplyCap) continue;
    const have = army.filter(unit => unit.kind === want.unit).length
      + own.reduce((total, building) => total + building.queue.filter(job => job.unitKind === want.unit).length, 0);
    if (have < want.count) wanted.add(want.unit);
  }
  return wanted;
}

/** Reserve one production wave, rather than two supply for every idle producer. */
function productionWaveSupply(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, goals: ReturnType<typeof rankV6Goals>, wanted: Set<TrainableUnitKind>) {
  const own = snapshot.buildings.filter(building => building.owner === owner);
  const race = snapshot.players[owner]!.race;
  const production = new Set(wanted);
  for (const building of own) for (const kind of trainableUnitsAt(race, building.kind)) {
    if (goals.some(goal => goal.id === `engineering:${kind}`)) production.add(kind);
  }
  if (missingMiningWorkers(snapshot, owner, towerRushConstructionCrew(snapshot, owner, options), options) > 0) production.add('worker');
  return own.filter(building => building.complete).reduce((total, building) => {
    const kinds = [...trainableUnitsAt(race, building.kind).filter(kind => production.has(kind)), ...building.queue.map(job => job.unitKind)];
    return total + Math.max(0, ...kinds.map(kind => UNIT_DEFS[kind].supplyUsed));
  }, 0);
}

// One pending construction of each kind: a walking colony builder does not lock home tech.
const constructBootstrap: typeof issueV6Construction = (economy, kind, point, used, play) => {
  if (used.size || economy.workers.some(worker => worker.order.type === 'build' && worker.order.buildingKind === kind)) return undefined;
  // Supply belongs to the whole player. Once settlers have left the opening
  // island, an empty original capital must not stop every production queue.
  // Select a staffed settlement by its builder's actual road, retaining the
  // common legal spacing and threat scoring at each candidate base.
  if (kind === 'farm') {
    const slot=economy.own.filter(building=>building.kind==='farm').length+4;
    const sites=economy.own.filter(building=>building.kind==='townHall' && building.complete).flatMap(base=>{
      const site=safeBuildPointAt(economy.snapshot,economy.owner,base,slot,kind);
      if (!isBuildPlacementClear(economy.snapshot,kind,site)) return [];
      const arrivals=routeArrivals(economy.snapshot.map,availableV6ConstructionWorkers(economy,site,used)
        .filter(worker=>worker.carryingGold===0),site,'land');
      const builder=arrivals.sort((a,b)=>Number(a.unit.order.type!=='idle')-Number(b.unit.order.type!=='idle') || a.ticks-b.ticks)[0];
      return builder ? [{point:site,idle:builder.unit.order.type==='idle',ticks:builder.ticks}] : [];
    }).sort((a,b)=>Number(b.idle)-Number(a.idle) || a.ticks-b.ticks);
    if (!sites.length) return undefined;
    point=sites[0]!.point;
  }
  // Let miners deliver their current load, then reuse free builders before interrupting a five-worker lane.
  const ready = availableV6ConstructionWorkers(economy, point, used).filter(worker => worker.carryingGold === 0);
  const issue = (workers: Unit[]) => issueV6Construction({ ...economy,
    workers: routeArrivals(economy.snapshot.map, workers, point, 'land').slice(0, 1).map(({ unit }) => unit),
  }, kind, point, used, play);
  // A replacement on the last working income uses its nearest eligible empty-handed worker.
  if (economy.own.filter(building => building.kind === 'townHall' && building.complete).length > 1
    && activeMiningBaseCount(economy.snapshot, economy.owner) === 1) {
    return issue(ready);
  }
  const assigned = new Map<string, number>(economy.workers.flatMap(worker => worker.order.type === 'mine'
    ? [[worker.order.resourceId, 0] as const] : []));
  for (const worker of economy.workers) if (worker.order.type === 'mine') {
    assigned.set(worker.order.resourceId, assigned.get(worker.order.resourceId)! + 1);
  }
  const priority = (worker: Unit) => worker.order.type === 'idle' ? 0
    : worker.order.type === 'mine' && assigned.get(worker.order.resourceId)! > GOLD_MINE_RULES.workstations ? 1 : 2;
  const preferred = Math.min(...ready.map(priority));
  return issue(ready.filter(worker => priority(worker) === preferred));
};

// Working mines can fund cover at a safe, cleared expansion while the army fights elsewhere.
const prepareMiningCover: Parameters<typeof collectV6Goals>[5] = (economy, mine, priority, target) => {
  const { snapshot, owner, intel, own } = economy;
  // An issued hall construction already owns this expansion, including its walk to the site.
  if (economy.workers.some(worker => worker.order.type === 'build' && worker.order.buildingKind === 'townHall')) return [];
  if (enemyExpansionPower(snapshot, intel, mine, BUILDING_DEFS.defenseTower.attackRange + GOLD_MINE_RULES.baseRange) === 0) {
    const free = v6ExpansionGoal(economy, mine, priority, target), foes = armedFoes(snapshot, owner, economy.options);
    const workers = economy.workers.filter(worker => retreatLandTravelTicks(snapshot, worker, free.point, foes) !== undefined);
    return workers.length > 0 ? [{ ...free,
      issue: used => economy.construct({ ...economy, workers }, 'townHall', free.point, used, 'expand') }] : [];
  }
  const incomes = activeMiningBaseCount(snapshot, owner);
  const cover = own.some(building => building.kind === 'defenseTower' && distance(building, mine) <= building.attackRange);
  if (incomes === 0 && !cover) return [];
  // The hall is the same purchase before and after cover arrives; keep its existing aging and ordinary price.
  const capital = { id: `bases:${target}`, priority, cost: BUILDING_DEFS.townHall.cost, save: true, hold: true as const,
    issue: () => undefined };
  if (enemyExpansionPower(snapshot, intel, mine, BUILDING_DEFS.defenseTower.attackRange + GOLD_MINE_RULES.baseRange) > 0
    || cover) return [capital];
  const point = towerPointFor(snapshot, owner, mine, intel.home);
  if (!isBuildPlacementClear(snapshot, 'defenseTower', point)
    || snapshot.units.some(unit => unit.owner === 'neutral' && unit.attackDamage > 0
      && distance(unit, point) <= BUILDING_DEFS.defenseTower.attackRange)) return [capital];
  return [{ id: `mining-cover:${mine.x}:${mine.y}`, priority, cost: BUILDING_DEFS.defenseTower.cost, save: true,
    issue: used => economy.construct(economy, 'defenseTower', point, used, 'mining:cover') }, capital];
};

export function rankBootstrapGoals(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const goals = collectV6Goals(snapshot, owner, options, constructBootstrap,
    (view, player, context) => colonyNavalWantWithMineEligibility(view, player, context, mountedMinePlan(view, context.memory).eligible), prepareMiningCover,
    (view, intel) => bootstrapExpansionMine(view, owner, intel, options),
    economy => [...healingPostGoals(economy), ...freeIncomeCapitalGoals(economy)],
    // Candidate supply follows the next production wave, not the legacy
    // fifteen-farm ceiling. Construction still pays ordinary gold.
    Number.POSITIVE_INFINITY);
  goals.push(...controlledMercenaryGoals(snapshot, owner, options));
  goals.push(...shoppingGoals(snapshot, owner, options));
  goals.push(...colonyRecoveryGoals(snapshot, owner, options));
  const siege = options.requestedVersion === 'v7' ? towerRushGoal(snapshot, owner, options) : undefined;
  if (siege) goals.push(siege);
  const ranked = ageV6Goals(snapshot, options, goals);
  const player = snapshot.players[owner]!;
  const wanted = wantedUnits(snapshot, owner, options);
  const wave = productionWaveSupply(snapshot, owner, options, ranked, wanted);
  const own = snapshot.buildings.filter(building => building.owner === owner);
  const healer = 'priest';
  const recovering = recoveryPatients(snapshot, owner).length > 0;
  // Keep the requested first healer funded until its ordinary training has been queued.
  const recoveryReserve = wanted.has(healer) && !snapshot.units.some(unit => unit.owner === owner && unit.kind === healer)
    && own.some(building => canTrainAt(player.race, building.kind, healer) && (building.queue.length > 0 || recovering)
      && building.queue.every(job => job.unitKind !== healer)) ? UNIT_DEFS[healer].cost : 0;
  // Fund the next recruitment wave before adding production infrastructure.
  const waveReserve = own.some(building => building.complete && building.queue.length > 0)
    ? own.filter(building => building.complete && building.queue.length === 0).reduce((total, building) => total
      + Math.max(0, ...trainableUnitsAt(player.race, building.kind).filter(unit => wanted.has(unit)).map(unit => UNIT_DEFS[unit].cost)), 0) : 0;
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall');
  const threatenedHome = snapshot.units.some(unit => unit.kind !== 'worker' && isOpponentOwner(snapshot, owner, unit.owner, options)
    && halls.some(hall => Math.hypot(hall.x - unit.x, hall.y - unit.y) <= BUILDING_DEFS.defenseTower.attackRange + GOLD_MINE_RULES.baseRange
      || ((unit.order.type === 'attackMove' || unit.order.type === 'move')
        && Math.hypot(hall.x - unit.order.x, hall.y - unit.order.y) <= BUILDING_DEFS.defenseTower.attackRange)));
  const crew = towerRushConstructionCrew(snapshot, owner, options);
  const remoteWorkerProducers = needsRemoteLaborInvestment(snapshot, owner, crew)
    ? new Set(planMiningWorkforcePurchase(snapshot, owner, crew, options).flatMap(command => command.type === 'train' ? [command.buildingId] : []))
    : undefined;
  const purchases = new Set<string>();
  return ranked.flatMap(goal => {
    let productionReserve = 0;
    if (goal.id.startsWith('build:') || goal.id.startsWith('capacity:')) {
      const kind = goal.id.split(':')[1] as BuildingKind;
      const existing = own.filter(building => building.kind === kind);
      if (existing.length > 0 && trainableUnitsAt(player.race, kind).length > 0) {
        const recruits = trainableUnitsAt(player.race, kind).filter(unit => wanted.has(unit));
        if (recruits.length === 0) return [];
        productionReserve = Math.max(...recruits.map(unit => UNIT_DEFS[unit].cost))
          * existing.filter(building => building.complete && building.queue.length === 0).length;
      }
    }
    if (goal.id.startsWith('build:') || goal.id.startsWith('capacity:') || goal.id === 'engineering:workshop') {
      productionReserve = Math.max(productionReserve, waveReserve);
    }
    return [{ ...goal, productionReserve: Math.max(productionReserve, goal.id === `unit:${healer}` ? 0 : recoveryReserve) }];
  }).filter(goal => {
    // Being near an outlying farm or a forward tower does not itself threaten a mining hall.
    if (goal.id.startsWith('worker@') && (missingMiningWorkers(snapshot, owner, crew, options) <= 0
      || remoteWorkerProducers !== undefined && !remoteWorkerProducers.has(goal.id.slice('worker@'.length)))) return false;
    if (goal.id === 'tower:ahead' && !threatenedHome) return false;
    if (goal.id === 'farm' && player.supplyCap - projectedSupplyUsed(snapshot, owner) > wave) return false;
    if (goal.id.startsWith('unit:')) return wanted.has(goal.id.slice(5) as TrainableUnitKind);
    // Every base target requests the same next hall; reserve its gold only once.
    const purchase = goal.id.startsWith('bases:') ? 'townHall' : goal.id;
    if (purchases.has(purchase)) return false;
    purchases.add(purchase);
    return true;
  });
}

// The frozen goal generator still supplies placement, prerequisites, naval plans and aging.
// Only the candidate's purchase order changes; all commands spend ordinary gold and supply.
export function planBootstrapEconomy(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const goals = rankBootstrapGoals(snapshot, owner, options);
  const player = snapshot.players[owner]!;
  let gold = player.gold;
  let supply = projectedSupplyUsed(snapshot, owner);
  const navalReserve = Math.max(navalBudgetReserve(snapshot, owner, options),
    ...goals.filter(goal => goal.id === 'naval:islandHall'
      && readV6Intel(snapshot, owner, options).intrusion === undefined).map(goal => goal.cost));
  const builders = new Set<string>();
  const commands: GameCommand[] = [];
  const bought = new Set<string>();
  const producers = new Set<string>();
  const labs = new Set<string>();
  let savingDiscretionary = false;
  for (const goal of goals) {
    const reservedPurchase = navalReservePurchase(goal.id);
    if (savingDiscretionary && !reservedPurchase) continue;
    if (goal.producer && producers.has(goal.producer)) continue;
    // Fund the existing production wave before spending the remainder on more factories.
    if (goal.productionReserve > 0 && gold < goal.cost + goal.productionReserve) continue;
    const research = goal.id.startsWith('upgrade:')
      ? goal.issue(builders) as Extract<GameCommand, { type: 'research' }> : undefined;
    if (research !== undefined && labs.has(research.buildingId)) continue;
    const spendable = gold - (reservedPurchase ? 0 : navalReserve);
    if (goal.cost > spendable) {
      if (goal.save) {
        if (reservedPurchase || navalReserve === 0) break;
        // Save the discretionary pool against this same affordability gate.
        // A colony can still spend its protected funds on its own purchases.
        savingDiscretionary = true;
      }
      continue;
    }
    const command = research === undefined ? goal.issue(builders) : research;
    if (!command) {
      if (goal.hold) gold -= goal.cost;
      continue;
    }
    if (command.type === 'train' || command.type === 'hire') {
      if (command.type === 'train' && producers.has(command.buildingId)) continue;
      const kind = command.type === 'train' ? command.unitKind
        : snapshot.mercenaryCamps.find(camp => camp.id === command.campId)!.hireKind;
      const used = UNIT_DEFS[kind].supplyUsed;
      if (supply + used > player.supplyCap) continue;
      supply += used;
      if (command.type === 'train') producers.add(command.buildingId);
    }
    if (command.type === 'research') {
      labs.add(command.buildingId);
    }
    commands.push(command);
    bought.add(goal.id);
    gold -= goal.cost;
  }
  const ages = v6Memory(options).goalAges!;
  for (const id of bought) delete ages[id];
  return commands;
}
