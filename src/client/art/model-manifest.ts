import { BUILDING_DEFS } from '../../shared/catalog';
import { SHIP_KINDS } from '../../shared/ship-geometry';
import type { BuildingKind } from '../../shared/types';

// A building kind drawn with another's model, on its own footprint: a fortified tower is a defense tower's model laid
// broader (see @@@tower-garrison).
const BUILDING_MODEL_ALIAS: Partial<Record<BuildingKind, BuildingKind>> = { fortifiedTower: 'defenseTower' };
export function buildingModelKind<K extends string>(kind: K): K | BuildingKind {
  return BUILDING_MODEL_ALIAS[kind as BuildingKind] ?? kind;
}

/** Authored constructions are shared by world GLBs, Canvas portraits and exports. */
export const SITE_MODELS = ['citadel', 'shop', 'camp', 'well', 'statue', 'beacon', 'fort-lance', 'fort-flame', 'fort-mortar', 'fort-ward', 'fort-wall'] as const;
/** The capital's own buildings and street furniture (the home scene, see @@@capital-models): authored like the game's
 * buildings, but loaded only by the scene, never by a match. */
export const CAPITAL_MODELS = ['capital-house-slate', 'capital-house-copper', 'capital-house-shop', 'capital-tavern', 'capital-stall-produce',
  'capital-stall-cloth', 'capital-lamp', 'capital-table', 'capital-bench', 'capital-planter', 'capital-barrels', 'capital-crates', 'capital-sacks'] as const;
export type SiteModelKind = typeof SITE_MODELS[number] | typeof CAPITAL_MODELS[number];
/** Story props a scene stands as 3D models rather than paints on the ground. */
export const SCENE_MODELS: ReadonlySet<string> = new Set(['statue', 'well', 'beacon', 'citadel', ...CAPITAL_MODELS]);
export const MATCH_MODEL_KEYS: readonly string[] = [
  ...SHIP_KINDS.map(kind => `ships/${kind}`),
  ...new Set([...Object.keys(BUILDING_DEFS).map(buildingModelKind), ...SITE_MODELS]).values(),
].map(kind => kind.startsWith('ships/') ? kind : `buildings/${kind}`);
