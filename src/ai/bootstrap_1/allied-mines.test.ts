import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import type { BootstrapAiVersion, RaceId } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { navalBudgetReserve, navalWant } from '../policy/naval';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

function colonyScene(race: RaceId, mirror: boolean, claim: 'hall' | 'miner', mainland: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('respect-allied-mines').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('ally', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 6000)
    .townHall('us', x(500), 3000).goldMine('natural', x(788), 3000, 6000)
    .townHall('foe', x(500), 3800).townHall('ally', x(3300), 3600)
    .goldMine('allied-island', x(3288), 800, 6000).goldMine('free-island', x(3000), 2500, 6000)
    .unit('us', 'transport', x(1000), 1800, { id: 'boat' });
  if (claim === 'hall') scene = scene.townHall('ally', x(3000), 800);
  else scene = scene.worker('ally', x(3288), 840,
    { order: { type: 'mine', resourceId: 'allied-island', phase: 'toMine', timer: 0 } })
    .worker('ally', x(3288), 870,
      { order: { type: 'mine', resourceId: 'allied-island', phase: 'toMine', timer: 0 } });
  if (mainland) {
    scene = scene.goldMine('allied-mainland', x(788), 1512, 6000);
    if (claim === 'hall') scene = scene.townHall('ally', x(500), 1512);
    else scene = scene.townHall('ally', x(500), 1000).worker('ally', x(788), 1552,
      { order: { type: 'mine', resourceId: 'allied-mainland', phase: 'toMine', timer: 0 } });
  }
  for (let index = 0; index < 5; index++) scene = scene
    .worker('us', x(550), 470 + index * 20, { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } })
    .worker('us', x(550), 2970 + index * 20, { order: { type: 'mine', resourceId: 'natural', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 25 || col >= 76 ? '.' : '~';
  }).join('') };
  stepGame(game);
  return game;
}

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    (['hall', 'miner'] as const).flatMap(claim => [false, true].map(mainland => ({ version, race, mirror, claim, mainland }))))));

it.each(cases)('$version ferries toward the free island instead of allied $claim claims ($race, mirror=$mirror, mainland=$mainland)',
  ({ version, race, mirror, claim, mainland }) => {
    const game = colonyScene(race, mirror, claim, mainland), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
    for (let tick = 0; tick < 300; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        sdk.issue(runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options).map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
      }
      stepGame(game);
    }
    expect(memory.naval?.island?.plan?.mineId).toBe('free-island');
    expect(memory.naval?.ferries?.boat?.targetId).toBe('free-island');
    expect(game.units.find(unit => unit.id === 'boat')!.order.type).toBe('move');
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.match.winner).toBeNull();
  });

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'recalls the $race ferry when an ally starts mining its reserved island (mirror=$mirror)', ({ race, mirror }) => {
    const version: BootstrapAiVersion = 'v9_archer';
    const game = colonyScene(race, mirror, 'miner', false), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    game.resources.find(mine => mine.id === 'allied-island')!.amount = 0;
    const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
    const think = () => {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      sdk.issue(runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options).map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
    };
    think();
    expect(memory.naval?.ferries?.boat?.targetId).toBe('free-island');
    const miner = game.units.find(unit => unit.owner === 'ally' && unit.kind === 'worker')!;
    issuePlayerCommand(game, 'ally', { type: 'mine', unitIds: [miner.id], resourceId: 'free-island' });
    stepGame(game);
    think();
    expect(memory.naval?.ferries?.boat?.phase).toBe('return');
    expect(memory.naval?.island?.plan).toBeUndefined();
    expect(game.units.filter(unit => unit.owner === 'us').every(unit => !unit.deck && unit.order.type !== 'board')).toBe(true);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'releases the $race colony budget when the only live overseas mine belongs to an ally (mirror=$mirror)', ({ race, mirror }) => {
    const game = colonyScene(race, mirror, 'hall', false);
    game.teams.foe = game.teams.us;
    game.resources.find(mine => mine.id === 'free-island')!.amount = 0;
    game.resources.find(mine => mine.id === 'main')!.amount = 300;
    game.resources.find(mine => mine.id === 'natural')!.amount = 300;
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer',
      { memory: createAiPolicyMemory(), teams: game.teams });
    expect(navalBudgetReserve(snapshot, 'us', options)).toBe(0);
    expect(navalWant(snapshot, 'us', options)).toBeUndefined();
    expect(game.players.us!.gold).toBe(500);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
