import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { distance } from '../policy/spatial';

it.each((['raid', 'camp', 'mixed'] as const).flatMap(kind => [false, true].map(mirror => ({ kind, mirror }))))(
  'selects the shorter actual $kind road around a forest wall (mirror=$mirror)', ({ kind, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('mounted-road-choice').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(3500), 500).townHall('foe', x(3500), 3500)
      .unit('us', 'horseArcher', x(2400), 1000, { id: 'rider' });
    if (kind === 'raid') scene = scene.unit('us', 'horseArcher', x(2440), 960, { id: 'partner' });
    if (kind !== 'camp') scene = scene.townHall('foe', x(1800), 1000, { id: 'near-across-wall' })
      .worker('foe', x(1640), 1000, { id: 'near-worker' });
    if (kind === 'raid') scene = scene.townHall('foe', x(2400), 2400, { id: 'short-road' })
      .worker('foe', x(2560), 2400, { id: 'local-worker' });
    if (kind === 'camp') scene = scene.goldMine('near-mine', x(1800), 900, 4000)
      .unit('neutral', 'ogreWarrior', x(1800), 1000, { id: 'near-guard' });
    if (kind !== 'raid') scene = scene.goldMine('local-mine', x(2400), 2500, 4000)
      .unit('neutral', 'ogreWarrior', x(2400), 2400, { id: 'local-guard' });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
      index % 128 === (mirror ? 63 : 64) && Math.floor(index / 128) < 100 ? 'T' : '.').join('') };
    const rider = game.units.find(unit => unit.id === 'rider')!;
    const across = { x: x(1800), y: 1000 }, local = { x: x(2400), y: 2400 };
    expect(distance(rider, across)).toBeLessThan(distance(rider, local));
    expect(walkingDistance(game.map, rider, across)!).toBeGreaterThan(walkingDistance(game.map, rider, local)! * 2);
    for (let tick = 0; tick < 180; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game),
          { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams });
        if (tick === 0) expect(memory.mounted![0]!.objective).toEqual(kind === 'raid'
          ? { kind: 'raid', hallId: 'short-road', owner: 'foe' } : { kind: 'camp', ids: ['local-guard'] });
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(rider.y).toBeGreaterThan(1400);
    expect(rider.hp).toBe(rider.maxHp);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
