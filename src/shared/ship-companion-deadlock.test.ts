import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame, stepGame } from './sim';
import type { Unit } from './types';

// A transport and its carrier stopped in a coastal pocket, both sailing for the same landing (ladder-08 of the V9 gauntlet,
// game second 1302). Each plans its coastal voyage past the other as passing traffic, so each plan begins with a turn
// that the other's live hull blocks; without a plan neither moves, and the same blocked turn came back for the last
// 18 minutes of that game.
function pocket() {
  const game = createGame('ladder', { players: ['v9', 'p1', 'p2', 'p3'], layout: { seed: 'v9-layout:v5-hybrid-50-2026-06-12:ladder-08:5' } });
  const ship = (id: string, kind: 'transport' | 'carrier', x: number, y: number, heading: number): Unit => {
    const unit = createUnit(id, 'p3', kind, x, y);
    unit.order = { type: 'move', x: 5904, y: 2192, avoidCombat: true };
    unit.sailing = { heading, speed: 0, load: 0, balance: 0 };
    return unit;
  };
  game.units = [
    ship('transport', 'transport', 6158.604877871604, 1803.109990988203, -2.168667208279493),
    ship('carrier', 'carrier', 5940.444596514541, 1808.045097568675, 3.139956040704259),
  ];
  game.buildings = [];
  return game;
}

describe('stopped coastal companions', () => {
  it('get under way instead of waiting on each other\'s blocked turns', () => {
    const game = pocket();
    const start = game.units.map((unit) => ({ x: unit.x, y: unit.y }));
    for (let tick = 0; tick < 400; tick++) stepGame(game);
    game.units.forEach((unit, index) => {
      expect(Math.hypot(unit.x - start[index]!.x, unit.y - start[index]!.y), unit.id).toBeGreaterThan(100);
    });
  });
});
