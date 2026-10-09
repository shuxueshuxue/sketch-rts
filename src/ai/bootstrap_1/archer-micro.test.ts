import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapCommands } from './policy';

describe('bootstrap_1 archer preservation', () => {
  it.each(['grove', 'ember'] as const)('keeps its %s critical volley from being replaced by the main army move', race => {
    const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
    const enemy = race === 'grove' ? 'sparkArcher' : 'archer';
    let scene = sketchScene('critical-volley-before-withdrawal').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: race === 'grove' ? 'ember' : 'grove', team: 'b' })
      .player('ally', { team: 'b' }).playerState('us', { gold: 0 })
      .townHall('us', 500, 500).townHall('foe', 3000, 3000).townHall('ally', 3000, 1500)
      .unit('foe', enemy, 2070, 770, { id: 'critical', hp: 12,
        order: { type: 'attack', targetId: 'shooter-0' } });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', shooter, 1800, 700 + index * 45, { id: `shooter-${index}` });
    for (let index = 0; index < 8; index++) scene = scene.unit(index < 4 ? 'foe' : 'ally', enemy,
      2200 + index * 20, 720 + index * 15);
    const game = scene.build().createGame();
    const commands = planBootstrapCommands(snapshotGame(game), 'us', 'v9_archer', { memory: createAiPolicyMemory(), teams: game.teams });
    expect(commands.some(entry => entry.scriptId === 'skirmishPreservation' && entry.command.type === 'attack'
      && entry.command.targetId === 'critical')).toBe(true);
    issueCommandFrame(game, commands.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
    for (let tick = 0; tick < 100; tick++) stepGame(game);
    expect(game.units.some(unit => unit.id === 'critical')).toBe(false);
    expect(game.match.stats.unitsKilled.us).toBeGreaterThanOrEqual(1);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
