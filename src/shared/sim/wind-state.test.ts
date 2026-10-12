import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../sim';
import { createRoom } from '../rooms';
import { createSaveGameRecord, restoreGameFromSave } from '../savegame';
import { checksumGame } from './checksum';
import { DEFAULT_WIND, coursePerformance, getWind } from '../ship-wind';
import { shipPartMax } from '../ship-handling';
import { SIM_TICKS_PER_SECOND, seconds } from '../time';

function waterScene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.scriptedVictory = true;
  game.map.width = 4000; game.map.height = 3000;
  game.map.terrain = { cell: 40, cols: 100, rows: 75, cells: '~'.repeat(7500) };
  return game;
}

const room = { ...createRoom({ id: 'wind-state', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
function roundTrip(game: ReturnType<typeof createGame>) {
  const save = createSaveGameRecord(game, room, { id: 'wind-state' });
  const restored = restoreGameFromSave(JSON.parse(JSON.stringify(save)));
  // This isolated water scene deliberately has no buildings or victory objective.
  if (game.scriptedVictory !== undefined) restored.scriptedVictory = game.scriptedVictory;
  return restored;
}
function run(game: ReturnType<typeof createGame>, ticks: number) {
  for (let tick = 0; tick < ticks; tick++) stepGame(game);
}

describe('wind state in the shared simulation', () => {
  it('persists the new-game default and an explicitly changed wind through real save records', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    expect(game.map.wind).toEqual(DEFAULT_WIND);
    expect(game.map.wind).not.toBe(DEFAULT_WIND);
    expect(roundTrip(game).map.wind).toEqual(DEFAULT_WIND);
    const other = createGame('bareDuel', { aiPlayers: [] });
    expect(game.map.wind).not.toBe(other.map.wind);
    game.map.wind = { direction: -.73, speed: 37 };
    const restored = roundTrip(game);
    expect(restored.map.wind).toEqual(game.map.wind);
    expect(restored.map.wind).not.toBe(game.map.wind);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    expect(other.map.wind).toEqual(DEFAULT_WIND);
  });

  it('loads an ordinary v9 save without wind, trim or velocity fields and continues deterministically', () => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    ship.sailing!.heading = Math.PI / 4;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 2000, y: 2100 });
    run(game, seconds(2));
    const save = createSaveGameRecord(game, room, { id: 'v9-wind-state' });
    save.runtime.checksumVersion = 9;
    delete save.snapshot.map.wind;
    for (const unit of save.snapshot.units) {
      if (!unit.sailing) continue;
      delete unit.sailing.sail;
      delete unit.sailing.velocityX;
      delete unit.sailing.velocityY;
      if (unit.sailing.route) {
        delete unit.sailing.route.windKey;
        delete unit.sailing.route.windTried;
        delete unit.sailing.route.windTryX;
        delete unit.sailing.route.windTryY;
      }
    }
    const first = restoreGameFromSave(JSON.parse(JSON.stringify(save)));
    const second = restoreGameFromSave(JSON.parse(JSON.stringify(save)));
    first.scriptedVictory = second.scriptedVictory = true;
    for (let tick = 0; tick < seconds(4); tick++) {
      stepGame(first); stepGame(second);
      expect(getWind(first.map)).toEqual(getWind({ wind: DEFAULT_WIND }));
      expect(checksumGame(first)).toBe(checksumGame(second));
      for (const restored of [first, second]) {
        const hull = restored.units.find(unit => unit.id === ship.id)!;
        const sailing = hull.sailing!, sail = sailing.sail!;
        expect([hull.x, hull.y, sailing.heading, sailing.speed, sailing.velocityX, sailing.velocityY,
          sail.angle, sail.billow, sail.set].every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('isolates snapshot wind, sail trim, signed velocity and route progress from subsequent edits', () => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    game.map.wind = { direction: Math.PI, speed: 80 };
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 2050, y: 1500 });
    run(game, seconds(2));
    const snapshot = snapshotGame(game), saved = snapshot.units.find(unit => unit.id === ship.id)!;
    expect(snapshot.map).not.toBe(game.map);
    expect(snapshot.map.wind).not.toBe(game.map.wind);
    expect(saved.sailing).not.toBe(ship.sailing);
    expect(saved.sailing!.sail).not.toBe(ship.sailing!.sail);
    expect(saved.sailing!.route).not.toBe(ship.sailing!.route);
    const original = { wind: { ...game.map.wind! }, sail: { ...ship.sailing!.sail! }, velocityX: ship.sailing!.velocityX,
      point: { ...ship.sailing!.route!.points[0]! } };
    snapshot.map.wind!.speed = 3;
    saved.sailing!.sail!.angle = -2;
    saved.sailing!.sail!.set = .12;
    saved.sailing!.velocityX = -99;
    saved.sailing!.route!.points[0]!.x += 99;
    expect(game.map.wind).toEqual(original.wind);
    expect(ship.sailing!.sail).toEqual(original.sail);
    expect(ship.sailing!.velocityX).toBe(original.velocityX);
    expect(ship.sailing!.route!.points[0]).toEqual(original.point);
    run(game, 2);
    expect(snapshot.map.wind!.speed).toBe(3);
    expect(saved.sailing!.sail!.angle).toBe(-2);
    expect(saved.sailing!.velocityX).toBe(-99);
  });

  it.each(['forward', 'astern'] as const)('records actual signed world velocity while moving %s', direction => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    game.map.wind = { direction: 0, speed: 80 };
    ship.sailing!.heading = 0;
    const goalX = direction === 'forward' ? 2000 : 1360;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: goalX, y: 1500 });
    let moved = false;
    for (let tick = 0; tick < 20; tick++) {
      const before = { x: ship.x, y: ship.y };
      stepGame(game);
      expect(ship.sailing!.velocityX).toBe((ship.x - before.x) * SIM_TICKS_PER_SECOND);
      expect(ship.sailing!.velocityY).toBe((ship.y - before.y) * SIM_TICKS_PER_SECOND);
      if (Math.abs(ship.x - before.x) > 1e-7) {
        moved = true;
        expect(ship.sailing!.velocityX! * (direction === 'forward' ? 1 : -1)).toBeGreaterThan(0);
      }
    }
    expect(moved).toBe(true);
    expect(ship.sailing!.velocityY).toBe(0);
    expect(ship.sailing!.speed).toBeGreaterThan(0);
  });

  it('furls the sails and clears actual velocity after a stop command', () => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    game.map.wind = { direction: 0, speed: 80 };
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 2500, y: 1500 });
    run(game, seconds(3));
    expect(ship.sailing!.sail!.set).toBeGreaterThan(.8);
    expect(ship.sailing!.velocityX).toBeGreaterThan(0);
    issuePlayerCommand(game, 'player', { type: 'stop', unitIds: [ship.id] });
    const stopped = { x: ship.x, y: ship.y };
    run(game, seconds(3));
    expect({ x: ship.x, y: ship.y }).toEqual(stopped);
    expect(ship.sailing!.sail).toEqual({ mode: 'idle', angle: 0, billow: 0, set: 0 });
    expect(ship.sailing!.velocityX).toBe(0);
    expect(ship.sailing!.velocityY).toBe(0);
    expect(ship.sailing!.speed).toBe(0);
  });

  it.each([0, 80])('does not invent auxiliary propulsion after the rigging is destroyed (wind=%s)', windSpeed => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    game.map.wind = { direction: 0, speed: windSpeed };
    ship.shipParts = { ...shipPartMax(ship), rigging: 0 };
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 1700, y: 1500 });
    run(game, seconds(3));
    expect({ x: ship.x, y: ship.y }).toEqual({ x: 1400, y: 1500 });
    expect(ship.sailing!.speed).toBe(0);
    expect(ship.sailing!.velocityX).toBe(0);
    expect(coursePerformance(ship, game.map).auxiliarySpeed).toBe(0);
    expect(ship.sailing!.sail!.set).toBe(0);
  });

  it('restores a serialized mid-tack turn with identical wind, trim, velocity and every subsequent checksum', () => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    game.map.wind = { direction: Math.PI, speed: 80 };
    const beat = coursePerformance(ship, game.map).beatAngle;
    ship.sailing!.heading = beat;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 2050, y: 1500 });
    let crossed = false;
    for (let tick = 0; tick < seconds(75); tick++) {
      stepGame(game);
      // Starting on a legal close-hauled course means the first entry into
      // no-go after a substantial leg is the turn onto the opposite tack.
      if (game.tick > seconds(5) && ship.sailing!.sail?.mode === 'tacking'
        && coursePerformance(ship, game.map).noGo && ship.x > 1500) { crossed = true; break; }
    }
    expect(crossed).toBe(true);
    const restored = roundTrip(game), copied = restored.units.find(unit => unit.id === ship.id)!;
    expect(copied.sailing).toEqual(ship.sailing);
    expect(restored.map.wind).toEqual(game.map.wind);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    for (let tick = 0; tick < seconds(12); tick++) {
      stepGame(game); stepGame(restored);
      expect(copied.sailing).toEqual(ship.sailing);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(Math.sign(copied.sailing!.heading)).toBe(-1);
  });
});
