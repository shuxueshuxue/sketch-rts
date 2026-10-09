import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapCloseout } from './mine-defense';

describe('bootstrap cleanup reinforcements', () => {
  it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
    (['grove', 'ember'] as const).map(race => ({version, race}))))(
    'replaces expired $race crew members through normal summoning in $version', ({version, race}) => {
      const caller = race === 'grove' ? 'summoner' : 'pyreCaller';
      const fighter = race === 'grove' ? 'footman' : 'emberRavager';
      let scene = sketchScene('expired-cleanup-crew').map('openClaims').replaceDefaults()
        .player('us', { race, team: 'a' }).player('beaten', { team: 'b' }).player('active', { team: 'b' })
        .playerState('us', { gold: 0 }).townHall('us', 500, 500)
        .building('beaten', 'farm', 3300, 2100, { id: 'last-farm' }).townHall('active', 3500, 3400)
        .farms('us', 8, 400, 1600).unit('us', fighter, 600, 500, { id: 'survivor', order: { type: 'hold', x: 600, y: 500 } });
      for (let i = 0; i < 3; i++) scene = scene.unit('us', caller, 2700 + i * 40, 1900, { id: `caster-${i}` })
        .worker('active', 3500 + i * 35, 3300);
      for (let i = 0; i < 7; i++) scene = scene.unit('us', fighter, 800 + i * 35, 1100,
        { id: `main-${i}`, order: { type: 'hold', x: 800 + i * 35, y: 1100 } });
      const game = scene.build().createGame(), memory = createAiPolicyMemory();
      const summon = () => {
        for (const caster of game.units.filter(unit => unit.owner === 'us' && unit.kind === caller)) issuePlayerCommand(game, 'us', {
          type: 'cast', unitId: caster.id, ability: race === 'grove' ? 'summon' : 'cinderSoul', x: caster.x + 180, y: caster.y + 40,
        });
        for (let tick = 0; tick < 30; tick++) stepGame(game);
      };
      summon();
      const expired = game.units.filter(unit => unit.kind === 'spirit').map(unit => unit.id);
      expect(expired).toHaveLength(3);
      while (game.units.some(unit => expired.includes(unit.id))) stepGame(game);
      summon();
      memory.v6 = { phase: 3, closeout: { unitIds: ['survivor', ...expired.slice(0, 2)], targetId: 'last-farm', sinceTick: 0 } };
      for (let tick = 0; tick < 600; tick++) {
        if (tick % 15 === 0) {
          const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
          for (const { command } of runAiCommandEntriesFromScripts(snapshot, 'us', [
            { ...AI_SCRIPT_LIBRARY.v6Closeout, run: planBootstrapCloseout },
          ], options)) issuePlayerCommand(game, 'us', command);
        }
        stepGame(game);
      }
      expect(game.buildings.some(building => building.id === 'last-farm')).toBe(false);
      expect(game.units.filter(unit => unit.id.startsWith('main-')).every(unit => unit.y === 1100 && unit.hp === unit.maxHp)).toBe(true);
      expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === caller)).toHaveLength(3);
      expect(game.match.stats.goldSpent.us).toBe(0);
    });
});
