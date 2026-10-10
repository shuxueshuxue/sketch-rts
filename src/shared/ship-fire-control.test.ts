import { describe, expect, it } from 'vitest';
import { strikePoint, type StrikeTarget } from './combat-geometry';
import { createUnit } from './map';
import { SHIP_WEAPONS, bestFiringHeading, mountedFireLaneClear, mountedTargetPoint, mountedWeaponPose, shipGunCanAim, shipMounts } from './ship-equipment';
import { headingDifference } from './ship-navigation';
import { ballisticTarget, shipFireLaneClear } from './ship-fire-control';
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

/** At this distance the mortar's minimum-range circle meets its bow traverse boundary. */
function mortarBoundaryDistance(ship: Unit, item: WorldItem) {
  const mount = shipMounts(ship).find(mount => mount.id === item.mountId)!;
  const minimum = SHIP_WEAPONS.shipMortar.weapon.minRange!;
  return Math.hypot(mount.x + minimum * Math.cos(mount.halfArc), mount.y - minimum * Math.sin(mount.halfArc));
}

describe('mounted firing headings', () => {
  it('clips direct firing lanes to live rotated friendly hulls, rather than their center circles', () => {
    const blocker=createUnit('ally','player','transport',300,100);
    blocker.sailing={heading:0,speed:0,load:0,balance:0};
    const from={x:0,y:0},to={x:600,y:0};
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.shipCannon.weapon,[blocker])).toBe(true);
    blocker.sailing.heading=Math.PI/2;
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.shipCannon.weapon,[blocker])).toBe(false);
    blocker.hp=0;
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.shipCannon.weapon,[blocker])).toBe(true);
    blocker.hp=blocker.maxHp;blocker.y=0;blocker.x=800;
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.shipCannon.weapon,[blocker])).toBe(true);
  });

  it('keeps high mortar shells clear of friendly ships while gating low flames and cannonballs', () => {
    const blocker=createUnit('ally','player','carrier',300,0);
    blocker.sailing={heading:0,speed:0,load:0,balance:0};
    const from={x:0,y:0},to={x:600,y:0};
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.shipCannon.weapon,[blocker])).toBe(false);
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.flameProjector.weapon,[blocker])).toBe(false);
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.shipMortar.weapon,[blocker])).toBe(true);
    expect(shipFireLaneClear(from,to,SHIP_WEAPONS.shipCannon.weapon,[createUnit('crew','player','footman',300,0)])).toBe(true);
  });

  it('does not let its own carrying hull obstruct a traversed mounted muzzle', () => {
    const {ship,item}=battery('warship','shipCannon');
    ship.sailing!.heading=0;
    const point={x:1300,y:1000};
    expect(mountedFireLaneClear(ship,item,point,[ship])).toBe(true);
    const blocker=createUnit('ally','player','transport',1220,1000);
    blocker.sailing={heading:Math.PI/2,speed:0,load:0,balance:0};
    expect(mountedFireLaneClear(ship,item,point,[ship,blocker])).toBe(false);
    blocker.y+=300;
    expect(mountedFireLaneClear(ship,item,point,[ship,blocker])).toBe(true);
  });

  it('only asks a firing-lane policy about otherwise legal mount arcs and ranges', () => {
    const {ship,item,items}=battery('warship','shipCannon');
    const target={x:1250,y:1000};
    let checked=0;
    const heading=bestFiringHeading({items},ship,target,0,(gun,point,candidate)=>{
      checked++;
      expect(gun).toBe(item);
      expect(canFire(ship,item,target,candidate)).toBe(true);
      expect(point).toEqual(target);
      return true;
    });
    expect(checked).toBeGreaterThan(0);
    expect(canFire(ship,item,target,heading)).toBe(true);
    checked=0;
    expect(bestFiringHeading({items},ship,{x:2000,y:1000},0,()=>{checked++;return true;})).toBe(ship.sailing!.heading);
    expect(checked).toBe(0);
  });

  it('reuses identical lane queries only within one selection, then observes a moved friendly hull', () => {
    const {ship,item,items}=battery('warship','shipCannon'),target={x:1300,y:1000};
    const blocker=createUnit('ally','player','transport',1220,1000);
    blocker.sailing={heading:Math.PI/2,speed:0,load:0,balance:0};
    const select=()=>{
      const queried=new Set<number>();
      const heading=bestFiringHeading({items},ship,target,0,(gun,point,candidate)=>{
        expect(gun).toBe(item);
        expect(queried.has(candidate)).toBe(false);queried.add(candidate);
        const posed={...ship,sailing:{...ship.sailing!,heading:candidate}};
        return mountedFireLaneClear(posed,gun,point,[blocker]);
      });
      expect(queried.size).toBeGreaterThan(0);
      return heading;
    };
    expect(select()).toBe(ship.sailing!.heading);
    blocker.y+=300;
    const heading=select(),posed={...ship,sailing:{...ship.sailing!,heading}};
    expect(canFire(ship,item,target,heading)).toBe(true);
    expect(mountedFireLaneClear(posed,item,target,[blocker])).toBe(true);
    expect(heading).not.toBe(ship.sailing!.heading);
  });

  it('selects legal shots from frozen moving batteries without mutating the policy inputs', () => {
    const freeze = <T>(value: T): T => {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const nested of Object.values(value)) freeze(nested);
        Object.freeze(value);
      }
      return value;
    };
    for (const velocity of [0, 1e-8, 1e-7, 1.00000001e-7, 45]) {
      const { ship } = battery('shipOfTheLine', 'shipCannon');
      ship.sailing!.heading = 0;
      const items: WorldItem[] = shipMounts(ship).map((mount, index) => ({
        id: `gun-${index}`, kind: 'shipCannon', x: ship.x, y: ship.y,
        shipId: ship.id, mountId: mount.id, durability: SHIP_WEAPONS.shipCannon.hp, cooldownRemaining: 0,
      }));
      const target = createUnit('target', 'enemy', 'transport', 1280, 1170);
      target.sailing = { heading: .4, speed: velocity, load: 0, balance: 0, velocityX: velocity, velocityY: 0 };
      const snapshot = { items, units: [ship, target] }, original = JSON.stringify(snapshot);
      freeze(snapshot);
      const queries = new Set<string>();
      const policy = (gun: WorldItem, point: { x: number; y: number }, candidate: number) => {
        expect(Object.isFrozen(gun)).toBe(true);
        const key = JSON.stringify([gun.id, point.x, point.y, candidate]);
        expect(queries.has(key)).toBe(false); queries.add(key);
        const posed = { ...ship, sailing: { ...ship.sailing!, heading: candidate } };
        const pose = mountedWeaponPose(posed, gun)!;
        expect(shipGunCanAim(posed, gun, point)).toBe(true);
        expect(Math.hypot(point.x - pose.pivot.x, point.y - pose.pivot.y)).toBeLessThanOrEqual(SHIP_WEAPONS.shipCannon.range);
        freeze(point);
        return mountedFireLaneClear(posed, gun, point, []);
      };
      const heading = bestFiringHeading(snapshot, ship, target, Math.PI / 36, policy);
      expect(queries.size).toBeGreaterThan(0);
      const posed = { ...ship, sailing: { ...ship.sailing!, heading } };
      expect(items.some(gun => {
        const point = mountedTargetPoint(snapshot, posed, gun, target), pose = mountedWeaponPose(posed, gun)!;
        return shipGunCanAim(posed, gun, point)
          && Math.hypot(point.x - pose.pivot.x, point.y - pose.pivot.y) <= SHIP_WEAPONS.shipCannon.range;
      })).toBe(true);
      expect(JSON.stringify(snapshot)).toBe(original);
    }
  });

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
    const { ship, item, items } = battery(), target = { x: ship.x + mortarBoundaryDistance(ship, item) + .25, y: ship.y };
    const heading = bestFiringHeading({ items }, ship, target);
    expect(canFire(ship, item, target, heading)).toBe(true);
    expect(heading).toBeGreaterThan(24 * Math.PI / 180);
    expect(heading).toBeLessThan(26 * Math.PI / 180);
    expect(canFire(ship, item, target, 0)).toBe(false);
  });

  it('aims at a crew member’s center without treating its body radius as a hull surface', () => {
    const { ship, item, items } = battery();
    const crew = createUnit('crew', 'enemy', 'footman', ship.x + mortarBoundaryDistance(ship, item) + .25, ship.y);
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
    for (const initial of [-.2, 0, .2]) for (const offset of [.25, .75, 1.5, 2.75]) {
      const { ship, item, items } = battery(), target = { x: ship.x + mortarBoundaryDistance(ship, item) + offset, y: ship.y };
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
