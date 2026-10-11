import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { boardUnit, canBoard } from '../../shared/decks';
import { snapshotGame, stepGame } from '../../shared/sim';
import { routeTravelTicks } from '../../shared/route-selection';
import { sameGround, setBuildingBodies, snapToFootprint, walkableGoal } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['knight', 'horseArcher'] as const).flatMap(kind => [false, true].map(mirror => ({ version, kind, mirror }))));

it.each(cases)('$version respects road arrival and real deck fit for $kind (mirror=$mirror)',
  ({ version, kind, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('ferry-soldier-road').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .goldMine('main', x(716), 500, 10000).goldMine('island', x(3300), 1800, 10000)
    .unit('us', kind, x(1104), 1600, { id: 'near-across-wall' })
    .unit('us', kind, x(1200), 2320, { id: 'road-crew' })
    .unit('us', 'transport', x(1312), 1600, { id: 'ferry' });
  for (let i = 0; i < 2; i++) scene = scene.worker('us', x(1200), 1600, { id: `engineer-${i}` });
  for (let i = 0; i < 3; i++) scene = scene.unit('us', 'knight', x(1200), 1600, { id: `aboard-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const row = Math.floor(index / 128), col = mirror ? 127 - index % 128 : index % 128;
    return col === 35 && row >= 20 && row <= 80 ? '#' : col < 39 || col >= 93 ? '.' : col === 39 || col === 92 ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  stepGame(game);
  const boat = game.units.find(unit => unit.id === 'ferry')!;
  for (const unit of game.units.filter(unit => unit.id.startsWith('engineer-') || unit.id.startsWith('aboard-'))) {
    expect(boardUnit(boat, unit, game.units)).toBe(true);
  }
  const shore = { x: x(1264), y: 1600 }, landing = walkableGoal(game.map, x(3300), 1800, 'sea');
  const near = game.units.find(unit => unit.id === 'near-across-wall')!, road = game.units.find(unit => unit.id === 'road-crew')!;
  expect(sameGround(game.map, near, shore)).toBe(true);
  expect(Math.hypot(near.x - boat.x, near.y - boat.y)).toBeLessThan(Math.hypot(road.x - boat.x, road.y - boat.y));
  expect(routeTravelTicks(game.map, near, shore, 'land', near.speed)!).toBeGreaterThan(routeTravelTicks(game.map, road, shore, 'land', road.speed)!);
  memory.naval = { island: { tick: game.tick, plan: { mineId: 'island', landing } }, ferries: {
    ferry: { purpose: 'settle', targetId: 'island', from: shore, to: landing, phase: 'loading', crewIds: [], sinceTick: game.tick },
  } };
  const fits = kind === 'horseArcher';
  expect(canBoard(boat, road, game.units)).toBe(fits);
  const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
  let first: string[] = [];
  for (let tick = 0; tick < 700 && !road.deck; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options);
      if (tick === 0) first = entries.flatMap(({ command }) => command.type === 'board' ? command.unitIds : []);
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  expect(first).toEqual(fits ? ['road-crew'] : []);
  expect(road.deck?.shipId).toBe(fits ? 'ferry' : undefined);
  expect(near.deck).toBeUndefined();
  expect(game.units.filter(unit => unit.kind === 'worker' && unit.deck?.shipId === 'ferry')).toHaveLength(2);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
