import { expect, it } from 'vitest';
import { createGame, snapshotGame, stepGame, issueCommand } from '../../shared/sim';
import { nativeLandRoad } from '../policy/land-road';
import { neutralCampRouteContacts } from '../situation/neutral-camp-contact';
import { planCampTravel } from './camp-travel';
import { threatRoadCommands } from './threat-roads';

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
