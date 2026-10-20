import type { ProductionUse } from './types';

/** Canonicalization changes representation only, never the occupied interval. */
export function canonicalProductionUses(uses: readonly ProductionUse[] = []): readonly ProductionUse[] {
  const sorted = uses.map(use => {
    if (!use.buildingId || !['training', 'research'].includes(use.lane)
      || !Number.isFinite(use.fromTicks) || !Number.isFinite(use.throughTicks)
      || use.fromTicks < 0 || use.throughTicks <= use.fromTicks) throw new Error('Invalid production occupancy');
    return { ...use };
  }).sort((a, b) => a.buildingId < b.buildingId ? -1 : a.buildingId > b.buildingId ? 1
    : a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : a.fromTicks - b.fromTicks || a.throughTicks - b.throughTicks);
  const result: ProductionUse[] = [];
  for (const use of sorted) {
    const last = result.at(-1);
    if (last && last.buildingId === use.buildingId && last.lane === use.lane && last.throughTicks >= use.fromTicks)
      result[result.length - 1] = { ...last, throughTicks: Math.max(last.throughTicks, use.throughTicks) };
    else result.push(use);
  }
  return result;
}

export function productionUsesOverlap(a: readonly ProductionUse[], b: readonly ProductionUse[]): boolean {
  return a.some(left => b.some(right => left.buildingId === right.buildingId && left.lane === right.lane
    && left.fromTicks < right.throughTicks && right.fromTicks < left.throughTicks));
}
