import type { MiningWorkforceCalibration } from './mining-forecast';

/** Measured from immutable main 646cf9a0, eleven maps / 36 seats / 15 minutes.
 * See docs/ai/objectives/mining-workforce-forecast.zh.md for provenance, holdout
 * errors and censoring. These delays describe the existing economy, not a new
 * execution policy. Never infer a travel ETA from these service delays. */
export const MINING_WORKFORCE_CALIBRATION: MiningWorkforceCalibration = Object.freeze({
  id: 'main646-11maps-v1', dispatchTicks: 28, localBirthToEntryTicks: 102,
  firstDeliveryTicks: 105, workerCountMae: .9059833300257988, workerCountP90Error: 4,
});
