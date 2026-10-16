import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { workingWeaponGeometry } from '../../shared/combat-fire-geometry';
import { shoreFiringStation } from '../../shared/shore-fire';
import { setBuildingBodies, walkingDistance } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { coastalFireDisks, coastalFireSegmentClear } from '../policy/coastal-voyage';
import { outmatchingCoast } from '../policy/coastal-risk';
import { coastalBombardment } from '../policy/coastal-bombardment';
import { coastalVoyagePrefixSafe } from '../policy/coastal-voyage';
import type { AiPolicyMemory } from '../memory';

function actual() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-idle-7d-267000.json.gz', import.meta.url))).toString()) as {
    snapshot: GameSnapshot; nextId: number; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = saved.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const ship = snapshot.units.find(unit => unit.id === 'unit-p0-warship-34722')!;
  const target = snapshot.buildings.find(building => building.id === 'building-p1-shipyard-1028')!;
  const options = { memory: saved.memories.p0!, teams: snapshot.teams! };
  const disks = coastalFireDisks(snapshot, ship, options);
  return { saved, snapshot, ship, target, options, disks };
}

describe('actual surviving battery after the 7d overseas assault', () => {
  it('continues the existing search when its first firing pose is inside observed tower fire', () => {
    const f = actual(), before = structuredClone(f.saved);
    const first = shoreFiringStation(f.snapshot, f.ship, f.target)!;
    expect(coastalFireSegmentClear(first, first, f.disks)).toBe(false);
    const station = shoreFiringStation(f.snapshot, f.ship, f.target, pose =>
      coastalFireSegmentClear(pose, pose, f.disks) && !outmatchingCoast(f.snapshot, 'p0', f.ship, pose, f.options).length);
    expect(station).toBeDefined();
    expect(station).not.toEqual(first);
    expect(coastalFireSegmentClear(station!, station!, f.disks)).toBe(true);
    expect(walkingDistance(f.snapshot.map, f.ship, station!, 'sea')).toBeDefined();
    const posed = { ...f.ship, x: station!.x, y: station!.y, sailing: { ...f.ship.sailing!, heading: station!.heading } };
    expect(workingWeaponGeometry(f.snapshot, posed, f.target).some(weapon => weapon.covers)).toBe(true);
    expect(f.saved).toEqual(before);
  });

  it('does not let a cached geometric success override a current rejection', () => {
    const f = actual();
    expect(shoreFiringStation(f.snapshot, f.ship, f.target)).toBeDefined();
    expect(shoreFiringStation(f.snapshot, f.ship, f.target, () => false)).toBeUndefined();
  });

  it('does not cache a rejected policy result or replace the ordinary geometric result', () => {
    const f = actual();
    const ordinary = shoreFiringStation(f.snapshot, f.ship, f.target);
    expect(shoreFiringStation(f.snapshot, f.ship, f.target, () => false)).toBeUndefined();
    expect(shoreFiringStation(f.snapshot, f.ship, f.target, () => true)).toEqual(ordinary);
    expect(shoreFiringStation(f.snapshot, f.ship, f.target)).toEqual(ordinary);
  });

  it('publishes a safe native departure to the actual enemy shipyard without claiming arrival', () => {
    const f = actual(), before = structuredClone(f.saved);
    const targets = f.snapshot.buildings.filter(building => building.owner === 'p1' || building.owner === 'p2');
    const plan = coastalBombardment(f.snapshot, f.ship, targets, f.options)!;
    expect(plan.target.id).toBe(f.target.id);
    expect(plan.voyage?.proof).toBe('prefix');
    if (plan.voyage?.proof !== 'prefix') throw Error('expected the observed finite departure');
    expect(plan.voyage.legs).toEqual([]);
    expect(plan.voyage.prefix.length).toBeGreaterThan(0);
    expect(coastalVoyagePrefixSafe(f.snapshot, f.ship, { points: plan.voyage.prefix, partial: true }, f.options)).toBe(true);
    expect(f.saved).toEqual(before);
  });
});
