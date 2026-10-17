import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapCommands } from './policy';

// @@@no-creep-in-a-fight: an enemy army on the army's heels; an easy camp in reach. The general keeps the army on the fight.
// A lone raider in reach is no such army.
it.each((['v9_knight', 'v9_archer'] as const).flatMap(version => (['grove', 'ember'] as const).flatMap(race => [true, false].map(pressed => ({ version, race, pressed })))))(
  '$version $race takes on a camp only while no enemy army presses it (pressed=$pressed)', ({ version, race, pressed }) => {
    const soldier = race === 'grove' ? 'footman' : 'emberRavager';
    let scene = sketchScene('no-creep-in-a-fight').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: race === 'grove' ? 'ember' : 'grove', team: 'b' }).playerState('us', { gold: 0 })
      .townHall('us', 500, 500).townHall('foe', 3600, 3600).farms('us', 8, 300, 3000)
      .unit('neutral', 'wildling', 2500, 900).unit('neutral', 'wildling', 2540, 910)
      .tower('foe', 3450, 3450).tower('foe', 3700, 3450);
    // The opponent's main stands defended, so there is no attack to make.
    for (let index = 0; index < 10; index++) {
      const x = 3400 + index % 5 * 40, y = 3300 + Math.floor(index / 5) * 40;
      scene = scene.unit('foe', 'knight', x, y, { order: { type: 'hold', x, y } });
    }
    for (let index = 0; index < 8; index++) scene = scene.unit('us', soldier, 1500 + index % 4 * 36, 1500 + Math.floor(index / 4) * 36);
    for (let index = 0; index < (pressed ? 6 : 1); index++) scene = scene.unit('foe', 'raider', 1400 + index % 3 * 30, 1590 + Math.floor(index / 3) * 30,
      { order: { type: 'attack', targetId: `scene-no-creep-in-a-fight-us-${soldier}-${4 + index % 3}` } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    for (let think = 0; think < 3; think++) planBootstrapCommands(snapshotGame(game), 'us', version, { memory, teams: game.teams });
    expect(memory.v6?.creep === undefined).toBe(pressed);
  });
