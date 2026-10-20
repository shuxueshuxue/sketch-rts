import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { snapshotUnitIndex } from './world-index';
import { withStrategyFrame } from './frame-reuse';

const frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString())
  .cases[0].snapshot as GameSnapshot;
describe('shared current-frame entity index', () => {
  it('invalidates deaths, revival, replacement, IDs and ordering edited in place', () => withStrategyFrame(() => {
    const snapshot = structuredClone(frame), first = snapshotUnitIndex(snapshot);
    expect(snapshotUnitIndex(snapshot)).toBe(first);
    const unit = snapshot.units[0]!;
    unit.hp = 0;
    const dead = snapshotUnitIndex(snapshot);
    expect(dead.all.get(unit.id)).toBe(unit); expect(dead.live.has(unit.id)).toBe(false);
    snapshot.units.reverse();
    expect(snapshotUnitIndex(snapshot).liveUnits.map(unit => unit.id)).toEqual(snapshot.units.filter(unit => unit.hp > 0).map(unit => unit.id));
    unit.hp = unit.maxHp;
    expect(snapshotUnitIndex(snapshot).live.get(unit.id)).toBe(unit);
    const originalId = unit.id; unit.id += '-renamed';
    expect(snapshotUnitIndex(snapshot).all.has(originalId)).toBe(false);
    const replacement = { ...snapshot.units[0]! }; snapshot.units[0] = replacement;
    expect(snapshotUnitIndex(snapshot).all.get(replacement.id)).toBe(replacement);
    expect(first.all.get(originalId)).toBe(unit);
  }));
  it('ends raw snapshot index retention when an assessment returns or throws', () => {
    const snapshot = structuredClone(frame);
    const first = withStrategyFrame(() => snapshotUnitIndex(snapshot));
    expect(withStrategyFrame(() => snapshotUnitIndex(snapshot))).not.toBe(first);
    expect(() => withStrategyFrame(() => { snapshotUnitIndex(snapshot); throw new Error('interrupted'); })).toThrow('interrupted');
    const next = snapshotUnitIndex(snapshot);
    expect(snapshotUnitIndex(snapshot)).not.toBe(next);
    expect(next.liveUnits).toEqual(first.liveUnits);
  });
});
