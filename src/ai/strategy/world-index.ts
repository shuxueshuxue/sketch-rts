import type { GameSnapshot, Unit } from '../../shared/types';
import { frameMemo } from './frame-reuse';

type UnitIndex = Readonly<{
  all: ReadonlyMap<string, Unit>;
  live: ReadonlyMap<string, Unit>;
  liveUnits: readonly Unit[];
}>;
const indexDomain = Symbol('strategy-frame-unit-index');

/** Share the current frame's raw lookup, not a history of unit snapshots. The
 * checks also admit callers that edit a snapshot or its unit array in place. */
export function snapshotUnitIndex(snapshot: GameSnapshot): UnitIndex {
  const slot = frameMemo(indexDomain, snapshot, () => ({ index: undefined as UnitIndex | undefined }));
  const known = slot.index;
  if (known && known.all.size === snapshot.units.length) {
    let liveCount = 0, valid = true;
    for (const unit of snapshot.units) {
      if (known.all.get(unit.id) !== unit || (unit.hp > 0) !== known.live.has(unit.id)) { valid = false; break; }
      if (unit.hp > 0 && known.liveUnits[liveCount++] !== unit) { valid = false; break; }
    }
    if (valid && liveCount === known.liveUnits.length) return known;
  }
  const all = new Map<string, Unit>();
  let dead = false;
  for (const unit of snapshot.units) { all.set(unit.id, unit); if (!(unit.hp > 0)) dead = true; }
  let live: ReadonlyMap<string, Unit> = all, liveUnits: readonly Unit[] = snapshot.units;
  if (dead) {
    const units: Unit[] = [], values = new Map<string, Unit>();
    for (const unit of snapshot.units) if (unit.hp > 0) { units.push(unit); values.set(unit.id, unit); }
    live = values; liveUnits = units;
  }
  const value = { all, live, liveUnits }; slot.index = value; return value;
}
