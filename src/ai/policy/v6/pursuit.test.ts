import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../../shared/sim';
import { createAiPolicyMemory } from '../../memory';
import { planV6General } from './general';

describe('V9 pursuit direction', () => {
  it.each(['grove', 'ember'] as const)('the %s front pursues a retreat but regroups when enemies are advancing', race => {
    function march(retreating: boolean) {
      let scene = sketchScene('pursuit-direction').map('openClaims').replaceDefaults()
        .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
        .townHall('us', 500, 500).townHall('foe', 3400, 3300).farms('us', 8, 400, 2200);
      for (let i = 0; i < 8; i++) scene = scene.unit('us', race === 'grove' ? 'horseArcher' : 'sparkArcher',
        1300 + i % 4 * 30, 1300 + Math.floor(i / 4) * 30, { id: `front-${i}` });
      for (let i = 0; i < 3; i++) scene = scene.unit('foe', 'footman', 1800 + i * 30, 1700, { id: `contact-${i}` });
      for (let i = 0; i < 30; i++) scene = scene.unit('foe', 'footman', 3300 + i % 6 * 30, 3300 + Math.floor(i / 6) * 30);
      const game = scene.build().createGame(), memory = createAiPolicyMemory();
      const cols = Math.ceil(game.map.width / 32), rows = Math.ceil(game.map.height / 32);
      game.map = { ...game.map, terrain: { cell: 32, cols, rows, cells: '.'.repeat(cols * rows) } };
      memory.v6 = { phase: 3, general: { mode: 'defend', target: { x: 1830, y: 1700 } } };
      issuePlayerCommand(game, 'foe', { type: 'attackMove', unitIds: ['contact-0', 'contact-1', 'contact-2'],
        x: retreating ? 2700 : 500, y: retreating ? 2700 : 500 });
      const gap = () => game.units.filter(unit => unit.owner === 'us')
        .reduce((total, unit) => total + Math.hypot(unit.x - 500, unit.y - 500), 0);
      const initialGap = gap();
      for (let tick = 0; tick < 60; tick++) {
        if (tick % 15 === 0) {
          const snapshot = snapshotGame(game);
          const commands = planV6General(snapshot, 'us', { version: 'v2', requestedVersion: 'v9', memory, teams: game.teams });
          issueCommandFrame(game, commands.map(command => ({ command, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
        }
        stepGame(game);
      }
      expect(game.units.filter(unit => unit.owner === 'us')).toHaveLength(8);
      expect(game.match.stats.goldSpent.us).toBe(0);
      if (!retreating) expect(memory.v6!.general!.mode).toBe('hold');
      return gap() - initialGap;
    }
    expect(march(true)).toBeGreaterThan(0);
    expect(march(false)).toBeLessThan(0);
  });
});
