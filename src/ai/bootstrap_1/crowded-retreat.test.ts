import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version withdraws its focused $race mercenary through a free body corridor (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('crowded-camp-retreat').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(1200), 1200).townHall('peer', x(3500), 3500)
    .unit('us', 'mercenary', x(2864), 2310, { id: 'patient', hp: 106 })
    .unit('us', 'mercenary', x(2802), 2317, { id: 'partner', hp: 140 })
    .unit('neutral', 'ogreLord', x(2909), 2321, { id: 'lord',
      order: { type: 'attack', targetId: 'patient', leashX: x(2878), leashY: 2325 } });
  for (const [index, [px, py]] of [[2834, 2292], [2801, 2281], [2801, 2249], [2867, 2271], [2834, 2257]].entries())
    scene = scene.unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(px!), py!, { id: `front-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  const army = game.units.filter(unit => unit.owner === 'us'), patient = army.find(unit => unit.id === 'patient')!;
  memory.v6 = { creep: { center: { x: x(2931), y: 2341 }, reach: 55,
    staging: { x: x(2639), y: 2138 }, stage: 'engage', since: 0, group: army.map(unit => unit.id) } };
  sdk.issue([{ playerId: 'us', scriptId: 'camp-entry', command: { type: 'attack', unitIds: army.map(unit => unit.id), targetId: 'lord' } }], {}, { checksum: false });
  for (let tick = 0; tick < 1200; tick++) {
    if (tick % 15 === 0) sdk.issue(planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory }, { teams: game.teams, policyMode: 'combat' }), {}, { checksum: false });
    stepGame(game);
  }
  const diagnostic = JSON.stringify(game.units.map(unit => ({ id: unit.id, hp: unit.hp, order: unit.order })));
  expect(game.units.includes(patient), diagnostic).toBe(true);
  expect(army.every(unit => game.units.includes(unit)), diagnostic).toBe(true);
  expect(game.units.some(unit => unit.id === 'lord'), diagnostic).toBe(false);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
