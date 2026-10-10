import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiScript } from '../policy/types';
import { planShellEvasion, shellEvasion } from './shell-evasion';

function crossingBolt(kind: 'archer' | 'sparkArcher' | 'horseArcher' | 'summoner', mirrored: boolean, delay: number, evasion: boolean) {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('visible-piercing-bolt').map('openClaims').replaceDefaults()
    .player('us', { race: kind === 'sparkArcher' ? 'ember' : 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .unit('foe', 'ballista', x(2120), 1600, { id: 'gun' });
  for (let i = 0; i < 3; i++) scene = scene.unit('us', kind, x(1600 + i * 60), 1600 + (i - 1) * 24, { id: `soldier-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const ids = game.units.filter(unit => unit.owner === 'us').map(unit => unit.id);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ids });
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['gun'], targetId: 'soldier-1' });
  for (let tick = 0; tick < 600 && !game.projectiles.length; tick++) stepGame(game);
  expect(game.projectiles).toHaveLength(1);
  const shot = game.projectiles[0]!;
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['gun'] });
  let damage = 0;
  game.observer = { hit(_source, target, amount) { if (target.owner === 'us') damage += amount; } };
  const marching: AiScript = { id: 'marching', phase: 'tactics', run: () =>
    ({ type: 'attackMove', unitIds: ids, x: x(1660), y: 1600 }) };
  const scripts = evasion ? [shellEvasion, marching] : [marching];
  for (let elapsed = 0; elapsed <= shot.duration + 15; elapsed++) {
    if (elapsed % 15 === delay) issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts, { memory })
      .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
    stepGame(game);
  }
  const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts, { memory });
  return { damage, entries, game };
}

it.each((['archer', 'sparkArcher', 'horseArcher', 'summoner'] as const).flatMap(kind => [false, true]
  .flatMap(mirrored => [0, 7, 14].map(delay => ({ kind, mirrored, delay }))))) (
  'leaves a real piercing ray before it hits ($kind, mirror=$mirrored, think-delay=$delay)', ({ kind, mirrored, delay }) => {
    const old = crossingBolt(kind, mirrored, delay, false), next = crossingBolt(kind, mirrored, delay, true);
    console.log(JSON.stringify({ kind, mirrored, delay, old: old.damage, next: next.damage }));
    expect(next.damage).toBeLessThanOrEqual(old.damage);
    if (delay < 14) expect(next.damage).toBeLessThan(old.damage);
    expect(next.game.units.filter(unit => unit.owner === 'us')).toHaveLength(3);
    expect(next.entries.some(entry => entry.scriptId === 'shellEvasion')).toBe(false);
    expect(next.entries.some(entry => entry.scriptId === 'marching')).toBe(true);
    expect(next.game.match.stats.goldSpent.us).toBe(0);
  });

it('keeps allied piercing fire under the ordinary army command', () => {
  const game = sketchScene('allied-piercing-bolt').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('ally', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).townHall('ally', 3500, 500).townHall('foe', 3500, 3500)
    .unit('ally', 'ballista', 2120, 1600, { id: 'gun' })
    .unit('foe', 'footman', 1660, 1600, { id: 'target' })
    .unit('us', 'archer', 1720, 1624).build().createGame();
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['target'] });
  issuePlayerCommand(game, 'ally', { type: 'attack', unitIds: ['gun'], targetId: 'target' });
  for (let tick = 0; tick < 600 && !game.projectiles.length; tick++) stepGame(game);
  expect(game.projectiles).toHaveLength(1);
  expect(planShellEvasion(snapshotGame(game), 'us', { memory: createAiPolicyMemory(), teams: game.teams })).toEqual([]);
});
