import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { planMedicalRecovery } from './medical-recovery';

const cases = (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror })));

function field(race: 'grove' | 'ember', mirror: boolean, instant = false, island = false) {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('medical-road-selection').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(3000), 3200).townHall('foe', x(500), 3500)
    .unit('us', 'priest', x(instant ? 1680 : 1800), 800, { id: 'healer' })
    .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(instant ? 1480 : 1400), 800,
      { id: 'across', hp: 80, order: { type: 'hold', x: x(instant ? 1480 : 1400), y: 800 } })
    .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(1800), 1300,
      { id: 'local', hp: 80, order: { type: 'hold', x: x(1800), y: 1300 } }).build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col === 50 && (island || Math.floor(index / 128) < 100) ? (island ? '~' : 'T') : '.';
  }).join('') };
  return { game, healer: game.units.find(unit => unit.id === 'healer')!,
    across: game.units.find(unit => unit.id === 'across')!, local: game.units.find(unit => unit.id === 'local')! };
}

it.each(cases)('heals the $race patient reached by the shorter road (mirror=$mirror)', ({ race, mirror }) => {
  const { game, healer, across, local } = field(race, mirror);
  expect(Math.hypot(healer.x - across.x, healer.y - across.y)).toBeLessThan(Math.hypot(healer.x - local.x, healer.y - local.y));
  expect(walkingDistance(game.map, healer, across)!).toBeGreaterThan(walkingDistance(game.map, healer, local)! * 4);
  const commands = planMedicalRecovery(snapshotGame(game), 'us', [across, local]);
  new SdkCommandFrameRuntime(game).issue(commands.map(command => ({ playerId: 'us', scriptId: 'medicalRecovery', command })), {}, { checksum: false });
  for (let tick = 0; tick < 180; tick++) stepGame(game);
  expect(local.hp).toBe(local.maxHp);
  expect(across.hp).toBe(80);
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
});

it.each(cases)('uses actual $race spell range for an immediate heal across a wall (mirror=$mirror)', ({ race, mirror }) => {
  const { game, across, local } = field(race, mirror, true);
  const commands = planMedicalRecovery(snapshotGame(game), 'us', [across, local]);
  new SdkCommandFrameRuntime(game).issue(commands.map(command => ({ playerId: 'us', scriptId: 'medicalRecovery', command })), {}, { checksum: false });
  stepGame(game);
  expect(across.hp).toBe(across.maxHp);
  expect(local.hp).toBe(80);
  expect(game.match.stats.goldSpent.us).toBe(0);
});

it.each(cases)('keeps an unreachable $race island patient out of road selection (mirror=$mirror)', ({ race, mirror }) => {
  const { game, healer, across, local } = field(race, mirror, false, true);
  expect(walkingDistance(game.map, healer, across)).toBeUndefined();
  const commands = planMedicalRecovery(snapshotGame(game), 'us', [across, local]);
  new SdkCommandFrameRuntime(game).issue(commands.map(command => ({ playerId: 'us', scriptId: 'medicalRecovery', command })), {}, { checksum: false });
  for (let tick = 0; tick < 180; tick++) stepGame(game);
  expect(local.hp).toBe(local.maxHp);
  expect(across.hp).toBe(80);
});
