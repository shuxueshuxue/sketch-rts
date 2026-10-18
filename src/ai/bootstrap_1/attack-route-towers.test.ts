import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { routeClearsDisks } from '../../shared/route-selection';
import { createAiPolicyMemory } from '../memory';
import { readV6Intel } from '../policy/v6/intel';
import { bootstrapPolicyContext } from './policy';
import { attackRouteTowers } from './attack-route-towers';
import recorded from './test-fixtures/route-towers-ladder-25-27885.json';

it('does not set out for the far hall through the ladder-25 tower cluster', () => {
  // v5-final-1, knight/v9, ladder-25 grove, captured before planning at 27885.
  // The main's defence requires 16.28 against our 17.93, but the native march
  // crosses five more known towers near the expansion: another 6.5 strength.
  const { snapshot, memory, teams } = structuredClone(recorded) as unknown as {
    snapshot: GameSnapshot; memory: AiPolicyMemory; teams: Record<string, string>;
  };
  expect(snapshot.tick).toBe(27885);
  expect(memory.v6!.general!.mode).toBe('hold');
  planAiOwnerCommandEntries(snapshot, { playerId: 'v9_knight', version: 'v9_knight', memory }, { teams });
  expect(memory.v6!.general!.targetHallId).not.toBe('building-p1-townhall');
});

it('checks building detours and charges a transit tower once, separately from base defence', () => {
  let scene = sketchScene('attack-native-tower-road').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 3000, 1000, { id: 'target' })
    .unit('us', 'knight', 500, 1000, { id: 'front' })
    .tower('foe', 1500, 480).tower('foe', 1500, 1520);
  for (let i = 0; i < 11; i++) scene = scene.townHall('us', 1500, 600 + i * 80);
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  setBuildingBodies(game.map, game.buildings);
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight',
    { memory: createAiPolicyMemory(), teams: game.teams });
  const intel = readV6Intel(snapshot, 'us', options), target = intel.enemies[0]!.bases[0]!;
  const unit = snapshot.units.find(unit => unit.id === 'front')!;
  const towers = intel.enemies[0]!.buildings.filter(building => building.kind === 'defenseTower');
  expect(routeClearsDisks([unit, target.hall], towers.map(tower => ({ ...tower, radius: tower.attackRange })))).toBe(true);
  const crossed = attackRouteTowers(snapshot, intel, [unit], target);
  expect(crossed.length).toBeGreaterThan(0);
  expect(attackRouteTowers(snapshot, intel, [unit, { ...unit, id: 'second' }], target)).toEqual(crossed);
  expect(attackRouteTowers(snapshot, intel, [unit], { ...target, towers })).toEqual([]);
  intel.enemies[0]!.buildings = [];
  expect(attackRouteTowers(snapshot, intel, [unit], target)).toEqual([]);
});
