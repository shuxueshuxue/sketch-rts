import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { boardUnit } from '../../shared/decks';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint, walkingDistance, walkableGoal } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';
import { planSettlerBoarding } from './ferry-preparation';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version sends the reachable idle $race settlers while its ferry sails (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('parallel-settler-boarding').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .goldMine('main', x(716), 500, 10000).goldMine('island', x(3300), 1800, 10000)
    .worker('us', x(1104), 1600, { id: 'long-road' })
    .worker('us', x(1200), 2320, { id: 'short-road-0' })
    .worker('us', x(1200), 2390, { id: 'short-road-1' })
    .unit('us', 'transport', x(2000), 1600, { id: 'ferry' });
  for (let index = 0; index < 5; index++) scene = scene.worker('us', x(580), 450 + index * 25,
    { id: `miner-${index}`, order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const row = Math.floor(index / 128), col = mirror ? 127 - index % 128 : index % 128;
    return col === 35 && row >= 20 && row <= 80 ? '#' : col < 39 || col >= 93 ? '.' : col === 39 || col === 92 ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  stepGame(game);
  const shore = { x: x(1264), y: 1600 }, landing = walkableGoal(game.map, x(3300), 1800, 'sea');
  const long = game.units.find(unit => unit.id === 'long-road')!, short = game.units.find(unit => unit.id === 'short-road-0')!;
  expect(sameGround(game.map, long, shore)).toBe(true);
  expect(Math.hypot(long.x - shore.x, long.y - shore.y)).toBeLessThan(Math.hypot(short.x - shore.x, short.y - shore.y));
  expect(walkingDistance(game.map, long, shore, 'land')!).toBeGreaterThan(walkingDistance(game.map, short, shore, 'land')!);
  memory.naval = { island: { tick: game.tick, plan: { mineId: 'island', landing } }, ferries: {
    ferry: { purpose: 'settle', targetId: 'island', from: shore, to: landing, phase: 'loading', crewIds: [], sinceTick: game.tick },
  } };
  const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
  let firstBoard: string[] = [], loaded = false;
  for (let tick = 0; tick < 2400 && !loaded; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, context);
      if (tick === 0) firstBoard = entries.flatMap(({ command }) => command.type === 'board' ? command.unitIds : []);
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
    loaded = game.units.filter(unit => unit.kind === 'worker' && unit.deck?.shipId === 'ferry').length === 2;
  }
  expect(firstBoard.sort()).toEqual(['short-road-0', 'short-road-1']);
  expect(loaded).toBe(true);
  expect(game.units.filter(unit => unit.deck?.shipId === 'ferry').map(unit => unit.id).sort()).toEqual(['short-road-0', 'short-road-1']);
  expect(game.units.filter(unit => unit.id.startsWith('miner-')).every(unit => !unit.deck && unit.order.type === 'mine')).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
}, 20000);

it.each(['aboard', 'transferring'] as const)('does not recruit extra settlers when both engineers are already %s', state => {
  let scene = sketchScene('committed-settler-payload').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 500, 3500)
    .goldMine('main', 716, 500, 10000).goldMine('island', 3300, 1800, 10000)
    .unit('us', 'transport', 2000, 1600, { id: 'ferry' })
    .unit('us', 'transport', 2500, 1600, { id: 'source' });
  for (let index = 0; index < 5; index++) scene = scene.worker('us', 580, 450 + index * 25,
    { id: `miner-${index}`, order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  for (let index = 0; index < 5; index++) scene = scene.worker('us', 800, 1600 + index * 40, { id: `idle-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = index % 128;
    return col < 31 || col >= 95 ? '.' : col === 31 || col === 94 ? ',' : '~';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  stepGame(game);
  const ferry = game.units.find(unit => unit.id === 'ferry')!, source = game.units.find(unit => unit.id === 'source')!;
  const crew = game.units.filter(unit => unit.id === 'idle-0' || unit.id === 'idle-1');
  for (const worker of crew) expect(boardUnit(state === 'aboard' ? ferry : source, worker, game.units)).toBe(true);
  if (state === 'transferring') issuePlayerCommand(game, 'us', { type: 'board', unitIds: crew.map(unit => unit.id), transportId: ferry.id });
  memory.naval = { ferries: { ferry: { purpose: 'settle', targetId: 'island', phase: 'loading',
    from: { x: 1008, y: 1600 }, to: { x: 3024, y: 1800 }, crewIds: [], sinceTick: game.tick } } };
  const commands = planSettlerBoarding(snapshotGame(game), 'us', bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams }), []);
  expect(commands).toEqual([]);
  issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'ferryPreparation', command })));
  for (let tick = 0; tick < 10; tick++) stepGame(game);
  expect(game.units.filter(unit => unit.id === 'idle-2' || unit.id === 'idle-3' || unit.id === 'idle-4')
    .every(unit => !unit.deck && unit.order.type === 'idle')).toBe(true);
  expect(crew.every(unit => game.units.includes(unit))).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
