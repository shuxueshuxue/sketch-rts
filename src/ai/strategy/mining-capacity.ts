import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { MiningCapacity } from './types';

/** This reports the simulation's limits, not a fitted worker income model. */
export function miningCapacity(staffedWorkerIds: readonly string[]): MiningCapacity {
  const entryIntervalTicks = GOLD_MINE_RULES.entrySeconds * SIM_TICKS_PER_SECOND;
  return {
    goldPerTickCap: GOLD_MINE_RULES.goldPerTrip / entryIntervalTicks,
    standardWorkers: GOLD_MINE_RULES.workstations,
    staffedWorkerIds: [...new Set(staffedWorkerIds)].sort(),
    goldPerTrip: GOLD_MINE_RULES.goldPerTrip,
    gatherTicks: GOLD_MINE_RULES.gatherSeconds * SIM_TICKS_PER_SECOND,
    entryIntervalTicks,
  };
}
