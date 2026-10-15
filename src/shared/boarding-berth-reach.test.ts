import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { boardingBerth, BOARDING_GAP } from './naval';
import { distanceToHull } from './ship-geometry';
import { hullFits, nearestShipPose } from './ship-navigation';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { walkableGoal, walkDestination } from './terrain';

function savedShore() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('../ai/bootstrap_1/fixtures/allied-mines-boarding-shore.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return game;
}

it('automatically boards the original shore workers using a reachable hull pose and survives JSON restoration', () => {
  const game = savedShore(), boat = game.units.find(unit => unit.id === 'boat')!;
  const workers = game.units.filter(unit => ['scene-respect-allied-mines-us-worker-2', 'scene-respect-allied-mines-us-worker-4'].includes(unit.id));
  const shore = walkDestination(game.map, workers[0]!, walkableGoal(game.map, boat.x, boat.y));
  const first = nearestShipPose(game.map, boat, walkableGoal(game.map, shore.x, shore.y, 'sea'))!;
  // The first terrain-clear pose is too far away. The search must continue
  // with the actual boarding predicate rather than give up at this pose.
  expect(distanceToHull({ ...boat, ...first, sailing: { ...boat.sailing!, heading: first.heading } }, shore))
    .toBeGreaterThan(workers[0]!.radius + BOARDING_GAP);
  const berth = boardingBerth(game.map, workers[0]!, boat);
  expect(berth).toBeDefined();
  expect(hullFits(game.map, boat, { ...berth!, heading: berth!.heading! })).toBe(true);
  expect(distanceToHull({ ...boat, ...berth!, sailing: { ...boat.sailing!, heading: berth!.heading! } }, berth!.shore!))
    .toBeLessThanOrEqual(workers[0]!.radius + BOARDING_GAP);
  issuePlayerCommand(game, 'us', { type: 'board', unitIds: workers.map(unit => unit.id), transportId: boat.id });
  for (let tick = 0; tick < 150; tick++) {
    stepGame(game);
    expect(hullFits(game.map, boat)).toBe(true);
  }
  const restored = createGame('bareDuel');
  restoreSnapshotIntoGame(restored, JSON.parse(JSON.stringify(snapshotGame(game))), game.nextId);
  for (let tick = 150; tick < 600; tick++) {
    stepGame(game);
    stepGame(restored);
    expect(hullFits(game.map, boat)).toBe(true);
  }
  expect(workers.every(unit => unit.deck?.shipId === boat.id)).toBe(true);
  expect(snapshotGame(restored)).toEqual(snapshotGame(game));
  expect(restored.nextId).toBe(game.nextId);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.match.winner).toBeNull();
}, 60000);

it('does not invent a boarding berth across an inaccessible rock coast', () => {
  const game = sketchScene('inaccessible-boarding-coast').map('bareDuel').replaceDefaults()
    .player('us').player('foe').townHall('us', 128, 64).townHall('foe', 128, 560)
    .worker('us', 128, 320, { id: 'worker' }).unit('us', 'transport', 600, 320, { id: 'boat' })
    .build().createGame();
  game.map = { ...game.map, width: 1024, height: 640, terrain: { cell: 32, cols: 32, rows: 20,
    cells: Array.from({ length: 32 * 20 }, (_, index) => index % 32 < 8 ? '.' : index % 32 < 12 ? '#' : '~').join('') } };
  const worker = game.units.find(unit => unit.id === 'worker')!, boat = game.units.find(unit => unit.id === 'boat')!;
  expect(boardingBerth(game.map, worker, boat)).toBeUndefined();
  issuePlayerCommand(game, 'us', { type: 'board', unitIds: [worker.id], transportId: boat.id });
  stepGame(game);
  expect(worker.deck).toBeUndefined();
  expect(boat.x).toBe(600);
  expect(boat.y).toBe(320);
  expect(hullFits(game.map, boat)).toBe(true);
});
