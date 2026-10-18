import type { UnitKind } from './types';

// Import boundaries share these names: old saves and sound packs must resolve
// to the same current unit kind. Keep every target in the current catalog.
export const UNIT_NAMES: Readonly<Record<string, UnitKind>> = { pyreCaller: 'summoner', emberAcolyte: 'priest' };
