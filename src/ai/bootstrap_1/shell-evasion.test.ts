import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiScript } from '../policy/types';
import { planShellEvasion, shellEvasion } from './shell-evasion';

function shellFight(evasion: boolean) {
  let scene = sketchScene('visible-shell').replaceDefaults().player('us', { race: 'grove' }).player('foe', { race: 'ember' })
    .townHall('us', 400, 400).townHall('foe', 2600, 2600).unit('foe', 'catapult', 1450, 600, { id: 'gun' });
  for (let index = 0; index < 5; index++) scene = scene.unit('us', 'archer', 850, 540 + index * 30, { id: `archer-${index}` });
  const game = scene.build().createGame();
  const ids = game.units.filter(unit => unit.owner === 'us').map(unit => unit.id);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ids });
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['gun'], targetId: 'archer-2' });
  while (game.projectiles.length === 0) stepGame(game);
  const initialHp = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.hp, 0);
  const flight = game.projectiles[0]!.remaining;
  const options = { memory: createAiPolicyMemory() };
  const marching: AiScript = { id: 'marching', phase: 'tactics', run: () => ({ type: 'attackMove', unitIds: ids, x: 850, y: 600 }) };
  const scripts = evasion ? [shellEvasion, marching] : [marching];
  for (let elapsed = 0; elapsed <= flight; elapsed++) {
    if (elapsed % 15 === 0) for (const entry of runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts, options)) {
      issuePlayerCommand(game, 'us', entry.command);
    }
    stepGame(game);
  }
  const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts, options);
  return { game, entries, damage: initialHp - game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.hp, 0) };
}

describe('bootstrap_1 visible shell evasion', () => {
  it('avoids a real catapult impact despite conflicting march orders, then returns control to the army', () => {
    const control = shellFight(false), candidate = shellFight(true);
    expect(control.damage).toBeGreaterThan(100);
    expect(candidate.damage).toBeLessThan(control.damage / 2);
    expect(candidate.game.units.filter(unit => unit.owner === 'us')).toHaveLength(5);
    expect(candidate.entries.some(entry => entry.scriptId === 'shellEvasion')).toBe(false);
    expect(candidate.entries.some(entry => entry.scriptId === 'marching')).toBe(true);
  });

  it('continues fighting when the incoming shot is an ordinary tracking arrow', () => {
    const game = sketchScene('tracking-arrow').replaceDefaults().player('us', { race: 'grove' }).player('foe', { race: 'grove' })
      .townHall('us', 400, 400).townHall('foe', 2600, 2600)
      .unit('us', 'archer', 900, 600, { id: 'target' }).unit('foe', 'archer', 1150, 600, { id: 'shooter' }).build().createGame();
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['shooter'], targetId: 'target' });
    while (game.projectiles.length === 0) stepGame(game);
    expect(planShellEvasion(snapshotGame(game), 'us', { memory: createAiPolicyMemory() })).toEqual([]);
  });
});
