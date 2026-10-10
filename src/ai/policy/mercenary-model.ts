import { MERCENARY_HIRE_RANGE } from '../../shared/catalog';
import type { GameSnapshot, MercenaryCamp, MercenaryUnitKind, PlayerId } from '../../shared/types';
import { units } from './snapshot';
import { distance } from './spatial';
import type { PresetAiPolicyOptions } from './types';
import { isTowerMercPolicy } from './versions';

export function hiredMercenaryCount(snapshot: GameSnapshot, owner: PlayerId, kind: MercenaryUnitKind) {
  return units(snapshot, owner).filter(unit => unit.kind === kind).length;
}

export function friendlyUnitsAtMercenaryCamp(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp) {
  return units(snapshot, owner).filter(unit => distance(unit, camp) <= camp.radius + unit.radius + MERCENARY_HIRE_RANGE);
}

export function mercenaryRoleLimit(kind: MercenaryUnitKind, options: PresetAiPolicyOptions) {
  if (isTowerMercPolicy(options)) {
    if (kind === 'fieldMedic') return 3;
    if (kind === 'contractArcher') return 7;
    return 7;
  }
  if (kind === 'fieldMedic') return 2;
  if (kind === 'contractArcher') return 3;
  return 2;
}
