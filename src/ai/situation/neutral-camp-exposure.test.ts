import { expect, it } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import { canonicalGameState } from '../../shared/sim/checksum';
import { neutralCampExposure, unitAutoAcquireRadius } from './neutral-camp-exposure';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  game.spawnUnit('neutral', 'wildling', 1000, 1000);
  game.spawnUnit('neutral', 'ogreMage', 1100, 1000);
  game.spawnUnit('neutral', 'wildling', 2500, 2500);
  game.spawnUnit('player', 'archer', 500, 1000);
  return game;
}
it('exposes native camp grouping and immutable copied facts without mutating the world', () => {
  const game = scene(), snapshot = snapshotGame(game), before = canonicalGameState(game), facts = neutralCampExposure(snapshot);
  expect(facts.camps.map(camp => camp.memberIds.length)).toEqual([2, 1]);
  expect(facts.camps[0]!.members[0]).toMatchObject({ alertRadius: 150, assistRadius: 360, pursuitRadius: 650,
    responseRadius: 650, active: false, activeTargetId: null });
  expect(neutralCampExposure(snapshot)).toBe(facts);
  expect(canonicalGameState(game)).toEqual(before);
  expect(Object.isFrozen(facts.camps[0]!.camp.creeps)).toBe(true);
});
it('refreshes moving, activated and returning guards, even after in-place snapshot changes', () => {
  const snapshot = snapshotGame(scene()), first = neutralCampExposure(snapshot), creep = snapshot.units[0]!;
  creep.x += 75; creep.order = { type: 'attack', targetId: snapshot.units.at(-1)!.id, leashX: 1050, leashY: 1100 };
  const active = neutralCampExposure(snapshot);
  expect(active).not.toBe(first);
  expect(active.camps[0]!.members[0]).toMatchObject({ point: { x: 1075, y: 1000 }, responseOrigin: { x: 1050, y: 1100 }, active: true });
  expect(first.camps[0]!.members[0]!.point.x).toBe(1000);
  expect(first.camps[0]!.camp.creeps[0]!.x).toBe(1000);
  creep.order = { type: 'move', x: 1000, y: 1000 };
  expect(neutralCampExposure(snapshot).camps[0]!.members[0]).toMatchObject({ returning: true, active: false });
});
it('refreshes deaths and homes without retaining a stale camp member or inventing IDs', () => {
  const snapshot = snapshotGame(scene()); neutralCampExposure(snapshot);
  snapshot.units[0]!.hp = 0;
  let facts = neutralCampExposure(snapshot);
  expect(facts.camps.flatMap(camp => camp.memberIds)).not.toContain(snapshot.units[0]!.id);
  snapshot.units[1]!.homeX = 2500; snapshot.units[1]!.homeY = 2500;
  facts = neutralCampExposure(snapshot);
  expect(facts.camps).toHaveLength(1); expect(facts.camps[0]!.memberIds).toHaveLength(2);
});
it('reuses unchanged frozen camps across new snapshot wrappers and rebuilds only the changed camp', () => {
  const snapshot = snapshotGame(scene());
  snapshot.map.terrain = { cols: 1, rows: 1, cell: 3200, cells: '.' };
  snapshot.units[0]!.orderQueue = [{ type: 'move', x: 400, y: 500 }];
  const first = neutralCampExposure(snapshot), next = structuredClone(snapshot);
  next.map.terrain = snapshot.map.terrain; next.tick += 15;
  const stable = neutralCampExposure(next);
  expect(stable.tick).toBe(next.tick); expect(stable.camps).toBe(first.camps);
  next.units[0]!.orderQueue = [{ type: 'move', x: 450, y: 500 }];
  const changed = neutralCampExposure(next);
  expect(changed.camps[0]).not.toBe(first.camps[0]);
  expect(changed.camps[1]).toBe(first.camps[1]);
  expect(first.camps[0]!.camp.creeps[0]!.orderQueue).toEqual([{ type: 'move', x: 400, y: 500 }]);
  expect(changed.camps[0]!.camp.creeps[0]!.orderQueue).toEqual([{ type: 'move', x: 450, y: 500 }]);
  expect(neutralCampExposure(structuredClone(next))).toEqual(changed);
});
it('uses native acquisition modes rather than treating every cold camp as a 650-radius ban', () => {
  const snapshot = snapshotGame(scene()), unit = snapshot.units.at(-1)!;
  expect(unitAutoAcquireRadius(snapshot, unit, 'idle')).toBe(230);
  expect(unitAutoAcquireRadius(snapshot, unit, 'hold')).toBe(unit.attackRange);
  // The catalog archer has no weapon override: native attackMove acquires at 230.
  expect(unitAutoAcquireRadius(snapshot, unit, 'attackMove')).toBe(230);
  expect(unitAutoAcquireRadius(snapshot, unit, 'move')).toBe(0);
  expect(unitAutoAcquireRadius(snapshot, snapshot.units[0]!, 'idle')).toBe(150);
});
