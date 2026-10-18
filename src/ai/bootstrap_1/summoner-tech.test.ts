import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';

// Weapons and plating reach every land combat unit a player trains, the summoner and its priests among them (only the
// spirits it summons are left out), so every room AI wants them once its army stands at ten.
it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s wants weapons and plating III with an army of ten', (version) => {
  const game = sketchScene('ten-strong').map('bareDuel').replaceDefaults().player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 3500, 3500).build().createGame();
  for (let index = 0; index < 10; index++) game.spawnUnit('us', 'summoner', 700 + index * 30, 700);
  const options = bootstrapPolicyContext(snapshotGame(game), 'us', version, { memory: createAiPolicyMemory(), teams: game.teams });
  expect(options.armyWants).toEqual(expect.arrayContaining([
    expect.objectContaining({ upgrade: 'weaponTraining', level: 3 }), expect.objectContaining({ upgrade: 'reinforcedPlating', level: 3 })]));
  expect(UPGRADE_DEFS.weaponTraining.affectedUnitKinds).toContain('summoner');
  expect(UPGRADE_DEFS.weaponTraining.affectedUnitKinds).not.toContain('spirit');
});
