import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { groundRegionIndex, warmTerrainRouting } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { regionIndex, unitLocation } from './regions';

const frames = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases as { event: string; snapshot: GameSnapshot }[];
describe('tick independent location facts', () => {
  it('prepares complete static geography before think without changing the cold index facts', () => {
    for (const { snapshot: original } of frames) {
      const cold = structuredClone(original), hot = structuredClone(original);
      expect(groundRegionIndex(hot.map, 0).scannedRows).toBe(0);
      const before = JSON.stringify(hot);
      warmTerrainRouting(hot.map, standingBodies(hot));
      expect(JSON.stringify(hot)).toBe(before);
      const warmed = groundRegionIndex(hot.map, 0);
      expect(warmed.scannedRows).toBe(hot.map.terrain!.rows);
      const plain = regionIndex(cold.map);
      const facts = (index: typeof plain) => ({ lands: [...index.lands], seas: [...index.seas],
        shores: index.shores, shoresByLand: [...index.shoresByLand].map(([land, seas]) => [land, [...seas]]),
        rows: index.scannedRows });
      expect(JSON.stringify(facts(warmed))).toBe(JSON.stringify(facts(plain)));
    }
  });
  it('reuses only identical physical facts and preserves an earlier projection after movement', () => {
    const snapshot = structuredClone(frames.find(frame => frame.event === 'E05')!.snapshot);
    const unit = snapshot.units.find(unit => unit.owner !== 'neutral' && !unit.deck && !unit.cabin)!;
    const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
    const first = unitLocation(snapshot.map, unit, units, snapshot.tick), bytes = JSON.stringify(first);
    expect(unitLocation({ ...snapshot.map }, { ...unit }, units, snapshot.tick + 15)).toBe(first);
    const moved = { ...unit, x: unit.x + 64 };
    expect(unitLocation(snapshot.map, moved, units, snapshot.tick + 30)).not.toBe(first);
    expect(JSON.stringify(first)).toBe(bytes);
    expect(unitLocation(structuredClone(snapshot.map), unit, units, snapshot.tick + 45)).toEqual(first);
  });
  it('does not reuse a passenger location when its supporting ship disappears', () => {
    const snapshot = structuredClone(frames.find(frame => frame.event === 'Nd')!.snapshot);
    const unit = snapshot.units.find(unit => unit.deck || unit.cabin)!;
    const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
    const first = unitLocation(snapshot.map, unit, units, snapshot.tick);
    expect(first.kind).toBe('aboard'); units.delete(unit.deck?.shipId ?? unit.cabin!.shipId);
    const absent = unitLocation(snapshot.map, unit, units, snapshot.tick + 15);
    expect(absent.kind).toBe('unknown');
    expect(unitLocation(snapshot.map, unit, units, snapshot.tick + 30)).not.toEqual(absent);
  });
});
