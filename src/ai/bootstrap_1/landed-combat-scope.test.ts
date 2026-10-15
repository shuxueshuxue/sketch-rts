import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { sameGround, setBuildingBodies } from '../../shared/terrain';
import { planAiOwnerCommandEntries } from '../planner-context';
import { createAiPolicyMemory } from '../memory';
import { BOOTSTRAP_VERSIONS } from './policy';

it.each(BOOTSTRAP_VERSIONS)('%s does not borrow a distant same-island straggler as local cover', version => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-landed-before-think-100650.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const subject = game.units.find(unit => unit.id === 'unit-p0-archer-2351')!;
  const plan = () => planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory: structuredClone(saved.memories.p0) }, { teams: game.teams });
  const step = (entries: ReturnType<typeof plan>) => entries.find(({ scriptId, command }) => scriptId === 'naval'
    && command.type === 'move' && command.unitIds.includes(subject.id))?.command;
  const before = step(plan()); expect(before).toBeDefined();
  const terrain = game.map.terrain!;
  const far = Array.from(terrain.cells, (_, index) => ({ x: (index % terrain.cols + .5) * terrain.cell,
    y: (Math.floor(index / terrain.cols) + .5) * terrain.cell }))
    .filter(point => sameGround(game.map, subject, point))
    .sort((a, b) => Math.hypot(b.x - subject.x, b.y - subject.y) - Math.hypot(a.x - subject.x, a.y - subject.y))[0]!;
  expect(Math.hypot(far.x - subject.x, far.y - subject.y)).toBeGreaterThan(1000);
  game.units.push({ ...structuredClone(subject), id: 'distant-straggler', ...far, order: { type: 'idle' } });
  expect(step(plan())).toEqual(before);
});

it.each(BOOTSTRAP_VERSIONS)('%s focuses its actual island fight instead of a tempting target across the channel', version => {
  const game = sketchScene('local-expedition-focus').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .playerState('us', { gold: 0 }).townHall('us', 500, 500).townHall('foe', 3300, 3500)
    .unit('us', 'archer', 2464, 1700, { id: 'left' }).unit('us', 'archer', 2496, 1735, { id: 'right' })
    .unit('foe', 'priest', 2224, 1700, { id: 'across-channel', hp: 1 })
    .unit('foe', 'sparkArcher', 2800, 1700, { id: 'local-foe', hp: 12 }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = index % 128; return col < 25 || col >= 76 || col >= 65 && col < 71 ? '.' : '~';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  expect(sameGround(snapshot.map, game.units.find(unit => unit.id === 'left')!, game.units.find(unit => unit.id === 'across-channel')!)).toBe(false);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'us', version, memory: createAiPolicyMemory() }, { teams: game.teams });
  const attacks = entries.filter(({ scriptId, command }) => scriptId === 'naval' && command.type === 'attack');
  expect(attacks.some(({ command }) => command.type === 'attack' && command.targetId === 'local-foe')).toBe(true);
  expect(attacks.some(({ command }) => command.type === 'attack' && command.targetId === 'across-channel')).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(before);
});
