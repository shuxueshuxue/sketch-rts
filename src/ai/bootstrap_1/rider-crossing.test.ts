import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapScripts, bootstrapPolicyContext } from './policy';
import { planRiderCrossing } from './rider-crossing';

function field(mirror: boolean, guard: 'ogreWarrior' | 'archer' | 'raider' = 'ogreWarrior', colony = false) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('automatic-rider-crossing').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' }).player('ally', { team: 'a' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500).townHall('ally', x(500), 3000)
    .goldMine('main', x(716), 500, 10000).goldMine('island', x(3300), 1800, 10000)
    .unit('us', 'horseArcher', x(1200), 2200, { id: 'rider' }).unit('us', 'transport', x(2000), 2200, { id: 'ferry' })
    .unit('neutral', guard, x(3300), 1750, { id: 'guard-0' })
    .unit('neutral', 'ogreWarrior', x(3300), 1850, { id: 'guard-1' });
  if (colony) scene = scene.townHall('us', x(800), 1000);
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return col < 39 || col >= 93 ? '.' : col === 39 || col === 92 ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  stepGame(game);
  return game;
}

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })));

it.each(cases)('$version ferries one rider and clears the island without damage (mirror=$mirror)', ({ version, mirror }) => {
  const game = field(mirror), memory = createAiPolicyMemory();
  const scripts = bootstrapScripts(version).filter(script => ['naval', 'mountedTasks'].includes(script.id));
  const rider = game.units.find(unit => unit.id === 'rider')!, boat = game.units.find(unit => unit.id === 'ferry')!;
  let aboard = false, landed = false, shots = 0, damage = 0;
  game.observer = { hit(attacker, target, taken) {
    if (attacker.id === rider.id) shots++;
    if (target.owner === 'us') damage += taken;
  } };
  for (let elapsed = 0; elapsed < 10000 && game.units.some(unit => unit.id.startsWith('guard-')); elapsed++) {
    if (elapsed % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options);
      if (elapsed === 0) expect(memory.naval!.ferries!.ferry!.purpose).toBe('creep');
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
    if (rider.deck?.shipId === boat.id) aboard = true;
    if (aboard && !rider.deck) landed = true;
  }
  expect(aboard).toBe(true);
  expect(landed).toBe(true);
  expect(game.units.some(unit => unit.id.startsWith('guard-'))).toBe(false);
  expect(game.units.includes(rider) && game.units.includes(boat)).toBe(true);
  expect(rider.hp).toBe(rider.maxHp);
  expect(boat.hp).toBe(boat.maxHp);
  expect(damage).toBe(0);
  expect(shots).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
}, 60000);

it.each(['long-range', 'fast', 'ally-mine', 'busy-ferry', 'busy-rider'] as const)('does not commandeer a crossing when %s', reason => {
  const game = field(false, reason === 'long-range' ? 'archer' : reason === 'fast' ? 'raider' : 'ogreWarrior'), memory = createAiPolicyMemory();
  if (reason === 'ally-mine') {
    const worker = game.spawnUnit('ally', 'worker', 3100, 1800);
    worker.order = { type: 'mine', resourceId: 'island', phase: 'toMine', timer: 0 };
  }
  if (reason === 'busy-ferry') memory.naval = { ferries: { ferry: {
    purpose: 'settle', targetId: 'island', from: { x: 1296, y: 2200 }, to: { x: 2960, y: 1808 },
    phase: 'loading', crewIds: [], sinceTick: game.tick,
  } } };
  if (reason === 'busy-rider') memory.mounted = [{ unitIds: ['rider'], objective: { kind: 'camp', ids: ['guard-0'] } }];
  const previous = structuredClone(memory.naval?.ferries);
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
  planRiderCrossing(snapshot, 'us', options);
  expect(Object.values(memory.naval!.ferries!)).toEqual(Object.values(previous ?? {}));
});


it.each(['rider', 'mine'] as const)('reserves an active crossing by %s even before boarding', reserved => {
  const game = field(false), memory = createAiPolicyMemory();
  game.spawnUnit('us', 'transport', 2000, 2500);
  const rider = game.spawnUnit('us', 'horseArcher', 1200, 2300);
  memory.naval = { ferries: { ferry: {
    purpose: 'creep', riderId: reserved === 'rider' ? 'rider' : rider.id,
    targetId: reserved === 'mine' ? 'island' : 'another-mine',
    from: { x: 1296, y: 2200 }, to: { x: 2960, y: 1808 },
    phase: 'loading', crewIds: [], sinceTick: game.tick,
  } } };
  if (reserved === 'rider') {
    game.units = game.units.filter(unit => unit.id !== rider.id);
    game.resources.push({ ...game.resources.find(mine => mine.id === 'island')!, id: 'another-mine', y: 2700 });
  }
  const previous = structuredClone(memory.naval.ferries);
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
  planRiderCrossing(snapshot, 'us', options);
  expect(memory.naval.ferries).toEqual(previous);
});

it('lets the landed rider finish its mine before dispatching another', () => {
  const game = field(false), memory = createAiPolicyMemory();
  Object.assign(game.units.find(unit => unit.id === 'rider')!, { x: 3300, y: 2200 });
  game.spawnUnit('us', 'horseArcher', 1200, 2200);
  memory.mounted = [{ unitIds: ['rider'], objective: { kind: 'camp', ids: ['guard-0', 'guard-1'] } }];
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
  planRiderCrossing(snapshot, 'us', options);
  expect(memory.naval!.ferries!).toEqual({});
});

it('keeps another guarded mine on the same land available for a second rider', () => {
  const game = field(false), memory = createAiPolicyMemory();
  Object.assign(game.units.find(unit => unit.id === 'rider')!, { x: 3300, y: 2200 });
  game.spawnUnit('us', 'horseArcher', 1200, 2200);
  game.resources.push({ ...game.resources.find(mine => mine.id === 'island')!, id: 'second-mine', y: 3000 });
  game.spawnUnit('neutral', 'ogreWarrior', 3300, 2950);
  game.spawnUnit('neutral', 'ogreWarrior', 3300, 3050);
  memory.mounted = [{ unitIds: ['rider'], objective: { kind: 'camp', ids: ['guard-0', 'guard-1'] } }];
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
  planRiderCrossing(snapshot, 'us', options);
  expect(memory.naval!.ferries!.ferry!.targetId).toBe('second-mine');
});

it.each(cases)('$version clears before dispatching settlers (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = field(mirror, 'ogreWarrior', true), memory = createAiPolicyMemory();
  const rider = game.units.find(unit => unit.id === 'rider')!;
  Object.assign(rider, { x: x(3300), y: 2200 });
  for (let i = 0; i < 7; i++) {
    const worker = game.spawnUnit('us', 'worker', x(i < 2 ? 1200 : 600), i < 2 ? 2200 : 500 + i * 30);
    if (i >= 2) worker.order = { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 };
  }
  for (let i = 0; i < 3; i++) game.spawnUnit('us', 'footman', x(1100), 2100 + i * 40);
  memory.mounted = [{ unitIds: ['rider'], objective: { kind: 'camp', ids: ['guard-0', 'guard-1'] } }];
  const scripts = bootstrapScripts(version).filter(script => ['naval', 'mountedTasks'].includes(script.id));
  let cleared = false, workersAboard = 0, damage = 0;
  game.observer = { hit(_attacker, target, taken) { if (target.owner === 'us') damage += taken; } };
  for (let elapsed = 0; elapsed < 10000 && workersAboard < 2; elapsed++) {
    cleared ||= !game.units.some(unit => unit.id.startsWith('guard-'));
    if (elapsed % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options);
      if (!cleared) expect(Object.values(memory.naval!.ferries!).some(mission => mission.purpose === 'settle')).toBe(false);
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
    workersAboard = game.units.filter(unit => unit.kind === 'worker' && unit.deck?.shipId === 'ferry').length;
  }
  expect(cleared).toBe(true);
  expect(workersAboard).toBe(2);
  expect(game.units.includes(rider)).toBe(true);
  expect(rider.hp).toBe(rider.maxHp);
  expect(damage).toBe(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
}, 60000);
