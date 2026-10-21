import { UNIT_DEFS } from '../../shared/catalog';
import type { Unit } from '../../shared/types';
import type { CatalogUnitValue } from './types';

/** Identity metadata for the already evaluated physical loss, never a second
 * casualty model. Future production references are not entity identities. */
export function casualtyUnitValues(units: readonly Unit[], permanentDeadUnitIds: readonly string[]): CatalogUnitValue[] {
  const actors = new Map(units.map(unit => [unit.id, unit]));
  return [...new Set(permanentDeadUnitIds)].sort().map(unitId => {
    const unit = actors.get(unitId);
    if (!unit || unit.expiresTick !== undefined) throw new Error(`Missing permanent casualty ${unitId}`);
    return { unitId, valueGold: UNIT_DEFS[unit.kind].cost };
  });
}

export function sumUnitValues(groups: readonly (readonly CatalogUnitValue[])[]): CatalogUnitValue[] {
  const values = new Map<string, number>();
  for (const group of groups) for (const { unitId, valueGold } of group) {
    if (!unitId || !Number.isFinite(valueGold) || valueGold < 0) throw new Error('Invalid allocated unit value');
    values.set(unitId, (values.get(unitId) ?? 0) + valueGold);
  }
  return [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([unitId, valueGold]) => ({ unitId, valueGold }));
}
