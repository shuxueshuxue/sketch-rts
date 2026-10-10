import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version clears with its gathered $race force while a late recruit walks in (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('camp-assembled-force').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).goldMine('home', x(788), 500, 4000)
    .townHall('us', x(500), 1000).goldMine('second', x(788), 1000, 4000)
    .townHall('peer', x(3900), 3500)
    .unit('neutral', 'wildling', x(1800), 500, { id: 'guard' })
    .unit('us', race === 'grove' ? 'footman' : 'ashWarden', x(3500), 3200, { id: 'recruit' });
  for (let index = 0; index < 8; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'ashWarden', x(900 + index * 15), 500, { id: `fighter-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  memory.v6 = { phase: 3 };
  const army = game.units.filter(unit => unit.owner === 'us');
  let initialGroup: string[] | undefined;
  let recruitTravelling = false;
  for (let tick = 0; tick < 900; tick++) {
    if (tick % 15 === 0) {
      sdk.issue(planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory },
        { teams: game.teams, policyMode: 'combat' }), {}, { checksum: false });
      if (tick === 0) initialGroup = memory.v6!.creep?.group.slice();
      if (tick === 15) {
        const recruit = game.units.find(unit => unit.id === 'recruit')!;
        recruitTravelling = recruit.order.type === 'move' && memory.v6!.creep !== undefined
          && !memory.v6.creep.group.includes(recruit.id);
      }
    }
    stepGame(game);
  }
  expect(game.units.some(unit => unit.id === 'guard')).toBe(false);
  expect(initialGroup).toEqual(army.filter(unit => unit.id !== 'recruit').map(unit => unit.id));
  expect(recruitTravelling).toBe(true);
  expect(army.every(unit => game.units.includes(unit))).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
