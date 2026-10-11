import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version rotates an unmedicated $race island front without losses (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('unmedicated-expedition').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('peer', { team: 'a' })
      .townHall('us', x(500), 500).townHall('peer', x(500), 3500)
      .unit('neutral', 'deepSnapper', x(3210), 1700, { id: 'brute' })
      .unit('neutral', 'tidePriest', x(3100), 1700, { id: 'guard' });
    for (const [index, point] of [[3000, 1800], [2900, 1680], [2870, 1720]].entries()) {
      scene = scene.unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(point[0]!), point[1]!, { id: `front-${index}` });
    }
    for (let index = 0; index < 2; index++) scene = scene.unit('us', race === 'grove' ? 'archer' : 'sparkArcher',
      x(2810 + index * 35), 1560, { id: `shooter-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
      const col = mirror ? 127 - index % 128 : index % 128;
      return col < 25 || col >= 76 ? '.' : '~';
    }).join('') };
    const original = game.units.filter(unit => unit.owner === 'us');
    let hurt = false;
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 15 === 0) {
        sdk.issue(planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' },
          { teams: game.teams }), {}, { checksum: false });
      }
      stepGame(game);
      hurt ||= original.some(unit => unit.hp < unit.maxHp);
    }
    const diagnostic = JSON.stringify(original.map(unit => ({ id: unit.id, hp: unit.hp, x: unit.x, y: unit.y, order: unit.order })));
    expect(hurt).toBe(true);
    expect(game.units.some(unit => unit.id === 'brute' || unit.id === 'guard'), diagnostic).toBe(false);
    expect(original.every(unit => game.units.includes(unit)), diagnostic).toBe(true);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.players.us!.gold).toBe(500 + UNIT_DEFS.deepSnapper.goldBounty! + UNIT_DEFS.tidePriest.goldBounty!);
  });
