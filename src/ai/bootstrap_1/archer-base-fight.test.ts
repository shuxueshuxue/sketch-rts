import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapCommands } from './policy';

// @@@archer-one-voice: the general defending its natural is the only voice that moves the army there.
it.each(['grove', 'ember'] as const)('%s leaves a base fight to its general instead of walking the group home', race => {
  const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
  const melee = race === 'grove' ? 'footman' : 'ashWarden';
  const raider = race === 'grove' ? 'emberRavager' : 'lancer';
  let scene = sketchScene('archer-base-fight').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: race === 'grove' ? 'ember' : 'grove', team: 'b' })
    .playerState('us', { gold: 0 }).townHall('us', 500, 500).townHall('us', 1900, 1900).townHall('foe', 3500, 3500);
  for (let index = 0; index < 3; index++) scene = scene.unit('us', melee, 2080, 2000 + index * 40, { id: `melee-${index}` });
  for (let index = 0; index < 4; index++) scene = scene.unit('us', shooter, 1960, 1990 + index * 35, { id: `shooter-${index}` });
  for (let index = 0; index < 7; index++) scene = scene.unit('foe', raider, 2400 + index % 2 * 30, 1960 + Math.floor(index / 2) * 40,
    { order: { type: 'attackMove', x: 1900, y: 1900 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  const walkedHome: string[] = [];
  for (let tick = 0; tick < 150; tick++) {
    if (tick % 15 === 0) {
      const commands = planBootstrapCommands(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams });
      if (memory.v6?.general?.mode === 'defend' || memory.v6?.general?.mode === 'guard') for (const { scriptId, command } of commands) {
        if (scriptId === 'skirmishPreservation' && 'unitIds' in command
          && (command.unitIds.length > 1 || command.unitIds.some(id => id.startsWith('melee')))) walkedHome.push(...command.unitIds);
      }
      issueCommandFrame(game, commands.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
    }
    stepGame(game);
  }
  expect(memory.v6?.general?.mode).toMatch(/defend|guard/);
  expect(walkedHome).toEqual([]);
}, 30000);
