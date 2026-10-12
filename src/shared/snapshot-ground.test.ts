import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from './sim';
import { BUILDING_DEFS } from './catalog';
import { groundRevision, segmentWalkable, setBuildingBodies, snapToFootprint } from './terrain';

it('keeps captured ground intact while ordinary combat and paid construction change the live field', () => {
  const game = sketchScene('snapshot-ground-construction').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 3500, 3500)
    .building('us', 'farm', 1500, 1000, { id: 'old-farm' })
    .worker('us', 1100, 1400, { id: 'builder' })
    .unit('foe', 'knight', 1700, 1000, { id: 'attacker' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const before = snapshotGame(game), revision = groundRevision(game.map);
  const oldRow = [{ x: 1300, y: 1000 }, { x: 1700, y: 1000 }] as const;
  const nextRow = [{ x: 800, y: 1800 }, { x: 1200, y: 1800 }] as const;
  expect(groundRevision(before.map)).toBe(revision);
  expect(segmentWalkable(before.map, ...oldRow)).toBe(false);
  expect(segmentWalkable(before.map, ...nextRow)).toBe(true);
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['attacker'], targetId: 'old-farm' });
  for (let tick = 0; tick < 1800 && game.buildings.some(building => building.id === 'old-farm'); tick++) stepGame(game);
  expect(game.buildings.some(building => building.id === 'old-farm')).toBe(false);
  expect(segmentWalkable(snapshotGame(game).map, ...oldRow)).toBe(true);
  const site = snapToFootprint(game.map, BUILDING_DEFS.farm.radius, { x: 1000, y: 1800 });
  issuePlayerCommand(game, 'us', { type: 'build', unitId: 'builder', buildingKind: 'farm', ...site });
  for (let tick = 0; tick < 1000 && !game.buildings.some(building => building.kind === 'farm' && building.complete); tick++) stepGame(game);
  expect(game.buildings.some(building => building.kind === 'farm' && building.complete)).toBe(true);
  const after = snapshotGame(game);
  expect(segmentWalkable(after.map, ...oldRow)).toBe(true);
  expect(segmentWalkable(after.map, ...nextRow)).toBe(false);
  expect(segmentWalkable(before.map, ...oldRow)).toBe(false);
  expect(segmentWalkable(before.map, ...nextRow)).toBe(true);
  expect(groundRevision(before.map)).toBe(revision);
  expect(groundRevision(after.map)).not.toBe(revision);
  expect(game.players.us!.gold).toBe(500 - BUILDING_DEFS.farm.cost);
  expect(game.match.stats.goldSpent.us).toBe(BUILDING_DEFS.farm.cost);
  expect(game.match.winner).toBeNull();
});
