import { matchesUnitTarget, NON_MECHANICAL_TARGETS } from './unit-targeting';
import type { GameSnapshot, Unit } from './types';

/** All mechanical bodies recover through repairs, never medical healing. */
export function canReceiveHealing(unit: Pick<Unit, 'kind' | 'variant'>, snapshot?: Pick<GameSnapshot, 'variants'>) {
  return matchesUnitTarget(unit, NON_MECHANICAL_TARGETS, snapshot);
}
