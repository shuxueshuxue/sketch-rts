import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { planMiningWorkforce } from './workforce';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function boardingScene(race: 'grove' | 'ember', mirror: boolean, passengers: number, risingMine: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('workforce-in-transit').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).goldMine('working', x(788), 500, 10000)
    .townHall('foe', x(200), 3000).farms('us', 7, x(400), 1500);
  if (risingMine) scene = scene.townHall('us', x(500), 2000, { complete: false })
    .goldMine('rising', x(788), 2000, 10000);
  for (let index = 0; index < 3; index++) scene = scene.worker('us', x(550 + index * 35), 600, { id: `home-${index}` });
  for (let index = 0; index < passengers; index++) scene = scene.worker('us', x(990), 750 + index * 35, { id: `passenger-${index}` });
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 31 ? '.' : col < 33 ? ',' : '~';
  }).join('') };
  const boat = game.spawnUnit('us', 'transport', x(1104), 880), sdk = new SdkCommandFrameRuntime(game);
  sdk.issue([{ playerId: 'us', scriptId: 'ordinary-boarding', command: { type: 'board', transportId: boat.id,
    unitIds: Array.from({ length: passengers }, (_, index) => `passenger-${index}`) } }], {}, { checksum: false });
  for (let tick = 0; tick < 1200 && game.units.filter(unit => unit.kind === 'worker' && unit.deck).length < passengers; tick++) stepGame(game);
  expect(game.units.filter(unit => unit.kind === 'worker' && unit.deck)).toHaveLength(passengers);
  expect(game.players.us!.gold).toBe(500);
  return { game, sdk };
}

it.each(cases)('$version counts $race workers already aboard rather than buying them again (mirror=$mirror)', ({ version, race, mirror }) => {
  const { game, sdk } = boardingScene(race, mirror, 8, false), memory = createAiPolicyMemory();
  memory.v6 = { phase: 3 };
  const snapshot = snapshotGame(game);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'us', version, memory }, { teams: game.teams });
  expect(entries.filter(entry => entry.command.type === 'train' && entry.command.unitKind === 'worker'), JSON.stringify(entries)).toEqual([]);
  expect(planMiningWorkforce(snapshot, 'us')).toEqual([]);
  expect(entries.some(entry => ['build', 'train', 'research'].includes(entry.command.type))).toBe(true);
  sdk.issue(entries, {}, { checksum: false });
  stepGame(game);
  expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker')).toHaveLength(11);
  expect(game.match.stats.unitsLost.us).toBe(0);
});

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  '$race still pays to recruit for a rising mine when transported workers cannot fill it (mirror=$mirror)', ({ race, mirror }) => {
    const { game, sdk } = boardingScene(race, mirror, 2, true);
    const commands = planMiningWorkforce(snapshotGame(game), 'us');
    expect(commands).toHaveLength(1);
    sdk.issue(commands.map(command => ({ playerId: 'us', scriptId: 'miningWorkforce', command })), {}, { checksum: false });
    for (let tick = 0; tick < 1000; tick++) stepGame(game);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker')).toHaveLength(6);
    expect(game.players.us!.gold).toBe(500 - UNIT_DEFS.worker.cost);
    expect(game.match.stats.unitsLost.us).toBe(0);
  });
