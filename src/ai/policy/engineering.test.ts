import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { engineeringWant } from './engineering';

describe('engineering force share', () => {
  it.each(['grove', 'ember'] as const)('keeps its %s support weapon budget through two ordinary summon waves', race => {
    const caster = race === 'grove' ? 'summoner' : 'pyreCaller';
    const engine = race === 'grove' ? 'ballista' : 'catapult';
    let scene = sketchScene('permanent-force-support').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 500 })
      .townHall('us', 500, 500).townHall('foe', 3200, 3200).farms('us', 8, 400, 1700)
      .building('us', 'workshop', 700, 850);
    for (let index = 0; index < 7; index++) scene = scene.unit('us', race === 'grove' ? 'archer' : 'sparkArcher', 1400 + index * 35, 1000);
    for (let index = 0; index < 2; index++) scene = scene
      .unit('us', caster, 900 + index * 40, 900, { id: `caster-${index}` })
      .unit('us', engine, 1100 + index * 100, 800);
    const game = scene.build().createGame(), options = { version: 'v2' as const, requestedVersion: 'v7' as const, memory: createAiPolicyMemory(), teams: game.teams };
    for (let tick = 0; tick < 1000; tick++) {
      if (tick === 0 || tick === 800) for (let index = 0; index < 2; index++) issuePlayerCommand(game, 'us',
        { type: 'cast', unitId: `caster-${index}`, ability: race === 'grove' ? 'summon' : 'cinderSoul', x: 1050 + index * 40, y: 1050 });
      if (tick === 800) expect(game.units.filter(unit => unit.kind === 'spirit')).toHaveLength(4);
      if (tick % 15 === 0) {
        const want = engineeringWant(snapshotGame(game), 'us', options);
        if (want) issuePlayerCommand(game, 'us', want.issue(new Set())!);
      }
      stepGame(game);
    }
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.players.us!.gold).toBe(500);
    expect(game.units.filter(unit => unit.kind === engine)).toHaveLength(2);
  });
});
