import { MERCENARY_HIRE_RANGE } from './catalog';
import { hypot2 } from './hypot';
import type { MercenaryCamp, Unit } from './types';

/** Camp control is a physical range, rather than a walking distance. */
export function unitControlsMercenaryCamp(unit: Pick<Unit, 'x' | 'y' | 'radius'>, camp: Pick<MercenaryCamp, 'x' | 'y' | 'radius'>) {
  return hypot2(unit.x - camp.x, unit.y - camp.y) <= camp.radius + unit.radius + MERCENARY_HIRE_RANGE;
}
