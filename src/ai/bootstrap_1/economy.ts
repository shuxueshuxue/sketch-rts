import { BUILDING_DEFS, UNIT_DEFS, requiredSupplyCap } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { BuildingKind, GameCommand, GameSnapshot, PlayerId, TrainableUnitKind } from '../../shared/types';
import { navalBudgetReserve, navalReservePurchase } from '../policy/naval';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { rankV6Goals } from '../policy/v6/economy';
import { v6Memory } from '../policy/v6/memory';
import { v6Doctrine } from '../policy/v6/select';
import { projectedSupplyUsed } from '../policy/world-model';
import { towerRushGoal, towerRushConstructionCrew } from './tower-rush';
import { isOpponentOwner } from '../policy/ownership';

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

export function rankBootstrapGoals(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const ranked = rankV6Goals(snapshot, owner, options);
  const siege = options.requestedVersion === 'v7' ? towerRushGoal(snapshot, owner, options) : undefined;
  if (siege) { ranked.push(siege); ranked.sort((a, b) => b.priority - a.priority); }
  const player = snapshot.players[owner]!;
  const wanted = wantedUnits(snapshot, owner, options);
  const wave = productionWaveSupply(snapshot, owner, options, ranked, wanted);
  const own = snapshot.buildings.filter(building => building.owner === owner);
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
    return [{ ...goal, productionReserve }];
  }).filter(goal => {
    // Being near an outlying farm or a forward tower does not itself threaten a mining hall.
    if (goal.id === 'tower:ahead' && !threatenedHome) return false;
    if (goal.id === 'farm' && player.supplyCap - projectedSupplyUsed(snapshot, owner) > wave) return false;
    if (goal.id.startsWith('unit:')) return true;
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
