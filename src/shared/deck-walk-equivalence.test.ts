import { describe, expect, it } from 'vitest';
import { boardUnit, syncDecks } from './decks';
import { createGame, issuePlayerCommand, stepGame, warmGameCaches } from './sim';
import { checksumGame, fnv1a } from './sim/checksum';
import { initializeShipEquipment, rebuildShipFittings } from './ship-equipment';
import { shipBoardingGoal } from './ship-gangway';
import { shipProfile } from './ship-geometry';

// A boarding fight on deck: two ships of the line with their own guns, the boarders laid alongside, six of them against
// four defenders. The bridge goes out, the boarders cross single file, fight on the quarry's deck and take it.
function deckFight() {
  const game = createGame('bareDuel', { players: ['p', 'g'], aiPlayers: [], teams: { p: 'p', g: 'g' }, races: { p: 'grove', g: 'grove' } });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = []; game.effects = []; game.projectiles = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 4096, height: 4096, landmarks: [], wind: { direction: Math.PI / 2, speed: 36 }, terrain: { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) } };
  const heading = -1.42, side = { x: -Math.sin(heading), y: Math.cos(heading) };
  const a = game.spawnUnit('p', 'shipOfTheLine', 2000, 2000), b = game.spawnUnit('g', 'shipOfTheLine', 2000, 2000);
  const half = shipProfile(a)!.beam;
  a.x = 2000 + side.x * half; a.y = 2000 + side.y * half; b.x = 2000 - side.x * half; b.y = 2000 - side.y * half;
  for (const ship of [a, b]) { ship.sailing!.heading = heading; delete ship.fittings; ship.order = { type: 'hold', x: ship.x, y: ship.y }; }
  initializeShipEquipment(game);
  game.items = game.items.filter(item => !(item.shipId === b.id && item.mountId?.startsWith('starboard')));
  for (const ship of [a, b]) rebuildShipFittings(game, ship);
  const crew = (ship: typeof a, owner: string, count: number) => Array.from({ length: count }, () => {
    const unit = game.spawnUnit(owner, 'footman', ship.x, ship.y);
    expect(boardUnit(ship, unit, game.units)).toBe(true);
    return unit;
  });
  const boarders = crew(a, 'p', 6); crew(b, 'g', 4);
  syncDecks(game.units);
  for (const unit of game.units) if (unit.deck) unit.order = { type: 'hold', x: unit.x, y: unit.y };
  const berth = shipBoardingGoal(game.map, game.units, a, b)!;
  Object.assign(a, { x: berth.x, y: berth.y }); a.sailing!.heading = berth.heading;
  issuePlayerCommand(game, 'p', { type: 'board', unitIds: boarders.map(unit => unit.id), transportId: b.id });
  issuePlayerCommand(game, 'p', { type: 'boardShip', unitIds: [a.id], targetId: b.id });
  warmGameCaches(game);
  return { game, b };
}

describe('walking on decks', () => {
  // @@@deck-walk-equivalence - The deck walk's caches and searches are only faster ways to the same answers: the same
  // fight, tick for tick, as the walk computed afresh for every walker (recorded on main before they were added).
  it('fights the same boarding fight, tick for tick', () => {
    const { game, b } = deckFight(), trail: string[] = [];
    for (let tick = 0; tick < 240; tick++) { stepGame(game); trail.push(checksumGame(game)); }
    expect(b.owner).toBe('p');
    expect(fnv1a(trail.join(','))).toBe('f99a4123');
  }, 60_000);
});
