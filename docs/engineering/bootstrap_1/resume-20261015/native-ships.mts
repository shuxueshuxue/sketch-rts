// Run from the repository root: node --import tsx docs/engineering/bootstrap_1/resume-20261015/native-ships.mts
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, restoreSnapshotIntoGame, stepGame } from '../../../../src/shared/sim';
const saved = JSON.parse(gunzipSync(readFileSync(new URL('./baseline-9600.json.gz', import.meta.url))).toString());
const game = createGame('bareDuel');
restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
const ids = ['unit-p0-warship-1121', 'unit-p0-cutter-1303'];
const sample = () => ({ tick: game.tick, ships: game.units.filter(unit => ids.includes(unit.id))
  .map(({ id, x, y, hp, maxHp, order, sailing }) => ({ id, x, y, hp, maxHp, order, sailing })) });
const samples = [structuredClone(sample())];
for (let tick = 0; tick < 2400; tick++) {
  stepGame(game);
  if (game.tick % 600 === 0) samples.push(structuredClone(sample()));
}
console.log(JSON.stringify({ scope: 'Existing saved orders, no new commands, no AI decisions, unchanged ordinary resources', samples }, null, 2));
