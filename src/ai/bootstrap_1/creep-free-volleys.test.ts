import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { creepForce, neutralCamps } from '../policy/v7/creep';
import { BOOTSTRAP_DOCTRINES, planBootstrapCommands } from './policy';

// @@@creep-free-volleys
function field(race: 'grove' | 'ember', army: [string, number][], camp: [string, number][]) {
  let scene = sketchScene('creep-free-volleys').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 0 })
    .townHall('us', 500, 500).townHall('foe', 3600, 3600).farms('us', 8, 300, 3000)
    .goldMine('main', 500, 800, 10000).goldMine('natural', 1500, 1450, 10000);
  for (let index = 0; index < 6; index++) scene = scene.worker('us', 520 + index * 20, 700);
  // The opponent's army stands at home: the general has no attack to make and no closeout to run.
  for (let index = 0; index < 16; index++) {
    const x = 3400 + index % 4 * 40, y = 3400 + Math.floor(index / 4) * 40;
    scene = scene.unit('foe', 'knight', x, y, { order: { type: 'hold', x, y } });
  }
  let at = 0;
  for (const [kind, count] of camp) for (let n = 0; n < count; n++, at++)
    scene = scene.unit('neutral', kind as 'ogreWarrior', 1500 + at % 3 * 50, 1550 + Math.floor(at / 3) * 50);
  at = 0;
  for (const [kind, count] of army) for (let n = 0; n < count; n++, at++)
    scene = scene.unit('us', kind as 'archer', 1050 + at % 4 * 30, 1050 + Math.floor(at / 4) * 30);
  return scene.build().createGame();
}

describe('creep free volleys', () => {
  it.each(['grove', 'ember'] as const)('%s shooters that outrange the guard take their expansion\'s ogre camp', race => {
    // Rated without their free volleys, six archers (3.50) and seven spark archers (3.63) stand short of the camp's 4.52.
    const shooter = race === 'grove' ? 'archer' : 'sparkArcher', count = race === 'grove' ? 6 : 7;
    const game = field(race, [[shooter, count]], [['ogreWarrior', 2], ['ogreMage', 1]]), memory = createAiPolicyMemory();
    const strategy = BOOTSTRAP_DOCTRINES.v9_archer.find(candidate => candidate.race === race)!;
    memory.v6 = { ...memory.v6, phase: 1, doctrine: { profileId: 'steady', strategyId: strategy.id, decidedTick: 0 } } as NonNullable<typeof memory.v6>;
    for (let tick = 0; tick < 20 * 90; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planBootstrapCommands(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams })
        .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
      stepGame(game);
    }
    expect(game.units.filter(unit => unit.owner === 'neutral')).toEqual([]);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === shooter)).toHaveLength(count);
  }, 60_000);

  it('gives no free volleys to a group the camp is not outranged by', () => {
    const melee = snapshotGame(field('grove', [['footman', 3], ['lancer', 1]], [['ogreWarrior', 2], ['ogreMage', 1]]));
    const meleeCamp = neutralCamps(melee)[0]!, own = melee.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker');
    // Footmen reach no further than the warriors; the lancer's 22 paces past them is under a third of a second.
    expect(creepForce(own, meleeCamp)).toBeCloseTo(creepForce(own), 1);
    const shooters = snapshotGame(field('grove', [['archer', 6]], [['ogreWarrior', 2], ['ogreMage', 1]]));
    const camp = neutralCamps(shooters)[0]!, archers = shooters.units.filter(unit => unit.owner === 'us' && unit.kind === 'archer');
    expect(creepForce(archers, camp)).toBeGreaterThan(creepForce(archers) * 1.2);
    // A camp that reaches as far as the archers gives them nothing.
    const level = { ...camp, creeps: camp.creeps.map(creep => ({ ...creep, attackRange: archers[0]!.attackRange })) };
    expect(creepForce(archers, level)).toBe(creepForce(archers));
  });
});
