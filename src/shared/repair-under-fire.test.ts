import { describe, expect, it } from 'vitest';
import { boardUnit, syncDecks } from './decks';
import { createUnit } from './map';
import { initializeShipEquipment, rebuildShipFittings } from './ship-equipment';
import { strikePoint } from './combat-geometry';
import { createGame, stepGame, type Game } from './sim';
import { REPAIR_UNDER_FIRE } from './unit-repair';
import type { Unit } from './types';

function sea() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = [];
  game.effects = []; game.projectiles = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 4096, height: 4096, wind: { direction: Math.PI / 2, speed: 36 }, terrain: { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) } };
  game.players.player!.gold = 5000;
  return game;
}
/** A transport with two workers on its deck, who mend it as it holds where it is. */
function crewedTransport(game: Game, x: number, y: number, hardy = false) {
  const ship = game.spawnUnit('player', 'transport', x, y);
  ship.sailing!.heading = 0; ship.order = { type: 'hold', x, y };
  for (let i = 0; i < 2; i++) {
    const worker = createUnit(`worker-${i}`, 'player', 'worker', x, y); game.units.push(worker);
    expect(boardUnit(ship, worker, game.units)).toBe(true);
    worker.order = { type: 'hold', x: worker.x, y: worker.y };
    if (hardy) worker.hp = worker.maxHp = 100000;
  }
  syncDecks(game.units);
  return ship;
}
const mended = (game: Game, ship: Unit, seconds: number) => { const before = ship.hp; for (let tick = 0; tick < seconds * 20; tick++) stepGame(game); return ship.hp - before; };

// @@@repair-under-fire
describe('a hull mended under fire', () => {
  it('is mended at full pace out of the fire, and at a quarter for a few seconds after an enemy blow', () => {
    const game = sea(), ship = crewedTransport(game, 2000, 2000);
    ship.hp = 100;
    const calm = mended(game, ship, 2);
    expect(calm).toBeGreaterThan(40);
    ship.hp = 100; ship.sailing!.hullHitTick = game.tick;
    const struck = mended(game, ship, 2);
    expect(struck).toBeLessThan(calm * .4);
    expect(struck).toBeGreaterThan(0);
    for (let tick = 0; tick < REPAIR_UNDER_FIRE.seconds * 20; tick++) stepGame(game);
    ship.hp = 100;
    expect(mended(game, ship, 2)).toBeCloseTo(calm, -1);
  });

  it('lets a ship of the line\'s broadside sink a transport two workers mend', () => {
    // The workers outlast the bursts on the deck, so it is the pace of their mending that is weighed.
    const game = sea(), transport = crewedTransport(game, 2000, 2000, true);
    const gunship = game.spawnUnit('enemy', 'shipOfTheLine', 2000, 1500);
    gunship.sailing!.heading = 0; delete gunship.fittings;
    initializeShipEquipment(game); rebuildShipFittings(game, gunship);
    // Its starboard battery 280 from the transport's near side, in the band (see @@@hull-reach).
    gunship.y = 2000 - 280 - (2000 - strikePoint({ x: 2000, y: 0 }, transport).y) - 54;
    gunship.order = { type: 'hold', x: gunship.x, y: gunship.y };
    // At full pace their mending (29 hp/s) outlasts the broadside (25): it was still afloat after 90 s. Now about 23 s.
    for (let tick = 0; tick < 60 * 20 && transport.hp > 0; tick++) { stepGame(game); gunship.x = 2000; gunship.sailing!.heading = 0; }
    expect(game.units.includes(transport)).toBe(false);
  });
});
