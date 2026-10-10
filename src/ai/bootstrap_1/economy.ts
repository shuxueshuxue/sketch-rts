import { BUILDING_DEFS, UNIT_DEFS, requiredSupplyCap } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { BuildingKind, GameCommand, GameSnapshot, PlayerId, TrainableUnitKind } from '../../shared/types';
import { colonyNavalWant, navalBudgetReserve, navalReservePurchase } from '../policy/naval';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { ageV6Goals, collectV6Goals, issueV6Construction, type rankV6Goals } from '../policy/v6/economy';
import { v6Memory } from '../policy/v6/memory';
import { v6Doctrine } from '../policy/v6/select';
import { projectedSupplyUsed } from '../policy/world-model';
import { towerRushGoal, towerRushConstructionCrew } from './tower-rush';
import { isOpponentOwner } from '../policy/ownership';
import { recoveryPatients } from './medical-recovery';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { enemyPowerNear } from '../policy/v6/intel';
import { towerPointFor } from '../policy/build-layout';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { distance } from '../policy/spatial';

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
  const army = snapshot.units.filter(unit => unit.owner === owner);
  const production = new Set(wanted);
  for (const building of own) for (const kind of BUILDING_DEFS[building.kind].trains) {
    if (goals.some(goal => goal.id === `engineering:${kind}`)) production.add(kind);
  }
  const halls = own.filter(building => building.kind === 'townHall');
  const miningHalls = halls.filter(hall => snapshot.resources.some(mine => mine.amount > 0
    && Math.hypot(hall.x - mine.x, hall.y - mine.y) <= GOLD_MINE_RULES.baseRange));
  const workers = army.filter(unit => unit.kind === 'worker' && !unit.deck).length
    + halls.reduce((total, hall) => total + hall.queue.filter(job => job.unitKind === 'worker').length, 0);
  if (workers < Math.min(36, miningHalls.length * GOLD_MINE_RULES.workstations + towerRushConstructionCrew(snapshot, owner, options))) production.add('worker');
  return own.filter(building => building.complete).reduce((total, building) => {
    const kinds = [...BUILDING_DEFS[building.kind].trains.filter(kind => production.has(kind)), ...building.queue.map(job => job.unitKind)];
    return total + Math.max(0, ...kinds.map(kind => UNIT_DEFS[kind].supplyUsed));
  }, 0);
}

// One pending construction of each kind: a walking colony builder does not lock home tech.
const constructBootstrap: typeof issueV6Construction = (economy, kind, point, used, play) => {
  if (used.size || economy.workers.some(worker => worker.order.type === 'build' && worker.order.buildingKind === kind)) return undefined;
  return issueV6Construction(economy, kind, point, used, play);
};

// A single working mine can fund a tower at its safe, cleared replacement without pulling the army off a fight.
const prepareMiningCover: Parameters<typeof collectV6Goals>[5] = (economy, mine, priority) => {
  const { snapshot, owner, intel, own } = economy;
  if (activeMiningBaseCount(snapshot, owner) !== 1
    || enemyPowerNear(intel, mine, BUILDING_DEFS.defenseTower.attackRange + GOLD_MINE_RULES.baseRange) > 0
    || own.some(building => building.kind === 'defenseTower' && distance(building, mine) <= building.attackRange)) return [];
  const point = towerPointFor(snapshot, owner, mine, intel.home);
  if (!isBuildPlacementClear(snapshot, 'defenseTower', point)
    || snapshot.units.some(unit => unit.owner === 'neutral' && unit.attackDamage > 0
      && distance(unit, point) <= BUILDING_DEFS.defenseTower.attackRange)) return [];
  return [{ id: `mining-cover:${mine.x}:${mine.y}`, priority, cost: BUILDING_DEFS.defenseTower.cost, save: true,
    issue: used => economy.construct(economy, 'defenseTower', point, used, 'mining:cover') }];
};

export function rankBootstrapGoals(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const goals = collectV6Goals(snapshot, owner, options, constructBootstrap, colonyNavalWant, prepareMiningCover);
  const siege = options.requestedVersion === 'v7' ? towerRushGoal(snapshot, owner, options) : undefined;
  if (siege) goals.push(siege);
  const ranked = ageV6Goals(snapshot, options, goals);
  const player = snapshot.players[owner]!;
  const wanted = wantedUnits(snapshot, owner, options);
  const wave = productionWaveSupply(snapshot, owner, options, ranked, wanted);
  const own = snapshot.buildings.filter(building => building.owner === owner);
  const healer = player.race === 'grove' ? 'priest' : 'emberAcolyte';
  const recovering = recoveryPatients(snapshot, owner).length > 0;
  // Keep the requested first healer funded until its ordinary training has been queued.
  const recoveryReserve = wanted.has(healer) && !snapshot.units.some(unit => unit.owner === owner && unit.kind === healer)
    && own.some(building => BUILDING_DEFS[building.kind].trains.includes(healer) && (building.queue.length > 0 || recovering)
      && building.queue.every(job => job.unitKind !== healer)) ? UNIT_DEFS[healer].cost : 0;
  // Keep one wanted recruitment wave funded, including busy queues whose next recruit goal does not exist yet.
  const waveReserve = own.some(building => building.complete && building.queue.length > 0)
    ? own.filter(building => building.complete).reduce((total, building) => total
      + Math.max(0, ...BUILDING_DEFS[building.kind].trains.filter(unit => wanted.has(unit)).map(unit => UNIT_DEFS[unit].cost)), 0) : 0;
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall');
  const threatenedHome = snapshot.units.some(unit => unit.kind !== 'worker' && isOpponentOwner(snapshot, owner, unit.owner, options)
    && halls.some(hall => Math.hypot(hall.x - unit.x, hall.y - unit.y) <= BUILDING_DEFS.defenseTower.attackRange + GOLD_MINE_RULES.baseRange
      || ((unit.order.type === 'attackMove' || unit.order.type === 'move')
        && Math.hypot(hall.x - unit.order.x, hall.y - unit.order.y) <= BUILDING_DEFS.defenseTower.attackRange)));
  const purchases = new Set<string>();
  return ranked.flatMap(goal => {
    let productionReserve = 0;
    if (goal.id.startsWith('build:') || goal.id.startsWith('capacity:')) {
      const kind = goal.id.split(':')[1] as BuildingKind;
      const existing = own.filter(building => building.kind === kind);
      if (existing.length > 0 && BUILDING_DEFS[kind].trains.length > 0) {
        productionReserve = Math.max(0, ...BUILDING_DEFS[kind].trains.filter(unit => wanted.has(unit)).map(unit => UNIT_DEFS[unit].cost)) * existing.length;
        if (productionReserve === 0) return [];
      }
    }
    if (goal.id.startsWith('build:') || goal.id.startsWith('capacity:') || goal.id.startsWith('upgrade:') || goal.id === 'engineering:workshop') {
      productionReserve = Math.max(productionReserve, waveReserve);
    }
    return [{ ...goal, productionReserve: Math.max(productionReserve, goal.id === `unit:${healer}` ? 0 : recoveryReserve) }];
  }).filter(goal => {
    // Being near an outlying farm or a forward tower does not itself threaten a mining hall.
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
  const navalReserve = navalBudgetReserve(snapshot, owner, options);
  const builders = new Set<string>();
  const commands: GameCommand[] = [];
  const bought = new Set<string>();
  const producers = new Set<string>();
  const labs = new Set<string>();
  for (const goal of goals) {
    // Fund the existing production wave before spending the remainder on more factories.
    if (goal.productionReserve > 0 && gold < goal.cost + goal.productionReserve) continue;
    const research = goal.id.startsWith('upgrade:')
      ? goal.issue(builders) as Extract<GameCommand, { type: 'research' }> : undefined;
    if (research !== undefined && labs.has(research.buildingId)) continue;
    if (goal.cost > gold - (navalReservePurchase(goal.id) ? 0 : navalReserve)) {
      if (goal.save && goal.cost > gold) break;
      continue;
    }
    const command = research === undefined ? goal.issue(builders) : research;
    if (!command) {
      if (goal.hold) gold -= goal.cost;
      continue;
    }
    if (command.type === 'train') {
      if (producers.has(command.buildingId)) continue;
      const used = UNIT_DEFS[command.unitKind].supplyUsed;
      if (supply + used > player.supplyCap) continue;
      supply += used;
      producers.add(command.buildingId);
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
