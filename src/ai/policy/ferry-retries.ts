import type { NavalPlanMemory } from '../memory';

export const FERRY_TARGET_ATTEMPTS = 3;

/** A failed target cannot monopolize the same boat indefinitely. */
export function ferryTargetAvailable(memory: NavalPlanMemory, shipId: string, targetId: string) {
  return (memory.ferryFailures?.[shipId]?.[targetId]?.attempts ?? 0) < FERRY_TARGET_ATTEMPTS;
}
