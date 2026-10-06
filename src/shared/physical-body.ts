import { UNIT_DEFS } from "./catalog";
import { shipProfile } from "./ship-geometry";
import type { Unit } from "./types";

// Kilograms, independent of price, population and experience. Radius remains
// the ground contact footprint used by land movement and deck packing.
const MASSES: Partial<Record<Unit["kind"],number>> = {
  worker:75, footman:105, archer:85, sparkArcher:85, contractArcher:90,
  knight:680, lancer:120, raider:600, horseArcher:560,
  siegeRam:2200, ballista:1100, catapult:1200, organGun:1600,
  golem:2600, ashChieftain:180, cinderRevenant:220,
  rubbleGolem:1100, rockGolem:2800, graniteGolem:6500,
  ogreWarrior:320, ogreMage:300, ogreLord:550, ancientStag:500,
  dragonWhelp:350, redDragon:3500,
};
export function bodyMass(unit: Unit): number {
  const ship=shipProfile(unit);
  return ship ? ship.hullMass+(unit.sailing?.load ?? 0) : Math.round((MASSES[unit.kind] ?? 85*(UNIT_DEFS[unit.kind].radius/UNIT_DEFS.archer.radius)**3)*(unit.radius/UNIT_DEFS[unit.kind].radius)**3);
}
