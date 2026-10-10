import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version rotates its $race camp front before lethal focus fire (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('camp-focus-preservation').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .unit('neutral', 'ogreMage', x(2275), 1555, { id: 'mage-1' })
    .unit('neutral', 'ogreMage', x(2182), 1576, { id: 'mage-2' })
    .unit('neutral', 'ogreWarrior', x(2210), 1485, { id: 'brute' });
  const positions = [[2005, 1475], [1838, 1407], [1872, 1419], [1905, 1433], [1940, 1443]];
  for (const [index, point] of positions.entries()) scene = scene.unit('us', race === 'grove' ? 'lancer' : 'emberRavager',
    x(point[0]!), point[1]!, { id: `fighter-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  // This diagnostic measures camp clearing, rather than elimination of the idle opposing hall.
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const army = game.units.filter(unit => unit.owner === 'us');
  memory.v6 = { creep: { center: { x: x(2222), y: 1539 }, reach: 55,
    staging: { x: x(1885), y: 1428 }, stage: 'engage', since: 0, group: army.map(unit => unit.id) } };
  sdk.issue([{ playerId: 'us', scriptId: 'camp-entry', command: { type: 'attack', unitIds: ['fighter-0'], targetId: 'mage-2' } },
    { playerId: 'us', scriptId: 'camp-entry', command: { type: 'attackMove', unitIds: army.slice(1).map(unit => unit.id), x: x(2222), y: 1539 } }], {}, { checksum: false });
  const scripts = bootstrapScripts(version).filter(script => script.phase === 'tactics');
  let hurt = false;
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const commands = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options);
      sdk.issue(commands.map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
    }
    stepGame(game);
    hurt ||= army.some(unit => unit.hp < unit.maxHp);
  }
  const diagnostic = JSON.stringify(game.units.map(unit => ({ id: unit.id, hp: unit.hp, order: unit.order })));
  expect(hurt).toBe(true);
  expect(game.units.some(unit => unit.owner === 'neutral'), diagnostic).toBe(false);
  expect(army.every(unit => game.units.includes(unit)), diagnostic).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.match.winner).toBeNull();
});
