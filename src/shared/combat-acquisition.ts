import { unitRules } from './catalog';
import { shipProfile } from './ship-geometry';
import type { GameSnapshot, Unit } from './types';

export const AUTO_ACQUIRE_RANGE = 230;
export const NEUTRAL_ALERT_RANGE = 150;
export const NEUTRAL_LEASH_RANGE = 650;
export const NEUTRAL_DAMAGE_RESPONSE_RANGE = NEUTRAL_LEASH_RANGE;
export const NEUTRAL_RETURN_STOP_RANGE = 8;
export const NEUTRAL_ASSIST_RANGE = 360;

/** Native normal acquisition only. Retaliation, spells and continued aim are separate triggers. */
export function unitAutoAcquireRadius(snapshot: Pick<GameSnapshot, 'variants'>, unit: Unit,
  mode: 'idle' | 'hold' | 'attackMove' | 'move' = 'idle', navalFrame = true): number {
  if (mode === 'move') return 0;
  if (mode === 'hold') return unit.attackRange;
  if (mode === 'idle') return unit.kind === 'worker' ? 0
    : unit.owner === 'neutral' ? NEUTRAL_ALERT_RANGE : unit.garrison ? unit.attackRange : AUTO_ACQUIRE_RANGE;
  const profile = navalFrame ? shipProfile(unit) : undefined;
  return profile ? Math.max(unit.attackRange, Math.min(700, Math.max(AUTO_ACQUIRE_RANGE, unit.attackRange + profile.length * .4 + 100)))
    : unitRules(snapshot, unit).weapon ? Math.max(AUTO_ACQUIRE_RANGE, unit.attackRange) : AUTO_ACQUIRE_RANGE;
}
