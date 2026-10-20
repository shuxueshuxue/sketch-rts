import { assembleExecutor } from './assemble';
import { buildHallExecutor } from './build-hall';
import { clearCampExecutor } from './clear-camp';
import { defendSiteExecutor } from './defend-site';
import { establishForceExecutor } from './establish-force';
import { establishGarrisonExecutor } from './establish-garrison';
import { evacuateExecutor } from './evacuate';
import { trainTransportExecutor } from './train-transport';
import { trainWorkerExecutor } from './train-worker';
import { transportExecutor } from './transport';
import { waitIncomeExecutor } from './wait-income';
import { startMiningExecutor } from './start-mining';
import type { StrategyExecutor } from '../allocation-types';

/** Registration data only; bootstrap control decides whether to invoke it. */
export const defenseAndConquestExecutors: readonly StrategyExecutor[] = [assembleExecutor, buildHallExecutor, clearCampExecutor,
  defendSiteExecutor, establishForceExecutor, establishGarrisonExecutor, evacuateExecutor, startMiningExecutor, trainTransportExecutor, trainWorkerExecutor, transportExecutor, waitIncomeExecutor];
