import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, stepGame, type Game } from './sim';
import { hullOnWalkway } from './ship-mooring';
import { shoulderAside, sweepShipCollision } from './ship-collisions';
import { beginShipMotionFrame } from './ship-motion';
import { distanceToHull, shipProfile } from './ship-geometry';
import type { Unit } from './types';

// @@@give-way (hulls): a coast whose west is ground, then a strip of shallows that land units wade, then deep water. A
// transport lies idle across the shallows, and a footman wades along them from north to south.
function ford(shipOrder?: 'hold') {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = []; game.scriptedVictory = true;
  const cols = 100, rows = 60, cell = 40;
  game.map = { ...game.map, width: cols * cell, height: rows * cell, wind: { direction: Math.PI / 2, speed: 36 },
    terrain: { cell, cols, rows, cells: Array.from({ length: rows }, () => '.'.repeat(20) + ','.repeat(20) + '~'.repeat(60)).join('') } };
  const ship = game.spawnUnit('player', 'transport', 1200, 1200);
  ship.sailing!.heading = 0;
  if (shipOrder) issuePlayerCommand(game, 'player', { type: 'holdPosition', unitIds: [ship.id] });
  return { game, ship };
}
const pose = (ship: Unit) => ({ x: ship.x, y: ship.y, heading: ship.sailing!.heading });
const wade = (game: Game) => {
  const footman = game.spawnUnit('player', 'footman', 1200, 400);
  issuePlayerCommand(game, 'player', { type: 'move', unitIds: [footman.id], x: 1200, y: 2000 });
  return footman;
};

describe('a hull at rest gives way to its side\'s land units', () => {
  it('moors in deep water, straight out, when it holds up a footman wading the shallows, and he passes', () => {
    const { game, ship } = ford();
    expect(hullOnWalkway(game.map, ship, pose(ship))).toBe(true);
    const footman = wade(game);
    for (let tick = 0; tick < 60 * 20 && Math.hypot(footman.x - 1200, footman.y - 2000) > 20; tick++) stepGame(game);
    expect(Math.hypot(footman.x - 1200, footman.y - 2000)).toBeLessThanOrEqual(20);
    for (let tick = 0; tick < 30 * 20 && ship.order.type !== 'idle'; tick++) stepGame(game);
    expect(ship.order.type).toBe('idle');
    expect(hullOnWalkway(game.map, ship, pose(ship))).toBe(false);
    expect(ship.sailing!.heading).toBeCloseTo(0, 2);
    expect(Math.abs(ship.y - 1200)).toBeLessThan(5);
  });

  it('stays where it lies when nobody is held up by it', () => {
    const { game, ship } = ford(), start = pose(ship);
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(pose(ship)).toEqual(start);
  });

  it('does not yield while holding its ground', () => {
    const { game, ship } = ford('hold'), start = pose(ship);
    const footman = wade(game);
    for (let tick = 0; tick < 30 * 20; tick++) stepGame(game);
    expect(pose(ship)).toEqual(start);
    expect(footman.y).toBeLessThan(1200);
  });
});

// @@@shoulder-aside: a transport's sweep north along the shallows, through a footman standing in its way.
describe('a hull shoulders its own side\'s troops aside', () => {
  function sweep(owner: 'player' | 'enemy') {
    const { game, ship } = ford();
    ship.sailing!.heading = -Math.PI / 2;
    const footman = game.spawnUnit(owner, 'footman', 1200, 1200 - shipProfile(ship)!.length / 2 - 30);
    const from = pose(ship), to = { ...from, y: from.y - 120 };
    beginShipMotionFrame(game.units, game.map);
    return { game, ship, footman, from, to, contact: sweepShipCollision(game.map, ship, game.units, from, to) };
  }
  it('is not stopped by its own, and sets him down off its side', () => {
    const { game, ship, footman, from, to, contact } = sweep('player');
    expect(contact).toBeUndefined();
    Object.assign(ship, { x: to.x, y: to.y });
    shoulderAside(game.map, game.units, new Map([[ship.id, from]]));
    expect(distanceToHull(ship, footman)).toBeGreaterThanOrEqual(footman.radius);
    expect(footman.hp).toBe(footman.maxHp);
  });
  it('is stopped by an enemy', () => {
    expect(sweep('enemy').contact?.kind).toBe('unit');
  });
});
