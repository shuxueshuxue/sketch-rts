import { describe, expect, it } from 'vitest';
import { boardUnit, syncDecks } from './decks';
import { createUnit } from './map';
import { createGame, issuePlayerCommand, stepGame, type Game } from './sim';
import { initializeShipEquipment, rebuildShipFittings, shipMounts, SHIP_WEAPONS } from './ship-equipment';
import { shipBoardingGoal } from './ship-gangway';
import { shipProfile } from './ship-geometry';
import type { Unit, WorldItem } from './types';

// Two ships of the line on open water, the boarder `gap` beside its quarry; both hold where they are.
function sea(gap: number, targetOwner = 'enemy') {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = [];
  game.effects = []; game.projectiles = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 4096, height: 4096, wind: { direction: Math.PI / 2, speed: 80 }, terrain: { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) } };
  const source = game.spawnUnit('player', 'shipOfTheLine', 2000, 2000), target = game.spawnUnit(targetOwner, 'shipOfTheLine', 2000, 2400);
  source.sailing!.heading = target.sailing!.heading = 0;
  target.y = source.y + (shipProfile(source)!.beam + shipProfile(target)!.beam) / 2 + gap;
  for (const ship of [source, target]) ship.order = { type: 'hold', x: ship.x, y: ship.y };
  return { game, source, target };
}
// The quarry's guns fire on the boarder's deck all the way in, so a boarding party is a full company.
function company(game: Game, ship: Unit) {
  return Array.from({ length: 8 }, () => crew(game, ship));
}
function crew(game: Game, ship: Unit) {
  const unit = createUnit(`crew-${game.units.length}`, ship.owner, 'footman', ship.x, ship.y); game.units.push(unit);
  expect(boardUnit(ship, unit, game.units)).toBe(true); syncDecks(game.units);
  unit.order = { type: 'hold', x: unit.x, y: unit.y }; return unit;
}
// A cannon on every mount: a broadside's rail is lined with guns.
function armAll(game: Game, ship: Unit, durability: number = SHIP_WEAPONS.shipCannon.hp) {
  for (const mount of shipMounts(ship)) game.items.push({ id: `gun-${ship.id}-${mount.id}`, kind: 'shipCannon', x: ship.x, y: ship.y, shipId: ship.id,
    mountId: mount.id, durability, cooldownRemaining: 0 } as WorldItem);
  rebuildShipFittings(game, ship);
}
function tickUntil(game: Game, done: () => boolean, limit: number) {
  for (let tick = 0; tick < limit && !done(); tick++) stepGame(game);
  return done();
}

describe('boarding a ship of the line', () => {
  it('finds a berth between two hulls whose whole broadsides are armed', () => {
    // This is about the berth, so nobody fires: the quarry is the boarder's own (a crew transfer lays the same bridge),
    // and every gun is wrecked. They still stand on both rails.
    const { game, source, target } = sea(300, 'player');
    armAll(game, source, 0); armAll(game, target, 0); company(game, source);
    expect(shipBoardingGoal(game.map, game.units, source, target)).toBeDefined();
    issuePlayerCommand(game, 'player', { type: 'boardShip', unitIds: [source.id], targetId: target.id });
    expect(tickUntil(game, () => source.sailing?.gangway?.phase === 'ready', 60 * 20)).toBe(true);
  });

  it('comes alongside a defender that would swing its guns onto it, instead of chasing its turning hull', () => {
    const { game, source, target } = sea(300);
    // Both carry a ship of the line's own four guns.
    for (const ship of [source, target]) delete ship.fittings;
    initializeShipEquipment(game);
    const soldiers = company(game, source);
    issuePlayerCommand(game, 'player', { type: 'boardShip', unitIds: [source.id], targetId: target.id });
    expect(tickUntil(game, () => source.sailing?.gangway?.phase === 'ready', 60 * 20)).toBe(true);
    expect(tickUntil(game, () => soldiers.some(unit => unit.hp > 0 && unit.deck?.shipId === target.id), 20 * 20)).toBe(true);
  });

  it('still lets the quarry sail out of a boarding with a helm order of its own', () => {
    const { game, source, target } = sea(300);
    // This is about the helm order. Both broadsides now trade fire on the way in (see @@@band-aim), and a quarry whose
    // rigging is shot away could not sail out at all, so every gun is wrecked here.
    for (const item of game.items) item.durability = 0;
    company(game, source);
    issuePlayerCommand(game, 'player', { type: 'boardShip', unitIds: [source.id], targetId: target.id });
    expect(tickUntil(game, () => source.sailing?.gangway?.phase === 'deploying', 60 * 20)).toBe(true);
    const x = target.x;
    issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [target.id], x: target.x + 900, y: target.y });
    expect(tickUntil(game, () => !source.sailing?.gangway, 20 * 20)).toBe(true);
    expect(tickUntil(game, () => target.x > x + 100, 30 * 20)).toBe(true);
  });

  it('keeps a deployed bridge when the boarder walking to it is killed', () => {
    const { game, source, target } = sea(300);
    const soldiers = company(game, source);
    issuePlayerCommand(game, 'player', { type: 'boardShip', unitIds: [source.id], targetId: target.id });
    expect(tickUntil(game, () => source.sailing?.gangway?.phase === 'ready', 60 * 20)).toBe(true);
    stepGame(game);
    const fallen = soldiers.find(unit => unit.hp > 0 && unit.order.type === 'board')!;
    // Killed on deck before it is cleared away, it still holds its order to board.
    fallen.hp = 0;
    stepGame(game);
    expect(source.order.type).not.toBe('move');
    expect(source.sailing?.gangway?.phase).toBe('ready');
  });
});
