import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS } from '../../shared/catalog';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { mineProspect } from '../../shared/mining-prospect';

it('measures the actual dying colony against the remaining safe free mine', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-dying-colony.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game), supply = snapshot.players.p0!.supplyUsed;
  const dying = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
  const safe = snapshot.resources.find(mine => mine.id === 'gold-seat2-main')!;
  expect(snapshot.players.p0!.gold).toBeGreaterThanOrEqual(BUILDING_DEFS.townHall.cost);
  expect(dying.amount).toBe(480);
  expect(mineProspect(snapshot, dying, 0, supply).netGold).toBe(151.68);
  expect(mineProspect(snapshot, dying, 0, supply).netGold).toBeLessThan(BUILDING_DEFS.townHall.cost);
  expect(mineProspect(snapshot, safe, 4000, supply).netGold).toBeGreaterThan(BUILDING_DEFS.townHall.cost);
});

it('forecasts the real rebase mine exhausted before its sea-road arrival, while its two actual miners are still working', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-dying-rebase.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game), mine = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
  expect(snapshot.tick).toBe(49125);
  expect(mine.amount).toBe(250);
  expect(snapshot.units.filter(unit => unit.order.type === 'mine' && unit.order.resourceId === mine.id)).toHaveLength(2);
  const prospect = mineProspect(snapshot, mine, 2390, snapshot.players.p0!.supplyUsed);
  expect(prospect.amountAtArrival).toBe(0);
  // Matched native replay depleted at 50745, 1620 ticks later. Body steering
  // remains execution work; the economic model must be within one mining cycle.
  expect(Math.abs(prospect.depletionTicks! - 1620)).toBeLessThan(150);
});

it.each([1, 2, 5].flatMap(count => [false, true].map(mud => ({ count, mud })) ))(
  'projects the next native mining interval with $count admitted workers (mud=$mud)', ({ count, mud }) => {
  let scene = sketchScene('mine-prospect').map('bareDuel').replaceDefaults().player('us', { team: 'a' })
    .player('foe', { team: 'b' }).townHall('us', 500, 500).goldMine('mine', 716, 500, 2000);
  for (let index = 0; index < count; index++) scene = scene.worker('us', 550, 650 + index * 30,
    { order: { type: 'mine', resourceId: 'mine', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(); game.scriptedVictory = true;
  if (mud) game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: 'm'.repeat(128 * 128) };
  for (let tick = 0; tick < 600; tick++) stepGame(game);
  const snapshot = snapshotGame(game), mine = snapshot.resources.find(mine => mine.id === 'mine')!;
  const prospect = mineProspect(snapshot, mine, 600, snapshot.players.us!.supplyUsed);
  for (let tick = 0; tick < 600; tick++) stepGame(game);
  expect(Math.abs(prospect.amountAtArrival - game.resources.find(mine => mine.id === 'mine')!.amount)).toBeLessThanOrEqual(20);
});

it('accounts for rival miners taking the same finite mine before arrival', () => {
  let scene = sketchScene('contested-mine-prospect').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 1000, 500).goldMine('mine', 716, 500, 2000);
  for (const owner of ['us', 'foe']) for (let index = 0; index < 2; index++) scene = scene.worker(owner, owner === 'us' ? 550 : 950,
    650 + index * 30, { order: { type: 'mine', resourceId: 'mine', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(); game.scriptedVictory = true;
  for (let tick = 0; tick < 600; tick++) stepGame(game);
  const snapshot = snapshotGame(game), mine = snapshot.resources.find(mine => mine.id === 'mine')!;
  const prospect = mineProspect(snapshot, mine, 600, snapshot.players.us!.supplyUsed);
  const withoutRivals = { ...snapshot, units: snapshot.units.filter(unit => unit.owner !== 'foe') };
  expect(mineProspect(withoutRivals, mine, 600, snapshot.players.us!.supplyUsed).amountAtArrival).toBeGreaterThan(prospect.amountAtArrival);
  for (let tick = 0; tick < 600; tick++) stepGame(game);
  expect(Math.abs(prospect.amountAtArrival - game.resources.find(mine => mine.id === 'mine')!.amount)).toBeLessThanOrEqual(20);
});

it('uses native per-load rounding at the supplied population, including a partial final load', () => {
  const game = sketchScene('rounded-mine-prospect').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).goldMine('mine', 716, 500, 487).build().createGame();
  const snapshot = snapshotGame(game), mine = snapshot.resources[0]!;
  expect(mineProspect(snapshot, mine, 0, 105).netGold).toBe(153.89);
  expect(mineProspect(snapshot, mine, 0, 40).netGold).toBe(487);
});
