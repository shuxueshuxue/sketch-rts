import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { bootstrapPolicyContext } from './policy';
import { mercenaryControlUnitIds } from './mercenary-control';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror => (['retreat', 'camp'] as const).map(background => ({ version, race, mirror, background })))))) (
  '$version gives ordinary $race shooters in $background to the front instead of claiming a mercenary trip (mirror=$mirror)', ({ version, race, mirror, background }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mercenary-does-not-own-recovery').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('us', x(1400), 1000).townHall('foe', x(3500), 3500)
    .goldMine('main', x(716), 500, 6000).goldMine('natural', x(1616), 1000, 6000)
    .farms('us', 6, x(500), 2700).mercenaryCamp('spent-camp', x(background === 'camp' ? 1300 : 3500), background === 'camp' ? 1000 : 1800, { stock: 0 });
  for (let index = 0; index < 3; index++) scene = scene.worker('us', x(600), 550 + index * 25);
  for (let index = 0; index < 4; index++) scene = scene.unit('us', race === 'grove' ? 'archer' : 'sparkArcher', x(1300), 950 + index * 30,
    { id: `shooter-${index}`, order: background === 'retreat'
      ? { type: 'move', x: x(500), y: 500, avoidCombat: true } : { type: 'hold', x: x(1300), y: 950 + index * 30 } });
  for (let index = 0; index < 6; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(1400), 1100 + index * 30);
  for (let index = 0; index < 2; index++) scene = scene.unit('foe', 'footman', x(1550), 1200 + index * 30,
    { id: `foe-${index}`, order: { type: 'attackMove', x: x(1400), y: 1000 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const claimed = mercenaryControlUnitIds(snapshotGame(game), 'us', bootstrapPolicyContext(snapshotGame(game), 'us', version, { memory, teams: game.teams }));
  let shots = 0;
  game.observer = { hit(source, target) { if (source.id.startsWith('shooter-') && target.owner === 'foe') shots++; } };
  for (let tick = 0; tick < 150; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams }).map(entry => ({ ...entry, playerId: 'us' })));
    stepGame(game);
  }
  expect([...claimed].some(id => id.startsWith('shooter-'))).toBe(false);
  expect(shots).toBeGreaterThan(0);
  expect(game.units.filter(unit => unit.id.startsWith('shooter-'))).toHaveLength(4);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
