export const SIM_TICKS_PER_SECOND = 20;

export function seconds(value: number) {
  return Math.max(1, Math.round(value * SIM_TICKS_PER_SECOND));
}
