import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { shipPartMax, shipMotionLimits } from './ship-handling';
import { shipProfile } from './ship-geometry';

describe('derived ship handling after live changes', () => {
  it('observes damage, repairs, cargo, balance and speed changes immediately', () => {
    const ship = createUnit('ship', 'player', 'warship', 800, 800);
    ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
    ship.shipParts = { ...shipPartMax(ship) };
    const initial = shipMotionLimits(ship);
    ship.shipParts.rudder = 0;
    expect(shipMotionLimits(ship).turnRate).toBe(0);
    ship.shipParts.rudder = shipPartMax(ship).rudder;
    expect(shipMotionLimits(ship)).toEqual(initial);
    ship.shipParts.rigging = 0;
    expect(shipMotionLimits(ship).speed).toBe(0);
    ship.shipParts.rigging = shipPartMax(ship).rigging;
    expect(shipMotionLimits(ship)).toEqual(initial);
    ship.sailing.load = shipProfile(ship)!.loadCapacity;
    const loaded = shipMotionLimits(ship);
    expect(loaded.speed).toBeLessThan(initial.speed);
    expect(loaded.acceleration).toBeLessThan(initial.acceleration);
    expect(loaded.turnRate).toBeLessThan(initial.turnRate);
    ship.sailing.balance = 1;
    expect(shipMotionLimits(ship).turnRate).toBeLessThan(loaded.turnRate);
    ship.speed /= 2;
    expect(shipMotionLimits(ship).speed).toBe(loaded.speed / 2);
    expect(shipMotionLimits(JSON.parse(JSON.stringify(ship)))).toEqual(shipMotionLimits(ship));
  });

  it('refreshes maxima and loaded handling when hull scale or maximum HP changes', () => {
    const ship = createUnit('ship', 'player', 'transport', 800, 800);
    ship.sailing = { heading: 0, speed: 0, load: 200, balance: 0 };
    const parts = shipPartMax(ship), limits = shipMotionLimits(ship);
    ship.maxHp *= 2;
    expect(shipPartMax(ship).cabin).toBe(parts.cabin * 2);
    ship.deckScale = 2;
    expect(shipPartMax(ship).rigging).toBeGreaterThan(parts.rigging);
    expect(shipPartMax(ship).rudder).toBeGreaterThan(parts.rudder);
    expect(shipMotionLimits(ship).speed).toBeGreaterThan(limits.speed);
    expect(shipMotionLimits(JSON.parse(JSON.stringify(ship)))).toEqual(shipMotionLimits(ship));
  });
});
