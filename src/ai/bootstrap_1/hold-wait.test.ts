import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planV6General } from '../policy/v6/general';

it.each(['melee', 'tower-covered shooters'] as const)('resumes its waiting army after a temporary %s raid', raid => {
  const requestedVersion = 'v9';
  let scene = sketchScene('hold-after-defense').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).tower('us', 650, 600).townHall('foe', 3400, 3300)
    .townHall('foe', 3400, 2150, { id: 'far-base' });
  for (let i = 0; i < 20; i++) scene = scene
    .unit('us', 'footman', 800 + i % 5 * 30, 800 + Math.floor(i / 5) * 30)
    .unit('foe', 'footman', 3300 + i % 5 * 30, 3150 + Math.floor(i / 5) * 30);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  memory.v6 = { doctrine: { profileId: 'steady', strategyId: 'grove-cavalry-line', decidedTick: 0 } };
  const plan = () => planV6General(snapshotGame(game), 'us', { version: 'v2', requestedVersion, teams: game.teams, memory });
  game.tick = 1000;
  plan();
  expect(memory.v6.general).toMatchObject({ mode: 'hold', holdingSince: 1000 });
  const raiders = Array.from({ length: raid === 'melee' ? 1 : 12 }, (_, i) =>
    game.spawnUnit('foe', raid === 'melee' ? 'footman' : 'archer', 900 + i % 4 * 25, 900 + Math.floor(i / 4) * 25));
  game.tick = 2000;
  plan();
  expect(memory.v6.general?.mode).toBe(raid === 'melee' ? 'defend' : 'guard');
  // Removing the transient raid should resume the same wait, not start it over.
  game.units = game.units.filter(unit => !raiders.some(raider => raider.id === unit.id));
  game.tick = 3000;
  plan();
  expect(memory.v6.general).toMatchObject({ mode: 'hold', holdingSince: 1000 });
  game.tick = 6400;
  plan();
  if (requestedVersion === 'v9') expect(memory.v6.general?.mode).toBe('attack');
  // A committed mission consumes the waiting period.
  if (memory.v6.general?.mode === 'attack') expect(memory.v6.general.holdingSince).toBeUndefined();
});
