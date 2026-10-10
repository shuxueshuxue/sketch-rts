import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version hires at controlled $race camps against two opponents (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const kind = version === 'v9_archer' ? race === 'grove' ? 'archer' : 'sparkArcher'
    : version === 'v9_summoner' ? race === 'grove' ? 'summoner' : 'pyreCaller'
      : race === 'grove' ? 'knight' : 'ashChieftain';
  let scene = sketchScene('controlled-mercenary-purchase').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe-1', { race: 'grove', team: 'b' }).player('foe-2', { race: 'ember', team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 4000)
    .townHall('us', x(1400), 500).goldMine('natural', x(1688), 500, 4000)
    .townHall('foe-1', x(3300), 3300).townHall('foe-2', x(3300), 2400)
    .building('us', UNIT_DEFS[kind].trainedAt!, x(500), 800).farms('us', 5, x(400), 1000)
    .mercenaryCamp('swords', x(1300), 900, { hireKind: 'mercenary', cost: 160, stock: 3 })
    .mercenaryCamp('bows', x(1400), 900, { hireKind: 'contractArcher', cost: 145, stock: 3 })
    .mercenaryCamp('medics', x(1500), 900, { hireKind: 'fieldMedic', cost: 155, stock: 3 });
  for (let index = 0; index < 14; index++) scene = scene.worker('us', x(600 + index * 30), 600);
  for (let index = 0; index < 6; index++) scene = scene.unit('us', kind, x(1300 + index * 30), 900);
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  memory.v6 = { phase: 3 };
  expect(game.players.us!.gold).toBe(500);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams });
  const hires = entries.filter(entry => entry.command.type === 'hire');
  expect(hires.length, JSON.stringify(entries)).toBeGreaterThan(0);
  sdk.issue(entries.map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
  stepGame(game);
  expect(game.units.filter(unit => unit.owner === 'us' && ['mercenary', 'contractArcher', 'fieldMedic'].includes(unit.kind))).toHaveLength(hires.length);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(hires.reduce((sum, entry) => sum
    + game.mercenaryCamps.find(camp => entry.command.type === 'hire' && camp.id === entry.command.campId)!.cost, 0));
  expect(game.match.stats.goldSpent.us).toBeLessThanOrEqual(500);
  expect(game.players.us!.gold).toBeGreaterThanOrEqual(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
});

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  '$race shares its last two supply between hiring and training (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const kind = race === 'grove' ? 'lancer' : 'ashWarden';
    let scene = sketchScene('mercenary-supply-budget').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 4000)
      .townHall('us', x(1400), 500).goldMine('natural', x(1688), 500, 4000)
      .townHall('foe', x(3300), 3300).farms('us', 1, x(400), 1000)
      .building('us', UNIT_DEFS[kind].trainedAt!, x(500), 800)
      .mercenaryCamp('swords', x(1300), 900, { hireKind: 'mercenary', cost: 160, stock: 3 })
      .mercenaryCamp('bows', x(1400), 900, { hireKind: 'contractArcher', cost: 145, stock: 3 })
      .mercenaryCamp('medics', x(1500), 900, { hireKind: 'fieldMedic', cost: 155, stock: 3 });
    for (let index = 0; index < 12; index++) scene = scene.worker('us', x(600 + index * 30), 600);
    for (let index = 0; index < 4; index++) scene = scene.unit('us', kind, x(1300 + index * 30), 900);
    const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    memory.v6 = { phase: 3 };
    expect(game.players.us!.supplyCap - game.units.filter(unit => unit.owner === 'us')
      .reduce((sum, unit) => sum + UNIT_DEFS[unit.kind].supplyUsed, 0)).toBe(2);
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_knight', memory }, { teams: game.teams });
    expect(entries.filter(entry => entry.command.type === 'hire'), JSON.stringify(entries)).toHaveLength(1);
    sdk.issue(entries.map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
    stepGame(game);
    expect(game.units.filter(unit => unit.owner === 'us' && ['mercenary', 'contractArcher', 'fieldMedic'].includes(unit.kind))).toHaveLength(1);
    expect(game.match.stats.goldSpent.us).toBeLessThanOrEqual(500);
    expect(game.players.us!.gold).toBeGreaterThanOrEqual(0);
    expect(game.match.stats.unitsLost.us).toBe(0);
  });
