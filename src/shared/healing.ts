import { isShipKind } from './ship-geometry';
import type { Unit } from './types';

/** Hulls and fittings recover through repairs, never medical healing. */
export function canReceiveHealing(unit: Pick<Unit, 'kind'>) {
  return !isShipKind(unit.kind);
}
