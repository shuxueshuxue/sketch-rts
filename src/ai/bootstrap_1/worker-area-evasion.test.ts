import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { STORM_STAFF } from '../../shared/item-rules';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { shellEvasion } from './shell-evasion';

function mineCycle(race: 'grove' | 'ember', evasion: boolean) {
  let scene = sketchScene('storm-over-working-miners').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 0 })
    .townHall('us', 1328, 1600).goldMine('main', 1616, 1600, 10000).townHall('foe', 3500, 3500)
    .unit('foe', 'footman', 1910, 1600, { id: 'caster' }).item('staff', 'stormStaff', 0, 0, { carrierId: 'caster' });
  for (let i = 0; i < 5; i++) scene = scene.worker('us', 1450, 1540 + i * 30, { id: `miner-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['caster'] });
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), resourceId: 'main' });
  for (let tick = 0; tick < 300; tick++) stepGame(game);
  const goldBefore = game.players.us!.gold;
  expect(goldBefore).toBeGreaterThan(0);
  issuePlayerCommand(game, 'foe', { type: 'useItem', unitId: 'caster', itemId: 'staff', x: 1600, y: 1600 });
  issuePlayerCommand(game, 'foe', { type: 'move', unitIds: ['caster'], x: 3500, y: 1600 });
  let damage = 0;
  game.observer = { hit(_source, target, taken) { if (target.id.startsWith('miner-')) damage += taken; } };
  const scripts = evasion ? [AI_SCRIPT_LIBRARY.economy, shellEvasion] : [AI_SCRIPT_LIBRARY.economy];
  for (let tick = 0; tick < STORM_STAFF.duration + 600; tick++) {
    if (tick % 15 === 14) issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts,
      { memory, teams: game.teams, requestedVersion: 'v9', version: 'v2' })
      .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
    stepGame(game);
  }
  return { game, memory, damage, goldBefore };
}

describe('mining workers under an area attack', () => {
  it.each(['grove', 'ember'] as const)('evacuates the %s mine and returns its real haulers after the storm', race => {
    const control = mineCycle(race, false), candidate = mineCycle(race, true);
    const { game, memory, damage, goldBefore } = candidate;
    expect(damage).toBeLessThan(control.damage);
    expect(game.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(5);
    expect(game.units.filter(unit => unit.id.startsWith('miner-')).every(unit => unit.order.type === 'mine')).toBe(true);
    expect(game.players.us!.gold).toBeGreaterThan(goldBefore);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(memory.jobs.some(job => job.kind.startsWith('shellEvasion:'))).toBe(false);
    const mined = 10000 - game.resources.find(mine => mine.id === 'main')!.amount;
    const carrying = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    expect(game.players.us!.gold + carrying).toBe(mined);
    console.log(JSON.stringify({ race, stormControl: control.damage, stormCandidate: damage,
      controlGold: control.game.players.us!.gold, candidateGold: game.players.us!.gold }));
  });
});
