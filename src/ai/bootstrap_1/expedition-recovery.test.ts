import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version preserves its $race island front while clearing a camp (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('expedition-rotation').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(3000), 1800, { id: 'front' })
    .unit('us', race === 'grove' ? 'priest' : 'emberAcolyte', x(2850), 1680, { id: 'healer' })
    .unit('neutral', 'deepSnapper', x(3210), 1700, { id: 'brute' })
    .unit('neutral', 'tidePriest', x(3100), 1700, { id: 'guard' });
  for (let index = 0; index < 4; index++) scene = scene.unit('us', race === 'grove' ? 'archer' : 'sparkArcher',
    x(2810 + index % 2 * 35), 1560 + Math.floor(index / 2) * 35, { id: `shooter-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 25 || col >= 76 ? '.' : '~';
  }).join('') };
  const army = game.units.filter(unit => unit.owner === 'us');
  const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
  let hurt = false;
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      sdk.issue(runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options).map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
    }
    stepGame(game);
    hurt ||= army.some(unit => unit.hp < unit.maxHp);
  }
  const diagnostic = JSON.stringify(game.units.map(unit => ({ id: unit.id, hp: unit.hp, x: unit.x, y: unit.y, order: unit.order })));
  expect(hurt).toBe(true);
  expect(game.units.some(unit => unit.id === 'brute' || unit.id === 'guard'), diagnostic).toBe(false);
  expect(army.every(unit => game.units.includes(unit)), diagnostic).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.players.us!.gold).toBe(500 + UNIT_DEFS.deepSnapper.goldBounty! + UNIT_DEFS.tidePriest.goldBounty!);
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.match.winner).toBeNull();
});
