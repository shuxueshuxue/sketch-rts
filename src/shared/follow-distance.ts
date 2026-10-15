import type { Unit } from './types';

/** The native follower stays still inside this distance from its target. */
export function followStopDistance(follower: Pick<Unit, 'radius'>, target: Pick<Unit, 'radius'>) {
  return Math.max(72, target.radius + follower.radius + 26);
}
