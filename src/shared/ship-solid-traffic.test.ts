import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { beginShipCollisionFrame, shipSolidTraffic } from './ship-collisions';
import { createGame } from './sim';
import type { GameMap } from './types';

function scene() {
  const map: GameMap = { ...createGame('bareDuel').map, width: 4096, height: 4096,
    terrain: { cols: 128, rows: 128, cell: 32, cells: ','.repeat(128 * 128) } };
  const ship = createUnit('ship', 'player', 'transport', 1000, 1000);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  const soldier = createUnit('soldier', 'enemy', 'footman', 1150, 1000), units = [ship, soldier];
  beginShipCollisionFrame(units, map);
  const traffic = shipSolidTraffic(map, ship, units);
  const from = { x: 1000, y: 1000, heading: 0 }, to = { x: 1400, y: 1000, heading: 0 };
  return { map, ship, soldier, units, traffic, from, to };
}

describe('solid route traffic on a reused view', () => {
  it('checks a shore body again after its position changes', () => {
    const { map, soldier, units, traffic, from, to } = scene();
    expect(traffic(from, to)).toBe(false);
    expect(traffic(from, to)).toBe(false);
    soldier.y = 1400;
    beginShipCollisionFrame(units, map);
    expect(traffic(from, to)).toBe(true);
    soldier.y = 1000;
    beginShipCollisionFrame(units, map);
    expect(traffic(from, to)).toBe(false);
  });

  it('checks changed body radius, deck occupancy and living status', () => {
    const { map, soldier, units, traffic, from, to } = scene();
    soldier.y = 1200; soldier.radius = 5;
    beginShipCollisionFrame(units, map);
    expect(traffic(from, to)).toBe(true);
    soldier.radius = 250;
    beginShipCollisionFrame(units, map);
    expect(traffic(from, to)).toBe(false);
    soldier.deck = { shipId: 'ship', x: 0, y: 0 };
    beginShipCollisionFrame(units, map);
    expect(traffic(from, to)).toBe(true);
    delete soldier.deck;
    beginShipCollisionFrame(units, map);
    expect(traffic(from, to)).toBe(false);
    soldier.hp = 0;
    expect(traffic(from, to)).toBe(true);
  });

  it('distinguishes the same center path at a changed hull heading', () => {
    const { soldier, traffic, from, to } = scene();
    soldier.y = 1110;
    expect(traffic(from, to)).toBe(true);
    const turnedFrom = { ...from, heading: Math.PI / 2 }, turnedTo = { ...to, heading: Math.PI / 2 };
    expect(traffic(turnedFrom, turnedTo)).toBe(false);
    expect(traffic(from, to)).toBe(true);
  });
});
