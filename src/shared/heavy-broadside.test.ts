import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from './catalog';
import { circleInPolygon, localToWorld, shipProfile } from './ship-geometry';
import { damageShipParts, installedWeapons, repairShipParts, SHIP_HULL_COST, SHIP_WEAPONS, shipMounts, shipNeedsRepair, shipPartMax } from './ship-equipment';
import { coursePerformance, sailRig } from './ship-wind';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { seconds } from './time';
import type { WorldItem } from './types';

function sea() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = [];
  game.scriptedVictory = true;
  game.map.width = 3200; game.map.height = 2400;
  game.map.terrain = { cell: 40, cols: 80, rows: 60, cells: '~'.repeat(4800) };
  return game;
}
function run(game: ReturnType<typeof sea>, ticks: number) {
  for (let i = 0; i < ticks; i++) stepGame(game);
}

describe('heavy broadside ship', () => {
  it('prices four removable factory guns once and keeps their identity and damage after restoring', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 1100, 1000);
    const guns = installedWeapons(game, ship);
    expect(guns).toHaveLength(4);
    expect(shipProfile(ship)!.obstacles.filter(obstacle => obstacle.type === 'weapon')).toHaveLength(4);
    expect(guns.map(gun => gun.mountId).sort()).toEqual(['port0', 'port2', 'starboard0', 'starboard2']);
    expect(UNIT_DEFS.shipOfTheLine.cost).toBe(SHIP_HULL_COST.shipOfTheLine + 4 * SHIP_WEAPONS.shipCannon.cost);
    const gun = guns[0]!;
    gun.durability = 37; gun.cooldownRemaining = 19;
    const ids = guns.map(gun => gun.id).sort();
    issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: gun.id, destination: { shipId: ship.id, slot: 0 } });
    const saved = snapshotGame(game);
    restoreSnapshotIntoGame(game, saved, game.nextId);
    restoreSnapshotIntoGame(game, snapshotGame(game), game.nextId);
    const restored = game.units.find(unit => unit.id === ship.id)!;
    expect(installedWeapons(game, restored)).toHaveLength(3);
    expect(game.items.filter(item => ids.includes(item.id)).map(item => item.id).sort()).toEqual(ids);
    expect(game.items.find(item => item.id === gun.id)).toMatchObject({ durability: 37, cooldownRemaining: 19, holdSlot: 0 });
  });

  it('keeps all eight cannon bases inside the actual deck and accepts only the broadside armament', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 1100, 1000), profile = shipProfile(ship)!;
    expect(shipMounts(ship)).toHaveLength(8);
    for (const mount of shipMounts(ship)) {
      expect(circleInPolygon(mount, mount.radius, profile.deck)).toBe(true);
      expect(mount.accepts).toEqual(['shipCannon']);
      expect(Math.abs(mount.bearing)).toBeCloseTo(Math.PI / 2);
    }
    expect(shipMounts(ship).some(mount => mount.id === 'bow')).toBe(false);
  });

  it('fires four independently fitted guns on the engaged side without shooting through the opposite side', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 1200, 1100);
    for (const mount of shipMounts(ship).filter(mount => !installedWeapons(game, ship).some(gun => gun.mountId === mount.id))) {
      const gun: WorldItem = { id: `extra-${mount.id}`, kind: 'shipCannon', x: ship.x, y: ship.y, shipId: ship.id,
        mountId: mount.id, durability: SHIP_WEAPONS.shipCannon.hp, cooldownRemaining: 0 };
      game.items.push(gun);
      ship.fittings = [...ship.fittings!, { ...mount, id: gun.id }];
    }
    // A stationary target directly off the port side leaves every port mount
    // in its real ±35° arc, without requiring a hull turn.
    const target = game.spawnUnit('enemy', 'carrier', 1200, 810);
    target.hp = target.maxHp = 10000;
    target.order = { type: 'hold', x: target.x, y: target.y };
    issuePlayerCommand(game, 'player', { type: 'holdPosition', unitIds: [ship.id] });
    const fired = new Set<string>();
    for (let tick = 0; tick < seconds(6); tick++) {
      stepGame(game);
      for (const effect of game.effects) if (effect.type === 'muzzleFlash' && effect.itemId) fired.add(effect.itemId);
    }
    const guns = installedWeapons(game, ship);
    expect(guns.filter(gun => fired.has(gun.id)).map(gun => gun.mountId).sort()).toEqual(['port0', 'port1', 'port2', 'port3']);
    expect(target.hp).toBeLessThan(10000);
    expect(ship.x).toBe(1200); expect(ship.y).toBe(1100);
    expect(ship.sailing!.heading).toBeCloseTo(0);
  });

  it('cannot produce a free intrinsic attack after all paid guns are removed', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 1100, 1000);
    game.items = []; ship.fittings = [];
    const target = game.spawnUnit('enemy', 'transport', 1100, 770);
    target.order = { type: 'hold', x: target.x, y: target.y };
    run(game, seconds(5));
    expect(target.hp).toBe(target.maxHp);
    expect(game.projectiles).toHaveLength(0);
  });

  it('uses square-rig beating and reaches a long sea destination within its hull turn budget', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 650, 1250);
    const profile = shipProfile(ship)!;
    expect(sailRig(ship.kind)).toBe('square');
    expect(coursePerformance(ship, game.map, 0, { assumeTrimmed: true }).noGoAngle).toBeCloseTo(48 * Math.PI / 180);
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 2450, y: 800 });
    for (let tick = 0; tick < seconds(120) && ship.order.type !== 'idle'; tick++) {
      const heading = ship.sailing!.heading;
      stepGame(game);
      expect(Math.abs(ship.sailing!.heading - heading)).toBeLessThanOrEqual(profile.turnRate / 20 + 1e-7);
    }
    expect(ship.order.type).toBe('idle');
    expect(Math.hypot(ship.x - 2450, ship.y - 800)).toBeLessThan(15);
  });

  it('breaks and repairs the real stern cabin independently of the hull and rigging', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 1100, 1000);
    const cabin = shipProfile(ship)!.obstacles.find(obstacle => obstacle.type === 'cabin')!;
    damageShipParts(game, ship, localToWorld(ship, cabin), 1000);
    expect(ship.shipParts!.cabin).toBe(0);
    expect(ship.hp).toBe(ship.maxHp);
    expect(ship.shipParts!.rigging).toBe(shipPartMax(ship).rigging);
    expect(shipNeedsRepair(game, ship)).toBe(true);
    repairShipParts(game, ship, 2000);
    expect(ship.shipParts!.cabin).toBe(shipPartMax(ship).cabin);
    expect(shipNeedsRepair(game, ship)).toBe(false);
  });

  it('damages shared rigging when any of its three physical mast regions is hit', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 1100, 1000);
    const masts = shipProfile(ship)!.obstacles.filter(obstacle => obstacle.type === 'mast');
    expect(masts).toHaveLength(3);
    for (const mast of masts) {
      ship.shipParts!.rigging = shipPartMax(ship).rigging;
      damageShipParts(game, ship, localToWorld(ship, mast), 20);
      expect(ship.shipParts!.rigging).toBe(shipPartMax(ship).rigging - 13);
    }
  });
});
