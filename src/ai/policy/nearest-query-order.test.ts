import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { aiSnapshotQuery } from './snapshot';
import { nearestEntity } from './spatial';

it('answers a nearest-unit question without changing the shared query order used by later scripts', () => {
  const game = sketchScene('shared-nearest-query').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).townHall('us', 500, 500)
    .unit('us', 'footman', 1400, 500, { id: 'first' })
    .unit('us', 'footman', 800, 500, { id: 'nearest' })
    .unit('us', 'footman', 1100, 500, { id: 'last' }).build().createGame();
  const query = aiSnapshotQuery(snapshotGame(game)), units = query.unitsFor('us');
  expect(nearestEntity(units, { x: 500, y: 500 })!.id).toBe('nearest');
  expect(query.unitsFor('us').map(unit => unit.id)).toEqual(['first', 'nearest', 'last']);
});

it('selects the first tied minimum from a read-only collection', () => {
  const first = { x: 3, y: 4 }, second = { x: 4, y: 3 };
  expect(nearestEntity(Object.freeze([first, second]), { x: 0, y: 0 })).toBe(first);
});
