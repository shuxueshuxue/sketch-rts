import { expect, it } from 'vitest';
import snapshots from './fixtures/naval-shipyard-snapshots.json';
import { createNavalObstacleTracker } from './naval-obstacle-metrics';
import { createGame, snapshotGame } from '../../shared/sim';
import { createUnit } from '../../shared/map';
import { beginShipCollisionFrame, sweepShipCollision } from '../../shared/ship-collisions';
import type { GameMap, Unit } from '../../shared/types';

function scene(index: number) {
  const fixture = snapshots.cases[index]!;
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.map = structuredClone(snapshots.maps[fixture.map as keyof typeof snapshots.maps]) as unknown as GameMap;
  game.units = [structuredClone(fixture.ship) as unknown as Unit];
  game.buildings = structuredClone(fixture.buildings) as typeof game.buildings;
  game.obstacles = [];
  const ship = game.units[0]!, tracker = createNavalObstacleTracker();
  const context = { game, players: [ship.owner], match: {} as never };
  const state = tracker.create!(context);
  const sample = (second: number) => { game.tick = second * 20; tracker.afterStep!(state, { ...context, after: game }); };
  const result = () => tracker.finish(state, context as never)[ship.owner]!;
  return { game, ship, fixture, sample, result };
}

it.each([0, 1, 2, 3])('observes the saved shipyard contact without replacing the simulation collision frame (snapshot %s)', index => {
  const { game, ship, fixture, sample, result } = scene(index);
  // A deliberately empty original solid view detects accidental writes to its frame.
  beginShipCollisionFrame(game.units, game.map, []);
  const from = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
  expect(sweepShipCollision(game.map, ship, game.units, from, fixture.firstLeg)).toBeUndefined();
  game.tick = 20;
  const before = snapshotGame(game);
  sample(1);
  expect(snapshotGame(game)).toEqual(before);
  expect(sweepShipCollision(game.map, ship, game.units, from, fixture.firstLeg)).toBeUndefined();
  expect(result().immediateBlockSeconds).toBe(1);
  expect(result().ships[ship.id]!.episodes[0]!.first.obstruction.kind).toBe('shipyard');
});

it('keeps one hull price across repeated episodes, preserves peak cargo, and excludes an inactive leftover route', () => {
  const { game, ship, sample, result } = scene(0);
  const worker = createUnit('passenger', ship.owner, 'worker', ship.x, ship.y);
  worker.deck = { shipId: ship.id, x: 0, y: 0 }; game.units.push(worker);
  for (let second = 1; second <= 31; second++) sample(second);
  const order = ship.order; ship.order = { type: 'idle' }; sample(32);
  ship.order = order; sample(33);
  expect(result().conflictSeconds).toBe(32);
  expect(result().stationaryBlockSeconds).toBe(2);
  expect(Object.keys(result().ships)).toEqual([ship.id]);
  expect(result().ships[ship.id]).toMatchObject({ gold: 240, maxCargoGold: 75 });
  expect(result().ships[ship.id]!.episodes).toHaveLength(2);
  expect(result().ships[ship.id]!.episodes.map(episode => episode.maxExposedGold)).toEqual([315, 315]);
});
