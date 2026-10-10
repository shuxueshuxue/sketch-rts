import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { EXPERIENCE_BOOK_XP } from '../../shared/unit-value';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version keeps a reserved veteran book away from a passing $race rookie (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const kind = race === 'grove' ? 'footman' : 'ashWarden';
  let scene = sketchScene('reserved-veteran-book').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500).farms('us', 7, x(400), 1500)
    .unit('us', kind, x(700), 700, { id: 'veteran' })
    .item('first-book', 'experienceBook', x(700), 700)
    .item('reserved-book', 'experienceBook', x(1300), 700);
  for (let index = 0; index < 5; index++) scene = scene.unit('us', kind, x(1300 + index * 25), 700, { id: `rookie-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const issue = (command: Parameters<typeof sdk.issue>[0][number]['command']) =>
    sdk.issue([{ playerId: 'us', scriptId: 'veteran-training', command }], {}, { checksum: false });
  issue({ type: 'pickupItem', unitId: 'veteran', itemId: 'first-book' });
  stepGame(game);
  issue({ type: 'useItem', unitId: 'veteran', itemId: 'first-book' });
  stepGame(game);
  const veteran = game.units.find(unit => unit.id === 'veteran')!;
  expect(veteran.xp).toBe(EXPERIENCE_BOOK_XP);
  expect(veteran.level).toBe(2);
  memory.v6 = { phase: 3 };
  const collectors = new Set<string>();
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory },
        { teams: game.teams, policyMode: 'combat' });
      for (const { command } of entries) if (command.type === 'pickupItem' && command.itemId === 'reserved-book') collectors.add(command.unitId);
      sdk.issue(entries, {}, { checksum: false });
    }
    stepGame(game);
  }
  const diagnostic = JSON.stringify({ collectors: [...collectors], task: memory.loot,
    army: game.units.filter(unit => unit.owner === 'us').map(unit => ({ id: unit.id, xp: unit.xp, level: unit.level, order: unit.order })) });
  expect([...collectors], diagnostic).toEqual(['veteran']);
  expect(veteran.xp, diagnostic).toBe(EXPERIENCE_BOOK_XP * 2);
  expect(veteran.level, diagnostic).toBe(3);
  expect(game.units.filter(unit => unit.id.startsWith('rookie-')).every(unit => unit.xp === 0), diagnostic).toBe(true);
  expect(memory.loot, diagnostic).toBeUndefined();
  expect(game.players.us!.gold).toBe(500);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
