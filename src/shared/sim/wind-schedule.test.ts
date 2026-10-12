import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../sim';
import { createRoom } from '../rooms';
import { createSaveGameRecord, restoreGameFromSave } from '../savegame';
import { checksumGame } from './checksum';
import { coursePerformance } from '../ship-wind';
import { getWind, WIND_CHANGE_INTERVAL_TICKS } from '../wind-field';
import { hullFits, hullPassageClear } from '../ship-navigation';
import { seconds } from '../time';

const interval = WIND_CHANGE_INTERVAL_TICKS;
function waterScene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.scriptedVictory = true;
  game.map.width = 4000; game.map.height = 3000;
  game.map.terrain = { cell: 40, cols: 100, rows: 75, cells: '~'.repeat(7500) };
  return game;
}
const room = { ...createRoom({ id: 'wind-schedule', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
function save(game: ReturnType<typeof createGame>) {
  return createSaveGameRecord(game, room, { id: 'wind-schedule' });
}
function restore(record: ReturnType<typeof save>) {
  const restored = restoreGameFromSave(JSON.parse(JSON.stringify(record)));
  restored.scriptedVictory = true;
  return restored;
}

describe('wind changes in the simulation', () => {
  it('changes the field before trimming and sailing on the exact boundary tick', () => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    game.map.wind = { direction: Math.PI, speed: 80 };
    ship.sailing!.heading = 0;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 3000, y: 1500 });
    game.tick = interval - 2;
    stepGame(game);
    expect(game.tick).toBe(9599);
    expect(game.map.wind.changedAtTick).toBeUndefined();
    expect(ship.sailing!.sail!.angle).toBe(0);
    const previousRoute = ship.sailing!.route;
    stepGame(game);
    expect(game.tick).toBe(9600);
    expect(game.map.wind!.changedAtTick).toBe(9600);
    expect(Math.abs(ship.sailing!.sail!.angle)).toBeGreaterThan(0);
    expect(ship.sailing!.route).not.toBe(previousRoute);
    expect(ship.sailing!.route!.windKey).toBe(getWind(game.map).key);
    const current = game.map.wind;
    for (let tick = 0; tick < seconds(2); tick++) {
      stepGame(game);
      expect(game.map.wind).toBe(current);
      expect(ship.sailing!.route!.windKey).toBe(getWind(game.map).key);
    }
  });

  it.each([false, true])('keeps an older save unchanged until its next boundary (wind missing=%s)', absent => {
    const game = waterScene();
    game.tick = interval + 17;
    if (absent) delete game.map.wind;
    else game.map.wind = { direction: .731, speed: 37 };
    const record = save(game);
    record.runtime.checksumVersion = absent ? 9 : 10;
    const resumed = restore(record), initial = getWind(game.map);
    for (let tick = 0; tick < seconds(2); tick++) {
      stepGame(game); stepGame(resumed);
      expect(getWind(resumed.map)).toEqual(initial);
      expect(resumed.map.wind?.changedAtTick).toBeUndefined();
      expect(checksumGame(resumed)).toBe(checksumGame(game));
    }
    game.tick = resumed.tick = interval * 2 - 1;
    stepGame(game); stepGame(resumed);
    expect(resumed.map.wind!.changedAtTick).toBe(interval * 2);
    expect(resumed.map.wind!.fromDirection).toBe(initial.direction);
    expect(resumed.map.wind!.fromSpeed).toBe(initial.speed);
    expect(checksumGame(resumed)).toBe(checksumGame(game));
  });

  it('isolates weather-event snapshots and resumes without replaying an already saved change', () => {
    const game = waterScene();
    game.tick = interval - 1; stepGame(game);
    const snapshot = snapshotGame(game), original = { ...game.map.wind! };
    const resumed = restore(save(game));
    expect(resumed.map.wind).toEqual(original);
    snapshot.map.wind!.changedAtTick = -1;
    snapshot.map.wind!.fromDirection = 0;
    snapshot.map.wind!.fromSpeed = 0;
    expect(game.map.wind).toEqual(original);
    for (let tick = 0; tick < seconds(3); tick++) {
      stepGame(game); stepGame(resumed);
      expect(resumed.map.wind).toEqual(original);
      expect(checksumGame(resumed)).toBe(checksumGame(game));
    }
    game.tick = resumed.tick = interval * 2 - 1;
    stepGame(game); stepGame(resumed);
    expect(game.map.wind!.fromDirection).toBe(original.direction);
    expect(game.map.wind!.changedAtTick).toBe(interval * 2);
    expect(checksumGame(resumed)).toBe(checksumGame(game));
    expect(snapshot.map.wind!.changedAtTick).toBe(-1);
  });

  it('replans a mid-tack voyage once at a weather boundary and restores identical movement', () => {
    const game = waterScene(), ship = game.spawnUnit('player', 'transport', 1400, 1500);
    game.map.wind = { direction: Math.PI, speed: 80 };
    ship.sailing!.heading = coursePerformance(ship, game.map).beatAngle;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 3000, y: 1500 });
    let turning = false;
    for (let tick = 0; tick < seconds(75); tick++) {
      stepGame(game);
      if (game.tick > seconds(5) && ship.x > 1500 && ship.sailing!.sail!.mode === 'tacking'
        && coursePerformance(ship, game.map).noGo) { turning = true; break; }
    }
    expect(turning).toBe(true);
    game.tick = interval - 1;
    const resumed = restore(save(game)), copy = resumed.units.find(unit => unit.id === ship.id)!;
    let route = ship.sailing!.route, changes = 0;
    for (let tick = 0; tick < seconds(12); tick++) {
      const before = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
      stepGame(game); stepGame(resumed);
      expect(checksumGame(resumed)).toBe(checksumGame(game));
      expect(copy.sailing).toEqual(ship.sailing);
      expect(hullFits(game.map, ship)).toBe(true);
      expect(hullPassageClear(game.map, ship, before, { x: ship.x, y: ship.y, heading: ship.sailing!.heading })).toBe(true);
      if (route !== ship.sailing!.route) { changes++; route = ship.sailing!.route; }
    }
    expect(changes).toBe(1);
    expect(ship.sailing!.route!.windKey).toBe(getWind(game.map).key);
    expect(game.map.wind!.changedAtTick).toBe(interval);
  });

  it('does not advance weather when a finished match refuses simulation steps', () => {
    const game = waterScene();
    game.tick = interval - 1; game.match.winner = 'player';
    const initial = game.map.wind;
    for (let tick = 0; tick < 50; tick++) stepGame(game);
    expect(game.tick).toBe(interval - 1);
    expect(game.map.wind).toBe(initial);
  });
});
