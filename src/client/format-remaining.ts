import { SIM_TICKS_PER_SECOND } from "../shared/time";

/** @@@format-remaining - Time left, written one way everywhere (docs/art/progress-display.zh.md §3): under 3 seconds in
 * tenths ("2.4s"), under a minute in whole seconds ("12s"), else minutes and seconds ("1:05"); nothing when no time is
 * left. Each figure is rounded up to its own precision before its range is chosen, so 2.99 s reads "3s" and 59.9 s
 * reads "1:00". */
export function formatRemaining(ticks: number): string {
  if (!(ticks > 0) || !Number.isFinite(ticks)) return "";
  const seconds = ticks / SIM_TICKS_PER_SECOND;
  const tenths = Math.ceil(seconds * 10 - 1e-9) / 10;
  if (tenths < 3) return `${tenths}s`;
  const whole = Math.ceil(seconds - 1e-9);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
