import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { trainingBuildingFor } from '../../shared/catalog';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { neutralCamps } from '../policy/v7/creep';
import { BOOTSTRAP_DOCTRINES, bootstrapPolicyContext } from './policy';
import { rankBootstrapGoals } from './economy';

// @@@save-while-creeping: while the general clears the guard of the mine it takes next, the hall's gold is kept for it.
it.each((['v9_knight', 'v9_summoner'] as const).flatMap(version => (['grove', 'ember'] as const).flatMap(race =>
  [false, true].map(creeping => ({ version, race, creeping })))))('$version $race keeps the next hall\'s gold while creeping its guard (creeping=$creeping)',
  ({ version, race, creeping }) => {
    const strategy = BOOTSTRAP_DOCTRINES[version].find(candidate => candidate.race === race)!;
    let scene = sketchScene('save-while-creeping').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 300 })
      .townHall('us', 500, 500).townHall('foe', 3500, 3500).farms('us', 8, 500, 3000)
      .goldMine('main', 500, 800, 10000).goldMine('natural', 1500, 600, 10000)
      .building('us', trainingBuildingFor(race, strategy.standIn)!, 800, 300)
      .unit('neutral', 'ogreWarrior', 1500, 760).unit('neutral', 'ogreWarrior', 1560, 760);
    for (let index = 0; index < 6; index++) scene = scene.worker('us', 520 + index * 20, 700);
    for (let index = 0; index < 8; index++) scene = scene.unit('us', strategy.standIn, 700 + index % 4 * 30, 600 + Math.floor(index / 4) * 30);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const camp = neutralCamps(snapshotGame(game))[0]!;
    memory.v6 = { ...memory.v6, phase: 0, doctrine: { profileId: 'steady', strategyId: strategy.id, decidedTick: 0 },
      ...(creeping ? { creep: { center: camp.center, reach: camp.reach, staging: { x: 1200, y: 600 }, stage: 'gather', since: 0,
        group: game.units.filter(unit => unit.owner === 'us' && unit.kind === strategy.standIn).map(unit => unit.id) } } : {}) } as NonNullable<typeof memory.v6>;
    const snapshot = snapshotGame(game);
    const goals = rankBootstrapGoals(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
    const hall = goals.find(goal => goal.id.startsWith('bases:'));
    if (creeping) expect(hall).toMatchObject({ hold: true, cost: 400 });
    else expect(hall).toBeUndefined();
  });
