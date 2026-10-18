import { expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { CAPITAL_MODELS, MATCH_MODEL_KEYS, SITE_MODELS } from './model-manifest';
import { buildingGeometry } from './building-models';
import { BUILDING_DEFS } from '../../shared/catalog';
import { SHIP_WEAPONS } from '../../shared/ship-equipment';
import type { BuildingKind } from '../../shared/types';

it('accounts for every authored GLB with no missing or orphaned assets', () => {
  const disk = ['ships', 'buildings'].flatMap(domain => readdirSync(`public/art/world3d/${domain}`).filter(name => name.endsWith('.glb')).map(name => `${domain}/${name.slice(0, -4)}`));
  // The capital's models are on disk for the home scene only, never loaded by a match (see @@@capital-models).
  const capital = CAPITAL_MODELS.map(kind => `buildings/${kind}`);
  expect([...MATCH_MODEL_KEYS, ...capital].sort()).toEqual(disk.sort());
  for (const key of capital) expect(MATCH_MODEL_KEYS).not.toContain(key);
  expect(new Set(MATCH_MODEL_KEYS).size).toBe(MATCH_MODEL_KEYS.length);
  for (const weapon of Object.values(SHIP_WEAPONS)) expect(MATCH_MODEL_KEYS).toContain(`ships/${weapon.art}`);
});

it('every production building and neutral site has authored portrait geometry', () => {
  for (const kind of [...Object.keys(BUILDING_DEFS) as BuildingKind[], ...SITE_MODELS, ...CAPITAL_MODELS]) {
    const geometry = buildingGeometry(kind);
    expect(geometry.length, kind).toBeGreaterThan(0);
    for (const face of geometry) for (const point of face.p) for (const coordinate of point) expect(Number.isFinite(coordinate), kind).toBe(true);
  }
});
