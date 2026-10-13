import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES, miningIncomeRate } from '../../shared/mining';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { mineGuards } from '../policy/v6/intel';
import { availableV6ConstructionWorkers, baseGoal, v6ExpansionPoint, WORKER_CAP, type Economy } from '../policy/v6/economy';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { armedFoes, retreatLandTravelTicks } from './safe-land-route';
import { towerRushConstructionCrew } from './tower-rush';

/** Free income is an investment capability, independent of casualty-driven army quotas. */
export function freeIncomeCapitalGoals(economy: Economy) {
  const { snapshot, owner, options } = economy;
  const income = activeMiningBaseCount(snapshot, owner);
  if (income < 2 || economy.intel.army.length < 6
    || (income + 1) * GOLD_MINE_RULES.workstations + towerRushConstructionCrew(snapshot, owner, options) > WORKER_CAP
    || economy.own.some(building => building.kind === 'townHall' && !building.complete)) return [];
  const mine = economy.chooseMine(snapshot, economy.intel);
  const investment = BUILDING_DEFS.townHall.cost + UNIT_DEFS.worker.cost * GOLD_MINE_RULES.workstations + BUILDING_DEFS.defenseTower.cost;
  if (!mine || mineGuards(snapshot, mine).length > 0
    || mine.amount * miningIncomeRate(snapshot.players[owner]!.supplyUsed) < investment) return [];
  const point = v6ExpansionPoint(snapshot, owner, mine), foes = armedFoes(snapshot, owner, options);
  if (!isBuildPlacementClear(snapshot, 'townHall', point)
    || !availableV6ConstructionWorkers(economy, point, new Set()).some(worker =>
      retreatLandTravelTicks(snapshot, worker, point, foes) !== undefined)) return [];
  return baseGoal({ ...economy, chooseMine: () => mine }, income + 1, 76);
}
