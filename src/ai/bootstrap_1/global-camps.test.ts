import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version clears a reachable $race camp outside every hall’s old radius (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('global-camp-objective').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).goldMine('home', x(788), 500, 4000)
    .townHall('us', x(500), 1000).goldMine('second', x(788), 1000, 4000)
    .townHall('peer', x(3900), 3500)
    .unit('neutral', 'wildling', x(3400), 1300, { id: 'guard' });
  for (let index = 0; index < 8; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'ashWarden', x(900 + index * 15), 500);
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  memory.v6 = { phase: 3 };
  const army = game.units.filter(unit => unit.owner === 'us');
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 15 === 0) sdk.issue(planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' }), {}, { checksum: false });
    stepGame(game);
  }
  expect(game.units.some(unit => unit.id === 'guard')).toBe(false);
  expect(army.every(unit => game.units.includes(unit))).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
