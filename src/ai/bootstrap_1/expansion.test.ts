import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planV6General } from '../policy/v6/general';
import { planBootstrapEconomy } from './economy';
import { BOOTSTRAP_DOCTRINES, bootstrapPolicyContext } from './policy';

function scene() {
  let setup = sketchScene('escort-the-economy-mine').replaceDefaults()
    .player('us', { race: 'ember' }).player('foe', { race: 'grove' }).playerState('us', { gold: 400 })
    .townHall('us', 500, 500).goldMine('main', 788, 500, 4000)
    .townHall('us', 1400, 500).goldMine('natural', 1688, 500, 4000)
    .goldMine('third', 2300, 2000, 4000).townHall('foe', 2800, 500)
    .building('us', 'cinderSpire', 700, 850).building('us', 'emberForge', 500, 850)
    .farms('us', 4, 400, 1300);
  for (let index = 0; index < 6; index++) setup = setup.worker('us', 1350 + index * 30, 650);
  for (let index = 0; index < 6; index++) setup = setup.unit('us', 'sparkArcher', 1350 + index * 30, 750);
  for (let index = 0; index < 4; index++) setup = setup.unit('us', 'ashWarden', 1350 + index * 30, 850);
  for (let index = 0; index < 12; index++) setup = setup.unit('foe', 'knight', 2780 + index * 10, 450);
  return setup.build().createGame();
}

describe('bootstrap_1 coordinated expansion', () => {
  it('escorts and builds the clear mine requested by the economy while the old phase still asks for two bases', () => {
    const control = scene(), candidate = scene();
    const memories = [control, candidate].map(() => {
      const memory = createAiPolicyMemory();
      memory.v6 = { phase: 1 };
      return memory;
    });
    for (let tick = 0; tick < 900; tick++) {
      if (tick % 15 === 0) for (const [index, game] of [control, candidate].entries()) {
        const snapshot = snapshotGame(game);
        const context = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory: memories[index]!, teams: game.teams });
        const commands = planV6General(snapshot, 'us', index === 0 ? { ...context, doctrines: BOOTSTRAP_DOCTRINES.v9_archer } : context);
        for (const command of commands) issuePlayerCommand(game, 'us', command);
      }
      stepGame(control); stepGame(candidate);
    }
    const context = bootstrapPolicyContext(snapshotGame(candidate), 'us', 'v9_archer', { memory: memories[1]!, teams: candidate.teams });
    const mine = candidate.resources.find(resource => resource.id === 'third')!;
    const covered = (game: typeof candidate) => game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker'
      && Math.hypot(unit.x - mine.x, unit.y - mine.y) <= 650).length;
    expect(covered(control)).toBe(0);
    expect(covered(candidate)).toBeGreaterThanOrEqual(8);
    const construction = planBootstrapEconomy(snapshotGame(candidate), 'us', context)
      .filter(command => command.type === 'build' && command.buildingKind === 'townHall');
    expect(construction).toHaveLength(1);
    for (const command of construction) issuePlayerCommand(candidate, 'us', command);
    for (let tick = 0; tick < 1600; tick++) stepGame(candidate);
    expect(candidate.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
    expect(candidate.players.us!.gold).toBe(0);
  });
});
