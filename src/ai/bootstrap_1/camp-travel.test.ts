import { expect, it } from 'vitest';
import { createGame, snapshotGame, stepGame, issueCommand } from '../../shared/sim';
import { nativeLandRoad } from '../policy/land-road';
import { neutralCampRouteContacts } from '../situation/neutral-camp-contact';
import { planCampTravel } from './camp-travel';
import { threatRoadCommands } from './threat-roads';
import { createBuilding } from '../../shared/map';
import { workerExposure } from '../situation/worker-exposure';

it('executes the admitted native detour, rather than steering straight through the camp', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const unit = game.spawnUnit('player', 'worker', 500, 1000);
  game.spawnUnit('neutral', 'wildling', 1000, 1000);
  const snapshot = snapshotGame(game), walker = snapshot.units.find(candidate => candidate.id === unit.id)!;
  const goal = { x: 1500, y: 1000 }, original = nativeLandRoad(snapshot, walker, goal)!;
  expect(neutralCampRouteContacts(snapshot, walker, original.points).length).toBeGreaterThan(0);
  const plan = planCampTravel(snapshot, walker, goal, { parentId: 'build', valueGoldPerTick: .01 });
  expect(plan.kind).toBe('detour'); expect(plan.subgoal).toBeNull();
  expect(neutralCampRouteContacts(snapshot, walker, plan.road!.points)).toEqual([]);
  for (const command of threatRoadCommands(walker, { ...plan.road!, points: plan.road!.points as [typeof walker, ...typeof walker[]] })) issueCommand(game, command);
  for (let tick = 0; tick < plan.road!.ticks + 50; tick++) stepGame(game);
  const arrived = game.units.find(candidate => candidate.id === unit.id)!;
  expect(arrived.hp).toBe(arrived.maxHp); expect(Math.hypot(arrived.x - goal.x, arrived.y - goal.y)).toBeLessThan(20);
});
it('retains the parent and emits a force prerequisite when an arrival needs the camp cleared', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const unit = game.spawnUnit('player', 'worker', 500, 1000); game.spawnUnit('neutral', 'ogreMage', 1000, 1000);
  const snapshot = snapshotGame(game), walker = snapshot.units.find(candidate => candidate.id === unit.id)!;
  const plan = planCampTravel(snapshot, walker, { x: 1000, y: 1000 }, { parentId: 'expand:mine' });
  expect(plan.kind).toBe('clear-camp'); expect(plan.subgoal?.parentMethodId).toBe('expand:mine');
  expect(plan.subgoal?.demands[0]).toMatchObject({ kind: 'force', metric: 'camp-force' });
  expect(plan.subgoal?.status).toBe('blocked');
});

it('prices possible pursuit without creating a mandatory clearing prerequisite', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 700, 1500);
  const guard = game.spawnUnit('neutral', 'wildling', 1000, 1000);
  guard.order = { type: 'attack', targetId: 'another-passerby', leashX: 1000, leashY: 1000 };
  const snapshot = snapshotGame(game);
  const plan = planCampTravel(snapshot, worker, { x: 700, y: 1000 }, { parentId: 'build', valueGoldPerTick: 1 });
  expect(plan.contacts.some(contact => contact.reason === 'active-pursuit')).toBe(true);
  expect(plan.contacts.every(contact => contact.reason === 'active-pursuit')).toBe(true);
  expect(plan.kind).toBe('exposed');
  expect(plan.subgoal).toBeNull();
  expect(plan.exposureGold).toBeGreaterThan(0);
});

it('checks enemy towers and troops in the same role envelope when selecting a camp detour', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 500, 1000);
  game.spawnUnit('neutral', 'wildling', 1000, 1000);
  game.spawnUnit('enemy', 'archer', 1300, 1250);
  game.buildings.push(createBuilding('enemy-tower', 'enemy', 'defenseTower', 1000, 1350, true));
  const snapshot = snapshotGame(game), plan = planCampTravel(snapshot, worker, { x: 2000, y: 1000 }, { parentId: 'construction' });
  expect(plan.kind).toBe('detour');
  expect(workerExposure(snapshot, worker, plan.road!.points, { allowDeparture: true })).toEqual([]);
  expect(workerExposure(snapshot, worker, { x: 1000, y: 1200 }).some(exposure => exposure.foe.id === 'enemy-tower')).toBe(true);
});
