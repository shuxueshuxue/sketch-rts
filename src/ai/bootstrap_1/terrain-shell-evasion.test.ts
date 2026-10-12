import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiScript } from '../policy/types';
import { shellEvasion } from './shell-evasion';

const cases = ([{ kind: 'worker', race: 'grove' }, { kind: 'worker', race: 'ember' },
  { kind: 'summoner', race: 'grove' }, { kind: 'summoner', race: 'ember' }] as const)
  .flatMap(row => [false, true].map(mirror => ({ ...row, mirror })));

it.each(cases)('gets a real $race $kind past a shell using its terrain arrival (mirror=$mirror)', ({ kind, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('mud-or-grass-shell-exit').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .unit('us', kind, x(1600), 1600, { id: 'target' })
    .unit('foe', 'catapult', x(2200), 1600, { id: 'gun' }).build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return col < 49 ? 'm' : '.';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['target'] });
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['gun'], targetId: 'target' });
  for (let tick = 0; tick < 600 && !game.projectiles.length; tick++) stepGame(game);
  expect(game.projectiles).toHaveLength(1);
  const flight = game.projectiles[0]!.remaining;
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['gun'] });
  let damage = 0, firstMove: { x: number; y: number } | undefined;
  game.observer = { hit(_source, target, amount) { if (target.id === 'target') damage += amount; } };
  const memory = createAiPolicyMemory();
  const marching: AiScript = { id: 'marching', phase: 'tactics', run: () =>
    ({ type: 'move', unitIds: ['target'], x: x(1600), y: 1600 }) };
  for (let tick = 0; tick <= flight + 15; tick++) {
    if (tick % 15 === 0) {
      const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [shellEvasion, marching], { memory, teams: game.teams });
      for (const entry of entries) if (!firstMove && entry.scriptId === 'shellEvasion' && entry.command.type === 'move')
        firstMove = { x: entry.command.x, y: entry.command.y };
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  const target = game.units.find(unit => unit.id === 'target')!;
  const released = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [shellEvasion, marching], { memory, teams: game.teams });
  console.log(JSON.stringify({ kind, race, mirror, flight, firstMove, damage, hp: target?.hp, lost: game.match.stats.unitsLost.us }));
  expect(target).toBeDefined();
  expect(damage).toBe(0);
  expect(target.hp).toBe(target.maxHp);
  expect(firstMove).toBeDefined();
  expect(released.some(entry => entry.scriptId === 'shellEvasion')).toBe(false);
  expect(released.some(entry => entry.scriptId === 'marching')).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
