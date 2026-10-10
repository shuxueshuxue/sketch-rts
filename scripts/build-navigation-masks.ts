import { writeFileSync } from 'node:fs';
import { buildNavigationMasks } from '../src/shared/navigation-masks';
import { SHIP_KINDS, shipProfile } from '../src/shared/ship-geometry';
import type { Unit } from '../src/shared/types';
for(const cell of [32,64]){
  const masks = Object.fromEntries(SHIP_KINDS.map(kind => [kind, buildNavigationMasks(shipProfile({ kind } as Unit)!.hull, cell)]));
  const suffix=cell===32?'':`-${cell}`;
  writeFileSync(`src/shared/generated/ship-navigation-masks${suffix}.json`, JSON.stringify(masks) + '\n');
}
