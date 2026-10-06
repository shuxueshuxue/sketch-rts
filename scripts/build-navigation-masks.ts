import { writeFileSync } from 'node:fs';
import { buildNavigationMasks } from '../src/shared/navigation-masks';
import { SHIP_KINDS, shipProfile } from '../src/shared/ship-geometry';
import type { Unit } from '../src/shared/types';
const masks = Object.fromEntries(SHIP_KINDS.map(kind => [kind, buildNavigationMasks(shipProfile({ kind } as Unit)!.hull, 32)]));
writeFileSync('src/shared/generated/ship-navigation-masks.json', JSON.stringify(masks) + '\n');
