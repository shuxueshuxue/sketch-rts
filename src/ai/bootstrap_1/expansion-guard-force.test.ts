import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { trainingBuildingFor } from '../../shared/catalog';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { BOOTSTRAP_DOCTRINES, bootstrapPolicyContext } from './policy';
import { rankBootstrapGoals } from './economy';

// @@@expansion-guard-force: the phase waits on the base, the base on its guard, the guard on soldiers the phase no longer
// asks for. The economy must still ask for them.
// The archer line's opening phase does not wait on its second base, so only these two can stall there.
it.each((['v9_knight', 'v9_summoner'] as const).flatMap(version => (['grove', 'ember'] as const).map(race => ({ version, race }))))(
  '$version $race trains for the camp guarding its next mine once its phase stops asking', ({ version, race }) => {
    const strategy = BOOTSTRAP_DOCTRINES[version].find(candidate => candidate.race === race)!;
    const standIn = strategy.standIn;
    let scene = sketchScene('expansion-guard-force').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 1500 })
      .townHall('us', 500, 500).townHall('foe', 3500, 3500).farms('us', 8, 500, 3000)
      .goldMine('main', 500, 800, 10000).goldMine('natural', 1500, 600, 10000)
      .building('us', trainingBuildingFor(race, standIn)!, 800, 300)
      .unit('neutral', 'ogreLord', 1500, 760, { id: 'guard-lord' }).unit('neutral', 'ogreMage', 1560, 760, { id: 'guard-mage' })
      .unit('neutral', 'ogreWarrior', 1440, 760, { id: 'guard-warrior-0' }).unit('neutral', 'ogreWarrior', 1500, 820, { id: 'guard-warrior-1' });
    for (let index = 0; index < 6; index++) scene = scene.worker('us', 520 + index * 20, 700);
    // Every soldier the opening phase lists already stands.
    const phase = strategy.phases[0]!;
    const counts = new Map<string, number>();
    for (const want of phase.wants) if ('unit' in want) counts.set(want.unit, Math.max(counts.get(want.unit) ?? 0, want.count));
    let index = 0;
    for (const [kind, count] of counts) for (let n = 0; n < count; n++, index++)
      scene = scene.unit('us', kind as typeof standIn, 700 + index % 6 * 30, 600 + Math.floor(index / 6) * 30);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { ...memory.v6, phase: 0, doctrine: { profileId: 'steady', strategyId: strategy.id, decidedTick: 0 } } as NonNullable<typeof memory.v6>;
    const snapshot = snapshotGame(game);
    const goals = rankBootstrapGoals(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
    expect(goals.some(goal => goal.id === `unit:${standIn}`)).toBe(true);
  });
