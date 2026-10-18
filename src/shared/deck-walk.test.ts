import { describe, expect, it } from 'vitest';
import { boardUnit, syncDecks } from './decks';
import { createGame, issuePlayerCommand, stepGame, warmGameCaches } from './sim';
import { checksumGame } from './sim/checksum';
import { createRoom } from './rooms';
import { createSaveGameRecord, restoreGameFromSave } from './savegame';
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
  const trail = (game: ReturnType<typeof deckFight>['game'], from: number, to: number) => {
    const sums: string[] = [];
    for (let tick = from; tick < to; tick++) { stepGame(game); sums.push(checksumGame(game)); }
    return sums;
  };
  // The fight is the crews' alone (see @@@cannon-min-range): guns hold their fire on a deck alongside, so the prize is
  // taken by the sword some time after the bridge is out, not within its first twelve seconds.
  const fightOn = (game: ReturnType<typeof deckFight>['game'], b: ReturnType<typeof deckFight>['b']) => {
    for (let tick = game.tick; tick < 90 * 20 && b.owner !== 'p'; tick++) stepGame(game);
  };
  it('fights the boarding fight the same way every time, and the boarders take the ship', () => {
    const first = deckFight(), second = deckFight();
    expect(trail(first.game, 0, 240)).toEqual(trail(second.game, 0, 240));
    fightOn(first.game, first.b);
    expect(first.b.owner).toBe('p');
  }, 120_000);

  // @@@deck-walk-restore - How a body walks is decided from what a save keeps (see @@@explicit-route): a fight saved in
  // the middle of the boarding and loaded again goes on tick for tick as the one never saved.
  it('goes on tick for tick after a save in the middle of the boarding', () => {
    const { game, b } = deckFight();
    trail(game, 0, 100);
    const boarders = game.units.filter(unit => unit.owner === 'p' && unit.deck?.shipId === b.id), defenders = game.units.filter(unit => unit.owner === 'g' && unit.deck && unit.hp > 0);
    expect(boarders.length).toBeGreaterThan(0); expect(defenders.length).toBeGreaterThan(0);
    const room = { ...createRoom({ id: 'deck-walk-restore', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
    const restored = restoreGameFromSave(JSON.parse(JSON.stringify(createSaveGameRecord(game, room, { id: 'deck-walk-restore' }))));
    // A scene's own rule, not a match's, so a save does not keep it: the fight on deck alone does not end the match.
    restored.scriptedVictory = true;
    warmGameCaches(restored);
    expect(trail(restored, 100, 240)).toEqual(trail(game, 100, 240));
    fightOn(game, b);
    expect(b.owner).toBe('p');
  }, 120_000);
});

// @@@give-way: four boarders laid on a ship of the line as boarding lays them, the first in the pocket behind the stern
// cabin and the others at its mouth. Sent forward, the first walks out: the idle crew in the way step aside and are
// idle again. Crew holding their ground do not yield, and the walker waits.
describe('idle crew give way on a deck', () => {
  function packed(stance: 'idle' | 'hold') {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = []; game.scriptedVictory = true;
    game.map = { ...game.map, width: 4000, height: 4000, wind: { direction: Math.PI / 2, speed: 36 }, terrain: { cell: 40, cols: 100, rows: 100, cells: '~'.repeat(100 * 100) } };
    const ship = game.spawnUnit('player', 'shipOfTheLine', 2000, 2000);
    const crew = (['footman', 'archer', 'worker', 'footman'] as const).map(kind => { const unit = game.spawnUnit('player', kind, ship.x, ship.y); expect(boardUnit(ship, unit, game.units)).toBe(true); return unit; });
    syncDecks(game.units);
    for (const unit of crew) unit.order = stance === 'idle' ? { type: 'idle' } : { type: 'hold', x: unit.x, y: unit.y };
    const [walker, ...others] = crew;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [walker!.id], x: ship.x + 60, y: ship.y });
    return { game, ship, walker: walker!, others };
  }
  it('lets a crewman walk out of the pocket behind the stern cabin past idle crew', () => {
    const { game, ship, walker, others } = packed('idle');
    const start = { ...walker.deck! };
    for (let tick = 0; tick < 300 && walker.order.type === 'move'; tick++) stepGame(game);
    expect(start.x).toBeLessThan(-140);
    expect(Math.hypot(walker.deck!.x - 60, walker.deck!.y)).toBeLessThan(10);
    // Those who stepped aside walked there and stand idle again.
    for (let tick = 0; tick < 100; tick++) stepGame(game);
    expect(others.map(unit => unit.order.type)).toEqual(['idle', 'idle', 'idle']);
    expect([ship.x, ship.y, ship.sailing!.heading]).toEqual([2000, 2000, 0]);
  });
  it('does not move crew holding their ground', () => {
    const { game, walker, others } = packed('hold');
    const start = { ...walker.deck! }, posts = others.map(unit => ({ ...unit.deck! }));
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(walker.deck).toEqual(start);
    expect(others.map(unit => ({ ...unit.deck! }))).toEqual(posts);
  });
});
