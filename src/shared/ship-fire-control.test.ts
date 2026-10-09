import { describe, expect, it } from 'vitest';
import { strikePoint, type StrikeTarget } from './combat-geometry';
import { createUnit } from './map';
import { SHIP_WEAPONS, bestFiringHeading, mountedTargetPoint, mountedWeaponPose, shipGunCanAim, shipMounts } from './ship-equipment';
import { headingDifference } from './ship-navigation';
import { ballisticTarget } from './ship-fire-control';
import { perTick, seconds, SIM_TICKS_PER_SECOND } from './time';
import type { ShipEquipmentKind, Unit, UnitKind, WorldItem } from './types';
import { veteranWeaponRange } from './veteran-stats';
import { boltIntersection } from './weapons';

function battery(kind: UnitKind = 'bombardShip', weapon: ShipEquipmentKind = 'shipMortar', mountId = 'bow') {
  const ship = createUnit('gunship', 'player', kind, 1000, 1000);
  ship.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
  const item: WorldItem = { id: 'gun', kind: weapon, x: ship.x, y: ship.y, shipId: ship.id, mountId, durability: SHIP_WEAPONS[weapon].hp, cooldownRemaining: 0 };
  return { ship, item, items: [item] };
}

function canFire(ship: Unit, item: WorldItem, target: StrikeTarget, heading: number, margin = 0) {
  const posed = { ...ship, sailing: { ...ship.sailing!, heading } };
  const pose = mountedWeaponPose(posed, item)!, mount = shipMounts(posed).find(mount => mount.id === item.mountId)!;
  const def = SHIP_WEAPONS[item.kind as ShipEquipmentKind], point = strikePoint(pose.pivot, target);
  const gap = Math.hypot(point.x - pose.pivot.x, point.y - pose.pivot.y);
  return shipGunCanAim(posed, item, target)
    && gap >= (def.weapon.minRange ?? 0) && gap <= veteranWeaponRange(ship, def.range)
    && Math.abs(headingDifference(heading + mount.bearing, Math.atan2(point.y - pose.pivot.y, point.x - pose.pivot.x))) <= mount.halfArc - margin + 1e-7;
}

describe('mounted firing headings', () => {
  it('leads a receding hull for the actual finite flight instead of ending at its old stern', () => {
    const target = createUnit('target', 'enemy', 'transport', 400, 0);
    target.sailing = { heading: 0, speed: 60, load: 0, balance: 0, velocityX: 60, velocityY: 0 };
    const pivot = { x: 0, y: 0 }, weapon = SHIP_WEAPONS.shipCannon.weapon, reach = 26;
    const predicted = ballisticTarget(pivot, target, { x: 60, y: 0 }, weapon, reach);
    const point = strikePoint(pivot, predicted), muzzle = { x: reach, y: 0 };
    const ticks = Math.max(seconds(.2), Math.ceil((point.x - muzzle.x) / perTick(560)));
    const atImpact = { ...target, x: target.x + 60 * (ticks - 1) / SIM_TICKS_PER_SECOND };
    expect(boltIntersection(muzzle, point, atImpact, weapon.radius!)).toBeDefined();
    expect(boltIntersection(muzzle, strikePoint(pivot, target), atImpact, weapon.radius!)).toBeUndefined();
    expect(point.x).toBeCloseTo(strikePoint(pivot, atImpact).x, 8);
  });

  it('brings the predicted crossing target into the mortar arc rather than only its current position', () => {
    const { ship, item, items } = battery();
    const target = createUnit('target', 'enemy', 'transport', 1500, 1220);
    target.sailing = { heading: Math.PI / 2, speed: 45, load: 0, balance: 0, velocityX: 0, velocityY: 45 };
    ship.sailing!.heading = 0;
    const snapshot = { items, units: [ship, target] };
    const heading = bestFiringHeading(snapshot, ship, target, Math.PI / 36);
    const posed = { ...ship, sailing: { ...ship.sailing!, heading } };
    const point = mountedTargetPoint(snapshot, posed, item, target), pose = mountedWeaponPose(posed, item)!;
    expect(shipGunCanAim(posed, item, point)).toBe(true);
    expect(Math.hypot(point.x - pose.pivot.x, point.y - pose.pivot.y)).toBeLessThanOrEqual(SHIP_WEAPONS.shipMortar.range);
    expect(heading).toBeGreaterThan(bestFiringHeading({ items }, ship, { ...target, sailing: { ...target.sailing!, velocityX: 0, velocityY: 0 } }, Math.PI / 36));
  });

  it('finds the narrow mortar angle between minimum range and the bow traverse limit', () => {
    const { ship, item, items } = battery(), target = { x: 1209.5, y: 1000 };
    const heading = bestFiringHeading({ items }, ship, target);
    expect(canFire(ship, item, target, heading)).toBe(true);
    expect(heading).toBeGreaterThan(24 * Math.PI / 180);
    expect(heading).toBeLessThan(26 * Math.PI / 180);
    expect(canFire(ship, item, target, 0)).toBe(false);
  });

  it('aims at a crew member’s center without treating its body radius as a hull surface', () => {
    const { ship, item, items } = battery();
    const crew = createUnit('crew', 'enemy', 'footman', 1209.5, 1000);
    crew.deck = { shipId: 'carrier', x: 24, y: 12 };
    const heading = bestFiringHeading({ items }, ship, crew);
    expect(canFire(ship, item, crew, heading)).toBe(true);
    expect(heading).toBe(bestFiringHeading({ items }, ship, { x: crew.x, y: crew.y }));
  });

  it('uses a circular building’s reachable surface when its center exceeds cannon range', () => {
    const { ship, item, items } = battery('warship', 'shipCannon');
    const wall = { x: 1400, y: 1020, radius: 75 };
    const heading = bestFiringHeading({ items }, ship, wall);
    expect(canFire(ship, item, wall, heading)).toBe(true);
    expect(canFire(ship, item, { x: wall.x, y: wall.y }, heading)).toBe(false);
  });

  it('preserves a working heading and offers an interior traverse margin for a moving target', () => {
    const { ship, item, items } = battery('warship', 'shipCannon'), target = { x: 1250, y: 1000 };
    ship.sailing!.heading = bestFiringHeading({ items }, ship, target);
    expect(bestFiringHeading({ items }, ship, target)).toBe(ship.sailing!.heading);
    const margin = 5 * Math.PI / 180, heading = bestFiringHeading({ items }, ship, target, margin);
    expect(canFire(ship, item, target, heading, margin)).toBe(true);
    expect(Math.abs(headingDifference(ship.sailing!.heading, heading))).toBeGreaterThan(.05);
  });

  it('keeps its heading when every angle is inside the mortar dead zone or beyond maximum range', () => {
    const { ship, items } = battery();
    for (const distance of [100, 800]) expect(bestFiringHeading({ items }, ship, { x: ship.x + distance, y: ship.y })).toBe(ship.sailing!.heading);
  });

  it('chooses a side of range boundaries accepted by the actual strict shot checks', () => {
    for (const initial of [-.2, 0, .2]) for (const distance of [209.5, 210, 210.75, 212]) {
      const { ship, item, items } = battery(), target = { x: ship.x + distance, y: ship.y };
      ship.sailing!.heading = initial;
      expect(canFire(ship, item, target, bestFiringHeading({ items }, ship, target))).toBe(true);
    }
    const { ship, item, items } = battery('warship', 'shipCannon'), bow = shipMounts(ship).find(mount => mount.id === 'bow')!;
    const target = { x: ship.x + bow.x + SHIP_WEAPONS.shipCannon.range - .1, y: ship.y };
    expect(canFire(ship, item, target, bestFiringHeading({ items }, ship, target))).toBe(true);
  });

  it('finds every firing interval seen by an independent dense angular sweep', () => {
    const step = Math.PI / 360;
    let reachable = 0, unreachable = 0;
    for (const [kind, weapon, mount] of [
      ['bombardShip', 'shipMortar', 'bow'], ['warship', 'shipCannon', 'port0'], ['fireShip', 'flameProjector', 'bow'],
    ] as const) for (const shape of ['point', 'circle', 'hull'] as const) for (const distance of [120, 209.5, 270, 420, 640]) for (const bearing of [-.8, .35, 2.4]) {
      const { ship, item, items } = battery(kind, weapon, mount);
      const center = { x: ship.x + distance * Math.cos(bearing), y: ship.y + distance * Math.sin(bearing) };
      const target: StrikeTarget = shape === 'hull' ? createUnit('target', 'enemy', 'carrier', center.x, center.y)
        : shape === 'circle' ? { ...center, radius: 66 } : center;
      if ('order' in target) target.sailing = { heading: .73, speed: 0, load: 0, balance: 0 };
      ship.sailing!.heading = -1.7;
      let nearest = Infinity;
      for (let angle = -Math.PI; angle < Math.PI; angle += step) {
        if (canFire(ship, item, target, angle)) nearest = Math.min(nearest, Math.abs(headingDifference(ship.sailing!.heading, angle)));
      }
      const heading = bestFiringHeading({ items }, ship, target);
      const detail = `${weapon}/${mount} ${shape} distance=${distance} bearing=${bearing}`;
      if (nearest < Infinity) {
        reachable++;
        expect(canFire(ship, item, target, heading), detail).toBe(true);
        expect(Math.abs(headingDifference(ship.sailing!.heading, heading)), detail).toBeLessThanOrEqual(nearest + 1e-6);
      } else {
        unreachable++;
        // An analytic solution can still find an interval narrower than the sweep.
        if (heading !== ship.sailing!.heading) expect(canFire(ship, item, target, heading), detail).toBe(true);
      }
    }
    expect(reachable).toBeGreaterThan(50);
    expect(unreachable).toBeGreaterThan(20);
  });
});
