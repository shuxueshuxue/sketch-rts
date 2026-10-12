import { HEAVY_ARMOR_DAMAGE } from './damage-reduction';
import type { UnitKind } from './types';

/** Troop ferries share the weaker ranged protection already used for towers,
 * rather than inheriting a warship's heavy armor. Crew output remains limited. */
export const TRANSPORT_COMBAT = {
  rangedDamageTaken: HEAVY_ARMOR_DAMAGE.tower,
  passengerDamageMultiplier: .5,
} as const;

export function isTransportKind(kind: UnitKind): kind is 'transport' | 'carrier' {
  return kind === 'transport' || kind === 'carrier';
}
