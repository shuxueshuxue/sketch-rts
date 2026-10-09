import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { summonerTowerRush } from './tower-rush';

describe('summon host facing actual outpost attackers', () => {
  it.each((['grove', 'ember'] as const).flatMap(race => [-1, 1].map(side => ({ race, side }))))(
    'keeps the $race host behind its tower under artillery from side $side', ({ race, side }) => {
      const kind = race === 'grove' ? 'summoner' : 'pyreCaller';
      let scene = sketchScene('summon-outpost-flank').map('openClaims').replaceDefaults()
        .player('us', { race, team: 'a' }).player('foe', { race: 'ember', team: 'b' })
        .playerState('us', { gold: 0 }).townHall('us', 400, 300)
        .townHall('foe', 2600, 1500, { id: 'target' }).farms('us', 5, 400, 2600)
        .tower('us', 1500, 1500).unit('foe', 'catapult', 1500, 1500 + side * 600, { id: 'gun' });
      for (let index = 0; index < 6; index++) scene = scene.unit('us', kind,
        1475 + index % 2 * 30, 1500 - side * (150 + Math.floor(index / 2) * 35), { id: `caster-${index}` });
      const game = scene.build().createGame(), memory = createAiPolicyMemory();
      memory.jobs.push({ id: summonerTowerRush.id, kind: 'target', createdTick: 0, updatedTick: 0 });
      memory.v6 = { phase: 2, general: { mode: 'attack', target: { x: 2600, y: 1500 }, targetHallId: 'target' } };
      let damage = 0;
      game.observer = { hit(_source, target, amount) { if (target.owner === 'us' && 'kind' in target && target.kind === kind) damage += amount; } };
      issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['gun'] });
      for (let tick = 0; tick < 600; tick++) {
        if (tick % 15 === 0) {
          const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory, teams: game.teams });
          for (const { command } of runAiCommandEntriesFromScripts(snapshot, 'us', [summonerTowerRush], options)) issuePlayerCommand(game, 'us', command);
        }
        stepGame(game);
      }
      expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === kind)).toHaveLength(6);
      expect(damage).toBe(0);
      expect(game.match.stats.goldSpent.us).toBe(0);
    });
});
