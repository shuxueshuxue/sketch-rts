import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { STORM_STAFF } from '../../shared/item-rules';
import type { UnitKind } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiScript } from '../policy/types';
import { planShellEvasion, shellEvasion } from './shell-evasion';

function stormFight(kind: UnitKind, evasion: boolean, pursuit = 0) {
  const race = ['sparkArcher', 'pyreCaller', 'ashChieftain'].includes(kind) ? 'ember' : 'grove';
  let scene = sketchScene('storm-march-conflict').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 400, 400).townHall('foe', 3500, 3500)
    .unit('us', kind, 1600, 1600, { id: 'target' })
    .unit('foe', 'footman', 1910, 1600, { id: 'caster' })
    .item('staff', 'stormStaff', 0, 0, { carrierId: 'caster' });
  if (pursuit) scene = scene.unit('foe', 'footman', 1600 + pursuit * 180, 1500, { id: 'pursuer-a' })
    .unit('foe', 'footman', 1600 + pursuit * 180, 1700, { id: 'pursuer-b' });
  const game = scene.build().createGame();
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['target'] });
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['caster'] });
  let damage = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === 'target') damage += taken; } };
  issuePlayerCommand(game, 'foe', { type: 'useItem', unitId: 'caster', itemId: 'staff', x: 1600, y: 1600 });
  issuePlayerCommand(game, 'foe', { type: 'move', unitIds: ['caster'], x: 3500, y: 1600 });
  const memory = createAiPolicyMemory();
  const marching: AiScript = { id: 'marching', phase: 'tactics', run: () =>
    ({ type: 'attackMove', unitIds: ['target'], x: 1600, y: 1600 }) };
  const scripts = evasion ? [shellEvasion, marching] : [marching];
  // The spell can land just after a think. Observe it only at the next ordinary 15-tick decision.
  for (let elapsed = 0; elapsed <= (pursuit ? 60 : STORM_STAFF.duration + 15); elapsed++) {
    if (elapsed % 15 === 14) {
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts, { memory })
        .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
      if (pursuit && game.units.some(unit => unit.id === 'target')) issuePlayerCommand(game, 'foe',
        { type: 'attack', unitIds: ['pursuer-a', 'pursuer-b'], targetId: 'target' });
    }
    stepGame(game);
  }
  const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts, { memory });
  return { game, damage, entries, memory };
}

describe('bootstrap_1 sustained ground area evasion', () => {
  it.each([-1, 1])('evacuates a storm away from melee pursuit arriving from side %s', side => {
    const control = stormFight('horseArcher', false, side), candidate = stormFight('horseArcher', true, side);
    expect(candidate.game.units.some(unit => unit.id === 'target')).toBe(true);
    expect(candidate.damage).toBeLessThan(control.damage);
    expect(candidate.damage).toBe(36);
    console.log(JSON.stringify({ side, control: control.damage, candidate: candidate.damage }));
  });

  it.each(['horseArcher', 'sparkArcher', 'summoner', 'pyreCaller', 'knight', 'ashChieftain'] as const)(
    'moves the %s out of a real storm despite repeated army orders, then returns command', kind => {
      const control = stormFight(kind, false), candidate = stormFight(kind, true);
      expect(candidate.damage).toBeLessThan(control.damage);
      expect(candidate.game.units.some(unit => unit.id === 'target')).toBe(true);
      expect(candidate.entries.some(entry => entry.scriptId === 'shellEvasion')).toBe(false);
      expect(candidate.entries.some(entry => entry.scriptId === 'marching')).toBe(true);
      expect(candidate.memory.jobs.some(job => job.kind.startsWith('shellEvasion:'))).toBe(false);
      expect(candidate.game.match.stats.goldSpent.us).toBe(0);
      console.log(JSON.stringify({ kind, control: control.damage, candidate: candidate.damage }));
    });

  it('leaves allied ground effects under the army’s command', () => {
    const game = sketchScene('friendly-storm').map('openClaims').replaceDefaults()
      .player('us', { team: 'a' }).player('ally', { team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 400).townHall('ally', 3500, 400).townHall('foe', 3500, 3500)
      .unit('us', 'horseArcher', 1600, 1600, { id: 'target' })
      .unit('ally', 'footman', 1910, 1600, { id: 'caster' })
      .item('staff', 'stormStaff', 0, 0, { carrierId: 'caster' }).build().createGame();
    issuePlayerCommand(game, 'ally', { type: 'useItem', unitId: 'caster', itemId: 'staff', x: 1600, y: 1600 });
    expect(game.effects.some(effect => effect.type === 'storm')).toBe(true);
    expect(planShellEvasion(snapshotGame(game), 'us', { memory: createAiPolicyMemory(), teams: game.teams })).toEqual([]);
  });

  it('evacuates a real spark ignition and waits outside until it expires', () => {
    function fight(evasion: boolean) {
      const game = sketchScene('spark-ground-retreat').map('openClaims').replaceDefaults()
        .player('us', { race: 'ember', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
        .townHall('us', 400, 400).townHall('foe', 3500, 3500)
        .unit('us', 'ashChieftain', 1600, 1600, { id: 'target' })
        .unit('foe', 'sparkArcher', 1800, 1600, { id: 'spark' }).build().createGame();
      issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['target'] });
      issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['spark'], targetId: 'target' });
      for (let tick = 0; tick < 500 && !game.effects.some(effect => effect.type === 'burningGround'); tick++) stepGame(game);
      const fire = game.effects.find(effect => effect.type === 'burningGround')!;
      expect(fire).toBeDefined();
      issuePlayerCommand(game, 'foe', { type: 'move', unitIds: ['spark'], x: 3500, y: 1600 });
      let damage = 0;
      game.observer = { hit(_source, target, taken) { if (target.id === 'target') damage += taken; } };
      const memory = createAiPolicyMemory();
      const holding: AiScript = { id: 'holding', phase: 'tactics', run: () =>
        ({ type: 'holdPosition', unitIds: ['target'] }) };
      for (let tick = 0; tick <= fire.duration + 15; tick++) {
        if (tick % 15 === 0) issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
          evasion ? [shellEvasion, holding] : [holding], { memory })
          .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
        stepGame(game);
      }
      expect(game.effects.some(effect => effect.id === fire.id)).toBe(false);
      expect(planShellEvasion(snapshotGame(game), 'us', { memory })).toEqual([]);
      expect(game.match.stats.goldSpent.us).toBe(0);
      return damage;
    }
    const control = fight(false), candidate = fight(true);
    expect(candidate).toBeLessThan(control);
    console.log(JSON.stringify({ fireControl: control, fireCandidate: candidate }));
  });
});
