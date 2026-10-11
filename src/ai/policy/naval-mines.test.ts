import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { chooseNavalMine } from './naval-mines';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version chooses the shorter $race sea road around a land barrier (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 2048 - value : value;
    const game = sketchScene('naval-mine-road').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .unit('us', 'transport', x(512), 768, { id: 'ferry' })
      .goldMine('near', x(1312), 768, 6000).goldMine('short-road', x(448), 1696, 6000)
      .build().createGame();
    game.map.width = game.map.height = 2048;
    game.map.terrain = { cell: 32, cols: 64, rows: 64, cells: Array.from({ length: 4096 }, (_, i) => {
      const col = mirror ? 63 - i % 64 : i % 64, row = Math.floor(i / 64);
      const wall = col >= 30 && col <= 34 && row >= 8 && row <= 55;
      const eastIsland = col >= 38 && col <= 43 && row >= 22 && row <= 28;
      const southIsland = col >= 12 && col <= 17 && row >= 50 && row <= 56;
      return wall || eastIsland || southIsland ? '.' : '~';
    }).join('') };
    const snapshot = snapshotGame(game), boat = game.units.find(unit => unit.id === 'ferry')!;
    const candidates = [
      { mine: snapshot.resources.find(mine => mine.id === 'near')!, landing: { x: x(1184), y: 768 }, departure: boat },
      { mine: snapshot.resources.find(mine => mine.id === 'short-road')!, landing: { x: x(448), y: 1568 }, departure: boat },
    ];
    expect(Math.hypot(boat.x - candidates[0]!.landing.x, boat.y - candidates[0]!.landing.y))
      .toBeLessThan(Math.hypot(boat.x - candidates[1]!.landing.x, boat.y - candidates[1]!.landing.y));
    expect(walkingDistance(game.map, boat, candidates[1]!.landing, 'sea'))
      .toBeLessThan(walkingDistance(game.map, boat, candidates[0]!.landing, 'sea')!);
    const options = bootstrapPolicyContext(snapshot, 'us', version, { memory: createAiPolicyMemory(), teams: game.teams });
    expect(chooseNavalMine(snapshot, 'us', candidates, options)?.mine.id).toBe('short-road');
  });
