import { SIM_TICKS_PER_SECOND } from "../shared/time";

// @@@story-time - Time in a script is a value with a unit, not a bare number. The game counts in ticks (20 a second);
// a script says `seconds(3)` and the type keeps a span of time (a Duration) apart from a moment on the game's clock (an
// Instant): `wait(seconds(3))` and `at(now + seconds(90))` read as they mean, and passing a tick number where a span is
// wanted, or adding two moments, does not compile. Both are whole ticks, so the story steps on the same beat as the sim.

declare const UNIT: unique symbol;
export type Duration = number & { readonly [UNIT]: "duration" };
export type Instant = number & { readonly [UNIT]: "instant" };

export function ticks(count: number): Duration {
  if (!Number.isFinite(count)) throw new Error(`A duration must be finite, got ${count}`);
  return Math.max(0, Math.round(count)) as Duration;
}

export const seconds = (value: number) => ticks(value * SIM_TICKS_PER_SECOND);
export const minutes = (value: number) => seconds(value * 60);

export function instant(tick: number): Instant {
  return Math.round(tick) as Instant;
}

export function later(from: Instant, span: Duration): Instant {
  return (from + span) as Instant;
}

export function since(from: Instant, to: Instant): Duration {
  return ticks(to - from);
}

export function scale(span: Duration, factor: number): Duration {
  return ticks(span * factor);
}

export function inSeconds(span: Duration): number {
  return span / SIM_TICKS_PER_SECOND;
}

// "3:05": a moment of the match as a player reads the clock.
export function clockText(at: Instant): string {
  const total = Math.floor(at / SIM_TICKS_PER_SECOND);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
