import { expect, it } from 'vitest';
import fixture from './test-fixtures/caster-ladder-12-11000.json';
import { groundSteeringRoute, routeLeavesDisks } from '../../shared/route-selection';
import { isOpenGround, setBuildingBodies, walkableGoal } from '../../shared/terrain';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, stepGame } from '../../shared/sim';
import type { GameSnapshot, GameCommand } from '../../shared/types';
import { createAiPolicyMemory, type V6PolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planSummonerScreen } from './summoner-screen';

it('withdraws the ladder-12 host along walkable land instead of snapping its post across the tower peninsula', () => {
  const snapshot = structuredClone(fixture.snapshot) as unknown as GameSnapshot;
  setBuildingBodies(snapshot.map, snapshot.buildings);
  const memory = createAiPolicyMemory();
  memory.v6 = { general: structuredClone(fixture.general) as NonNullable<V6PolicyMemory['general']> };
  const caster = snapshot.units.find(unit => unit.id === 'unit-v9_summoner-summoner-1559')!;
  const options = bootstrapPolicyContext(snapshot, caster.owner, 'v9_summoner', { memory, teams: snapshot.teams! });
  const commands = planSummonerScreen(snapshot, caster.owner, options);
  const command = commands.find(command => command.type === 'move' && command.unitIds.includes(caster.id)) as Extract<GameCommand, { type: 'move' }>;
  expect(command).toBeDefined();
  expect(isOpenGround(snapshot.map, command.x, command.y), JSON.stringify(command)).toBe(true);
  // Check the actual native walk, including the sim's adjustment of a blocked goal.
  const goal = walkableGoal(snapshot.map, command.x, command.y);
  const road = groundSteeringRoute(snapshot.map, caster, goal);
  const towers = snapshot.buildings.filter(building => building.owner === 'p1' && building.complete && building.attackDamage > 0);
  expect(routeLeavesDisks(road, towers.map(tower => ({ ...tower, radius: tower.attackRange + caster.radius }))), JSON.stringify(road)).toBe(true);
  expect(road.length).toBeGreaterThan(1);
  expect(Math.hypot(road[road.length - 1]!.x - caster.x, road[road.length - 1]!.y - caster.y)).toBeGreaterThan(100);
  const game = createGame('bareDuel', { aiPlayers: [] });
  restoreSnapshotIntoGame(game, snapshot, 1_000_000);
  const tower = towers.find(tower => tower.id === 'building-p1-defenseTower-1696')!;
  const before = Math.hypot(caster.x - tower.x, caster.y - tower.y);
  issuePlayerCommand(game, caster.owner, command);
  for (let tick = 0; tick < 15; tick++) stepGame(game);
  const walking = game.units.find(unit => unit.id === caster.id)!;
  expect(Math.hypot(walking.x - tower.x, walking.y - tower.y)).toBeGreaterThan(before);
});
