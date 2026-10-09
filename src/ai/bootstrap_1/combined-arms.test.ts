import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { seconds } from '../../shared/time';
import { createAiPolicyMemory } from '../memory';
import { strengthOf } from '../policy/v6/strength';
import { planBootstrapCommands, bootstrapPolicyContext } from './policy';

describe('bootstrap_1 infantry and engineering', () => {
  for (const race of ['grove', 'ember'] as const) {
    it(`${race} keeps its faster screen with the guns until both can fight the outpost`, () => {
      const fighter = race === 'grove' ? 'knight' : 'ashChieftain';
      const artillery = race === 'grove' ? 'ballista' : 'catapult';
      let scene = sketchScene(`combined-${race}`).map('openClaims').replaceDefaults()
        .player('us', { race }).player('foe', { race: 'grove' })
        .townHall('us', 500, 500).townHall('foe', 3400, 3300)
        .townHall('foe', 3300, 1200, { id: 'outpost' })
        .tower('foe', 3150, 1450, { id: 'tower' })
        .worker('foe', 3300, 3200).worker('foe', 3400, 3200).worker('foe', 3500, 3200);
      for (let i = 0; i < 6; i++) scene = scene.unit('us', fighter, 1700, 1100 + i * 50, { id: `screen-${i}` });
      scene = scene.unit('us', artillery, 650, 1150, { id: 'gun-a' }).unit('us', artillery, 650, 1350, { id: 'gun-b' });
      const game = scene.build().createGame();
      const memory = createAiPolicyMemory(), army = game.units.filter(unit => unit.owner === 'us');
      memory.v6 = { general: { mode: 'attack', targetHallId: 'outpost', target: { x: 3300, y: 1200 },
        group: army.map(unit => unit.id), groupStart: strengthOf(army) } };
      let fired = false, screenAtFirstShot = 0, marchGap = Infinity;
      for (let tick = 0; tick < seconds(160) && !fired; tick++) {
        if (tick % 15 === 0) {
          const snapshot = snapshotGame(game);
          const context = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
          const commands = planBootstrapCommands(snapshot, 'us', 'v9_knight', context);
          issueCommandFrame(game, commands.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
        }
        stepGame(game);
        if (tick === seconds(20)) {
          const guns = game.units.filter(unit => unit.id === 'gun-a' || unit.id === 'gun-b');
          const center = { x: guns.reduce((sum, unit) => sum + unit.x / guns.length, 0),
            y: guns.reduce((sum, unit) => sum + unit.y / guns.length, 0) };
          expect(memory.v6!.general!.mode).toBe('attack');
          const group = memory.v6!.general!.group!;
          marchGap = Math.max(...game.units.filter(unit => unit.kind === fighter && group.includes(unit.id))
            .map(unit => Math.hypot(unit.x - center.x, unit.y - center.y)));
        }
        fired = game.projectiles.some(projectile => projectile.owner === 'us' && ['gun-a', 'gun-b'].includes(projectile.attackerId));
        if (fired) screenAtFirstShot = game.units.filter(unit => unit.owner === 'us' && unit.kind === fighter).length;
      }
      expect(fired, JSON.stringify({ general: memory.v6, units: game.units.map(({ id, kind, x, y, hp, order }) => ({ id, kind, x, y, hp, order })) })).toBe(true);
      expect(marchGap).toBeLessThan(700);
      expect(screenAtFirstShot).toBe(6);
      expect(game.units.find(unit => unit.id === 'gun-a')!.hp).toBeGreaterThan(0);
      expect(game.units.find(unit => unit.id === 'gun-b')!.hp).toBeGreaterThan(0);
    }, 15000);
  }
});
