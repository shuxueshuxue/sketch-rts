import type { CatalogUnitValue } from './types';

/** An evacuation benefit already values survival of that person. Do not also
 * subtract the same person's catalogued sinking/death loss. Battle cohorts
 * whose benefit is mine income have no such preserved-person benefit. */
export function assertUnitValueSides(utility: Readonly<{
  benefit: readonly Readonly<{ catalogUnitValues?: readonly CatalogUnitValue[] }>[];
  cost: readonly Readonly<{ catalogUnitValues?: readonly CatalogUnitValue[] }>[];
}>): void {
  const benefits = new Set<string>();
  for (const side of ['benefit', 'cost'] as const) for (const term of utility[side]) for (const item of term.catalogUnitValues ?? []) {
    if (!item.unitId || !Number.isFinite(item.valueGold) || item.valueGold < 0) throw new Error('Invalid catalogued unit value');
    if (!item.valueGold) continue;
    if (side === 'benefit') benefits.add(item.unitId);
    else if (benefits.has(item.unitId)) throw new Error(`Unit catalog value occurs in both benefit and loss: ${item.unitId}`);
  }
}
