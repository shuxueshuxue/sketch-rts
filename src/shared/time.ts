export const SIM_TICKS_PER_SECOND = 20;

/** Integrate a rate defined per second over one simulation step. */
export function perTick(ratePerSecond: number) {
  return ratePerSecond / SIM_TICKS_PER_SECOND;
}

export function seconds(value: number) {
  return Math.max(1, Math.round(value * SIM_TICKS_PER_SECOND));
}
