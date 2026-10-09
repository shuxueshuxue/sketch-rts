import { describe, expect, it } from 'vitest';
import { boardUnit } from './decks';
import { createUnit } from './map';
import { hullFits, type ShipPose } from './ship-navigation';
import { hullContact, shipProfile } from './ship-geometry';
import { beginShipMotionFrame, advanceShip } from './ship-motion';
import { constrainGroundShipStep, drainShipCollisionImpacts, shipBodyClearAtPose, sweepShipCollision } from './ship-collisions';
import { createGame } from './sim';
import { perTick } from './time';
import type { Building, GameMap, Unit } from './types';

function water(): GameMap { return { ...createGame('bareDuel').map, width: 4096, height: 4096, terrain: { cols: 128, rows: 128, cell: 32, cells: '~'.repeat(128 * 128) } }; }
function boat(id: string, x = 1000, heading = 0, speed = 64) {
  const ship = createUnit(id, 'player', 'transport', x, 1000);
  ship.sailing = { heading, speed, load: 0, balance: 0, velocityX: speed * Math.cos(heading), velocityY: speed * Math.sin(heading) };
  return ship;
}
const pose = (ship: Unit): ShipPose => ({ x: ship.x, y: ship.y, heading: ship.sailing!.heading });
const bow = (ship: Unit) => Math.max(...shipProfile(ship)!.hull.map(p => p.x));
const stern = (ship: Unit) => -Math.min(...shipProfile(ship)!.hull.map(p => p.x));
function pair(heading = 0, otherSpeed = 0) {
  const a = boat('a'), b = boat('b', 0, heading, otherSpeed);
  b.x = a.x + bow(a) + (heading === 0 ? stern(b) : bow(b)) + .4;
  return { a, b, units: [a, b] };
}
function dock(x: number, radius = 32): Building {
  const yard = createGame('bareDuel', { scenario: { addBuildings: [{ id: 'dock', owner: 'player', kind: 'shipyard', x, y: 1000 }] } }).buildings.find(b => b.id === 'dock')!;
  yard.x = x; yard.y = 1000; yard.radius = radius;
  return yard;
}

describe('continuous physical ship impacts', () => {
  it('reports a high-speed friendly impact before overlap and stops inward momentum', () => {
    const map = water(), { a, b, units } = pair();
    beginShipMotionFrame(units, map);
    expect(advanceShip(a, map, units, { surge: perTick(64) })).toBe(false);
    expect(a.x).toBeGreaterThan(1000);
    expect(hullContact(a, b)).toBeUndefined();
    const [impact] = drainShipCollisionImpacts(units);
    expect(impact?.kind).toBe('ship'); expect(impact?.closingSpeed).toBeCloseTo(64);
    expect(impact?.shipDamage).toBeGreaterThan(0); expect(impact?.otherDamage).toBeGreaterThan(0);
    expect(a.sailing!.speed).toBe(0); expect(a.sailing!.velocityX).toBe(0);
    expect(a.hp).toBe(a.maxHp); expect(b.hp).toBe(b.maxHp);
  });

  it('uses relative normal speed and emits one reciprocal head-on impact per frame', () => {
    const map = water(), frontal = pair(Math.PI, 64), stationary = pair();
    beginShipMotionFrame(stationary.units, map); advanceShip(stationary.a, map, stationary.units, { surge: perTick(64) });
    const staticImpact = drainShipCollisionImpacts(stationary.units)[0]!;
    beginShipMotionFrame(frontal.units, map);
    advanceShip(frontal.a, map, frontal.units, { surge: perTick(64) });
    advanceShip(frontal.b, map, frontal.units, { surge: perTick(64) });
    const impacts = drainShipCollisionImpacts(frontal.units);
    expect(impacts).toHaveLength(1); expect(impacts[0]!.closingSpeed).toBeCloseTo(128);
    expect(impacts[0]!.energy).toBeGreaterThan(staticImpact.energy * 3);
    expect(impacts[0]!.shipDamage).toBeLessThanOrEqual(frontal.a.maxHp * .25);
    expect(hullContact(frontal.a, frontal.b)).toBeUndefined();
  });

  it('does not damage low-speed mooring or same-velocity touching hulls', () => {
    const map = water(), gentle = pair(), matched = pair(0, 64);
    gentle.a.sailing!.speed = 5; gentle.a.sailing!.velocityX = 5;
    gentle.b.x -= .3;
    beginShipMotionFrame(gentle.units, map);
    advanceShip(gentle.a, map, gentle.units, { surge: perTick(5) });
    expect(drainShipCollisionImpacts(gentle.units)).toEqual([]);
    beginShipMotionFrame(matched.units, map);
    advanceShip(matched.a, map, matched.units, { surge: perTick(64) });
    expect(drainShipCollisionImpacts(matched.units)).toEqual([]);
  });

  it('does not repeat damage after headway was spent at contact', () => {
    const map = water(), { a, units } = pair();
    beginShipMotionFrame(units, map); advanceShip(a, map, units, { surge: perTick(64) });
    expect(drainShipCollisionImpacts(units)).toHaveLength(1);
    // The simulation saves the travel to the contact as last-tick world velocity.
    a.sailing!.velocityX = 30;
    for (let tick = 0; tick < 40; tick++) {
      beginShipMotionFrame(units, map);
      advanceShip(a, map, units, { surge: perTick(perTick(shipProfile(a)!.acceleration)) });
      expect(drainShipCollisionImpacts(units)).toEqual([]);
    }
  });

  it('does not turn a paused ship pushing its helm against contact into repeated damage', () => {
    const map = water(), a = boat('a', 1000, 0, 0), b = boat('b', 1000, 0, 0), units = [a, b];
    b.y += 2 * Math.max(...shipProfile(a)!.hull.map(p => p.y)) + .05;
    let blocked = 0;
    for (let tick = 0; tick < 30; tick++) {
      beginShipMotionFrame(units, map);
      if (!advanceShip(a, map, units, { yaw: .015 })) blocked++;
      expect(drainShipCollisionImpacts(units)).toEqual([]);
      expect(hullContact(a, b)).toBeUndefined();
    }
    expect(blocked).toBeGreaterThan(1);
  });

  it('treats a fast tangential glance as gentle contact rather than full-speed damage', () => {
    const map = water(), ship = boat('a', 1000, Math.acos(.05)), units = [ship];
    const xmax = Math.max(...shipProfile(ship)!.hull.map(p => p.x * Math.cos(ship.sailing!.heading) - p.y * Math.sin(ship.sailing!.heading)));
    const building = dock(ship.x + xmax + 96 + .03, 96);
    beginShipMotionFrame(units, map, [building]);
    expect(advanceShip(ship, map, units, { surge: perTick(64) })).toBe(false);
    expect(drainShipCollisionImpacts(units)).toEqual([]);
  });

  it('blocks a dock foundation and destructible obstacle using their real footprints', () => {
    const map = water(), ship = boat('a'), units = [ship], building = dock(ship.x + bow(ship) + 32 + .4);
    beginShipMotionFrame(units, map, [building]);
    expect(advanceShip(ship, map, units, { surge: perTick(64) })).toBe(false);
    const hit = drainShipCollisionImpacts(units)[0]!;
    expect(hit.kind).toBe('building'); expect(hit.other).toBe(building); expect(hit.otherDamage).toBeGreaterThan(0);
    const rockShip = boat('rocks'), rockUnits = [rockShip];
    const obstacle = { id: 'rock', kind: 'rocks' as const, owner: 'neutral' as const, x: rockShip.x + bow(rockShip) + 32 + .4, y: 1000, radius: 32, hp: 100, maxHp: 100, along: { x: 0, y: 1 } };
    beginShipMotionFrame(rockUnits, map, [obstacle]); advanceShip(rockShip, map, rockUnits, { surge: perTick(64) });
    expect(drainShipCollisionImpacts(rockUnits)[0]?.kind).toBe('obstacle');
  });

  it('stops a reachable off-deck ground body even when both desired endpoints are clear', () => {
    const map = water(); map.terrain!.cells = ','.repeat(128 * 128);
    const ship = boat('a'), soldier = createUnit('soldier', 'player', 'footman', ship.x + bow(ship) + 40, 1000), units = [ship, soldier];
    ship.speed = 10000; ship.sailing!.speed = 10000; ship.sailing!.velocityX = 10000;
    const end = { ...pose(ship), x: ship.x + 500 };
    expect(shipBodyClearAtPose(map, ship, pose(ship), [soldier])).toBe(true);
    expect(shipBodyClearAtPose(map, ship, end, [soldier])).toBe(true);
    beginShipMotionFrame(units, map);
    expect(sweepShipCollision(map, ship, units, pose(ship), end)?.kind).toBe('unit');
    expect(advanceShip(ship, map, units, { surge: 500 })).toBe(false);
    const hit = drainShipCollisionImpacts(units)[0]!;
    expect(hit.other).toBe(soldier); expect(hit.otherDamage).toBeGreaterThan(0);
    expect(hit.otherDamage / soldier.maxHp).toBeGreaterThanOrEqual(hit.shipDamage / ship.maxHp);
    expect(soldier.deck).toBeUndefined(); expect(ship.x).toBeLessThan(soldier.x);
  });

  it('ignores passengers, dead hulls and unreachable deep-water ground bodies', () => {
    const map = water(), ship = boat('a'), dead = boat('dead'), soldier = createUnit('soldier', 'player', 'footman', ship.x + bow(ship) + 14, 1000), crew = createUnit('crew', 'player', 'footman', ship.x, ship.y);
    dead.hp = 0; expect(boardUnit(ship, crew, [ship, crew])).toBe(true);
    const units = [ship, dead, soldier, crew];
    beginShipMotionFrame(units, map);
    expect(advanceShip(ship, map, units, { surge: perTick(64) })).toBe(true);
    expect(drainShipCollisionImpacts(units)).toEqual([]); expect(crew.deck?.shipId).toBe(ship.id);
  });

  it('clips ground walking continuously at a hull without putting the soldier aboard', () => {
    const map = water(); map.terrain!.cells = ','.repeat(128 * 128);
    const ship = boat('a', 1000, 0, 0), soldier = createUnit('soldier', 'player', 'footman', 700, 1000), units = [ship, soldier];
    beginShipMotionFrame(units, map);
    const end = constrainGroundShipStep(map, soldier, soldier, { x: 1400, y: 1000 }, units);
    expect(end.x).toBeGreaterThan(soldier.x); expect(end.x).toBeLessThan(ship.x - stern(ship));
    expect(soldier.deck).toBeUndefined();
    const away = constrainGroundShipStep(map, soldier, end, { x: 600, y: 1000 }, units);
    expect(away.x).toBe(600);
  });

  it('records a damaging shoreline impact and keeps gentle blocked coast contact quiet', () => {
    const map = water(); map.terrain!.cells = Array.from({ length: 128 * 128 }, (_, i) => i % 128 >= 40 ? '#' : '~').join('');
    const ship = boat('a'), units = [ship]; ship.x = 40 * 32 - bow(ship) - .4;
    expect(hullFits(map, ship)).toBe(true);
    beginShipMotionFrame(units, map); advanceShip(ship, map, units, { surge: perTick(64) });
    expect(drainShipCollisionImpacts(units)[0]?.kind).toBe('terrain'); expect(hullFits(map, ship)).toBe(true);
    for (let i = 0; i < 30; i++) {
      beginShipMotionFrame(units, map); advanceShip(ship, map, units, { surge: .1 });
      expect(drainShipCollisionImpacts(units)).toEqual([]); expect(hullFits(map, ship)).toBe(true);
    }
  });
});
