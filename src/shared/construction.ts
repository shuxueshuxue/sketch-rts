import { footprintHalf } from './terrain';
import { TERRAIN_CELL } from './generated-map';
import type { Building, GameSnapshot, Unit } from './types';

export const BUILDING_WORK_REACH = TERRAIN_CELL;

export function buildingWorkGap(unit: Unit, building: Building) {
  const half = footprintHalf(building.radius, TERRAIN_CELL);
  return Math.hypot(Math.max(0, Math.abs(unit.x - building.x) - half), Math.max(0, Math.abs(unit.y - building.y) - half));
}

/** Construction advances only through assigned workers already beside this site's walls. */
export function constructionWorkers(snapshot: Pick<GameSnapshot, 'units'>, building: Building) {
  return snapshot.units.filter(unit => unit.order.type === 'repair' && unit.order.buildingId === building.id
    && buildingWorkGap(unit, building) <= BUILDING_WORK_REACH);
}
