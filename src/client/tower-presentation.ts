import { TOWER_TOP_Z } from "./art/building-models";
import type { Building, Unit } from "../shared/types";

// How a fortified tower and the troops on its top are drawn (see @@@tower-garrison, @@@tower-top): the tower's picture
// is sized by its own body, so a fortified one stands broader and taller, and its troops stand on its platform.

/** A building's picture, by its body: a fortified tower's is broader than a plain one's. */
export function buildingSpriteSize(building: Pick<Building, "radius">) {
  return Math.round(building.radius * 2.12);
}

/** Its roof is drawn see-through while troops stand under it. */
export function towerRoofOpen(units: readonly Unit[], building: Building) {
  return !!building.fortified && units.some(unit => unit.hp > 0 && unit.garrison?.buildingId === building.id);
}

/** The tower a troop stands on, if it stands on one. */
export function garrisonTower(buildings: readonly Building[], unit: Pick<Unit, "garrison">) {
  const id = unit.garrison?.buildingId;
  return id === undefined ? undefined : buildings.find(building => building.id === id);
}

/** How far above its feet on the ground a troop on a tower's top is drawn, in the flat (Canvas) world's units: the
 * platform's height in the tower's picture (see drawAtlasBuilding, a picture `size` across draws a model unit as size/64). */
export function towerTopLift(buildings: readonly Building[], unit: Pick<Unit, "garrison">) {
  const tower = garrisonTower(buildings, unit);
  return tower ? TOWER_TOP_Z * buildingSpriteSize(tower) / 64 : 0;
}
