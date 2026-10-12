import { BUILDING_DEFS } from '../../shared/catalog';
import { SHIP_KINDS } from '../../shared/ship-geometry';

/** Authored constructions are shared by world GLBs, Canvas portraits and exports. */
export const SITE_MODELS = ['citadel', 'shop', 'camp', 'well', 'statue', 'beacon', 'fort-lance', 'fort-flame', 'fort-mortar', 'fort-ward', 'fort-wall'] as const;
export type SiteModelKind = typeof SITE_MODELS[number];
export const MATCH_MODEL_KEYS: readonly string[] = [
  ...SHIP_KINDS.map(kind => `ships/${kind}`),
  ...new Set([...Object.keys(BUILDING_DEFS), ...SITE_MODELS]).values(),
].map(kind => kind.startsWith('ships/') ? kind : `buildings/${kind}`);
