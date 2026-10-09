import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapCommands } from './policy';

describe('bootstrap_1 archer preservation', () => {
  it.each(['grove', 'ember'] as const)('finishes a %s pullback, receives ordinary healing and rejoins the army', race => {
    const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
    const scene = sketchScene('recovery-order-continuation').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: race === 'grove' ? 'ember' : 'grove', team: 'b' })
      .playerState('us', { gold: 0 }).townHall('us', 500, 500).townHall('foe', 3000, 3000)
      .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', 420, 620)
      .unit('us', shooter, 1000, 1400, { id: 'recovering', hp: 6 });
    for (let index = 0; index < 4; index++) scene.unit('us', shooter, 1800, 1000 + index * 45);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    let rejoined = false;
    for (let tick = 0; tick < 600; tick++) {
      if (tick % 15 === 0) {
        const recovering = game.units.find(unit => unit.id === 'recovering')!;
        const movingHome = recovering.order.type === 'move' && memory.unitClaims.recovering?.kind === 'retreat';
        const commands = planBootstrapCommands(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams });
        const recalled = commands.some(entry => entry.scriptId === 'v6General'
          && 'unitIds' in entry.command && entry.command.unitIds.includes('recovering'));
        if (movingHome) expect(recalled).toBe(false);
        if (recovering.hp >= recovering.maxHp * .36 && recalled) rejoined = true;
        issueCommandFrame(game, commands.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
      }
      stepGame(game);
    }
    expect(game.units.find(unit => unit.id === 'recovering')!.hp).toBeGreaterThanOrEqual(27);
    expect(rejoined).toBe(true);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it.each(['grove', 'ember'].flatMap(race => [false, true].map(recovering => ({ race: race as 'grove' | 'ember', recovering }))))(
    'keeps its $race critical volley while recovering=$recovering', ({ race, recovering }) => {
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
    if (recovering) scene = scene.unit('us', shooter, 950, 900, { id: 'recovering', hp: 6 });
    const game = scene.build().createGame();
    const commands = planBootstrapCommands(snapshotGame(game), 'us', 'v9_archer', { memory: createAiPolicyMemory(), teams: game.teams });
    expect(commands.some(entry => entry.scriptId === 'skirmishPreservation' && entry.command.type === 'attack'
      && entry.command.targetId === 'critical')).toBe(true);
    if (recovering) expect(commands.some(entry => entry.scriptId === 'skirmishPreservation'
      && entry.command.type === 'move' && entry.command.unitIds.includes('recovering'))).toBe(true);
    issueCommandFrame(game, commands.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
    for (let tick = 0; tick < 100; tick++) stepGame(game);
    expect(game.units.some(unit => unit.id === 'critical')).toBe(false);
    expect(game.match.stats.unitsKilled.us).toBeGreaterThanOrEqual(1);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
