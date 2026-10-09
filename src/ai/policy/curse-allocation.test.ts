import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { planAbilityCommands } from './spell-tactics';

describe('AI curse allocation', () => {
  it.each(['grove', 'ember'] as const)('uses three %s dispellers to remove three real summons in one command frame', race => {
    const kind = race === 'grove' ? 'witch' : 'ashHexer';
    let scene = sketchScene('simultaneous-summon-counters').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', 500, 500).townHall('foe', 3000, 3000);
    for (let index = 0; index < 3; index++) scene = scene
      .unit('us', kind, 900, 880 + index * 20, { id: `counter-${index}` })
      .unit('foe', 'summoner', 1250, 900 + index * 60, { id: `summoner-${index}` });
    const game = scene.build().createGame();
    issuePlayerCommand(game, 'foe', { type: 'setAutocast', unitIds: ['summoner-0', 'summoner-1', 'summoner-2'], ability: 'summon', enabled: false });
    for (let index = 0; index < 3; index++) issuePlayerCommand(game, 'foe', {
      type: 'cast', unitId: `summoner-${index}`, ability: 'summon', x: 1040 + index * 40, y: 900,
    });
    stepGame(game);
    expect(game.units.filter(unit => unit.kind === 'spirit')).toHaveLength(3);
    const commands = planAbilityCommands(snapshotGame(game), 'us', { version: 'v2', requestedVersion: 'v9', teams: game.teams });
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'abilities', source: 'external-agent', command })));
    stepGame(game);
    expect(game.units.filter(unit => unit.kind === 'spirit')).toHaveLength(0);
    expect(game.match.stats.unitsKilled.us).toBe(3);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it.each((['grove', 'ember'] as const).flatMap(race => [1, 3].map(targets => ({ race, targets }))))(
    'curses $targets ordinary enemies with $race casters and keeps unused spells ready', ({ race, targets }) => {
    const kind = race === 'grove' ? 'witch' : 'ashHexer';
    const ability = race === 'grove' ? 'curse' : 'ashCurse';
    let scene = sketchScene('ordinary-curse-allocation').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', 500, 500).townHall('foe', 3000, 3000);
    for (let index = 0; index < 3; index++) scene = scene.unit('us', kind, 900, 880 + index * 20, { id: `counter-${index}` });
    for (let index = 0; index < targets; index++) scene = scene.unit('foe', 'footman', 1040 + index * 40, 900);
    const game = scene.build().createGame();
    const commands = planAbilityCommands(snapshotGame(game), 'us', { version: 'v2', requestedVersion: 'v9', teams: game.teams });
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'abilities', source: 'external-agent', command })));
    stepGame(game);
    expect(game.units.filter(unit => unit.owner === 'foe' && unit.effects.some(effect => effect.type === 'curse'))).toHaveLength(targets);
    expect(game.units.filter(unit => unit.owner === 'us' && abilityCooldown(unit, ability) > 0)).toHaveLength(targets);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
