import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { miningApproachOutsideFire, miningBuildingFire } from './mining-fire';

function actual() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/mining-building-fire-12000.json.gz', import.meta.url))).toString());
  const snapshot: GameSnapshot = saved.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  return { snapshot, worker: snapshot.units.find(unit => unit.id === 'unit-p0-worker-1019')!,
    mine: snapshot.resources.find(mine => mine.id === 'gold-gen-5')!, options: snapshot.teams ? { teams: snapshot.teams } : {} };
}

it('uses the real working towers and full native range-entry road', () => {
  const { snapshot, worker, mine, options } = actual();
  expect(miningApproachOutsideFire(snapshot, 'p0', worker, mine, options)).toBe(false);
});

it.each(['unfinished', 'dead', 'unarmed', 'outside-range', 'allied'] as const)('keeps normal mining when the observed towers are %s', condition => {
  const { snapshot, worker, mine, options } = actual();
  // Explicit counterfactual weapon-admission boundaries, not new match wins.
  for (const tower of snapshot.buildings.filter(building => ['building-p2-defenseTower-5114', 'building-p2-defenseTower-5405'].includes(building.id))) {
    if (condition === 'unfinished') tower.complete = false;
    if (condition === 'dead') tower.hp = 0;
    if (condition === 'unarmed') tower.attackDamage = 0;
    if (condition === 'outside-range') tower.attackRange = 1;
    if (condition === 'allied') tower.owner = 'p0';
  }
  expect(miningApproachOutsideFire(snapshot, 'p0', worker, mine, options)).toBe(true);
});

it('does not mistake an ordinary firing cooldown for a permanently disabled tower', () => {
  const { snapshot, worker, mine, options } = actual();
  for (const tower of snapshot.buildings.filter(building => building.kind === 'defenseTower')) tower.cooldown = tower.attackCooldown;
  expect(miningBuildingFire(snapshot, 'p0', options).some(fire => fire.x === 1376 && fire.y === 864)).toBe(true);
  expect(miningApproachOutsideFire(snapshot, 'p0', worker, mine, options)).toBe(false);
});
