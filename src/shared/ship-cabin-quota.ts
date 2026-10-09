import { UNIT_DEFS, unitRules } from './catalog';
import { bodyMass } from './physical-body';
import { AUTHORED_DEFAULT_SHIP_SCALE, authoredShipScale, shipPassengers } from './ship-geometry';
import type { GameSnapshot, Unit } from './types';

type QuotaSnapshot = Pick<GameSnapshot, 'units'> & Partial<Pick<GameSnapshot, 'variants'>>;
const CAPACITY: Partial<Record<Unit['kind'], number>> = { transport: 11, carrier: 21, warship: 5, bombardShip: 4, fireShip: 3, shipOfTheLine: 8 };

/** Compartment space is a budget, not a head count. Campaign hulls gain room
 * with their authored floor area. These rounded bases reserve two thirds of
 * the enlarged hull's original shelter budget; the exposed deck carries more. */
export function shipCabinCapacity(ship: Unit): number {
  const capacity = CAPACITY[ship.kind] ?? 0;
  return capacity ? Math.max(1, Math.floor(capacity * (authoredShipScale(ship) / AUTHORED_DEFAULT_SHIP_SCALE) ** 2 + 1e-7)) : 0;
}

/** Population, physical mass and body volume each put a lower bound on room.
 * Zero-population workers, heroes and neutral variants still consume space;
 * equipment already remains part of the ship's separate payload mass. */
export function cabinSpaceRequired(snapshot: Partial<Pick<GameSnapshot, 'variants'>>, unit: Unit): number {
  const population = unitRules(snapshot, unit).supplyUsed;
  const radius = unit.bodyRadius ?? unit.radius;
  const mass = bodyMass({ ...unit, gearMass: 0 });
  return Math.max(1, Math.ceil(population), Math.ceil(mass / 105 - 1e-7), Math.ceil((radius / UNIT_DEFS.footman.radius) ** 3 - 1e-7));
}

export function shipCabinUsage(snapshot: QuotaSnapshot, ship: Unit) {
  const capacity = shipCabinCapacity(ship);
  const used = shipPassengers(snapshot.units, ship).filter(unit => unit.hp > 0 && unit.cabin?.shipId === ship.id)
    .reduce((sum, unit) => sum + cabinSpaceRequired(snapshot, unit), 0);
  return { capacity, used, free: Math.max(0, capacity - used), overCapacity: Math.max(0, used - capacity) };
}
