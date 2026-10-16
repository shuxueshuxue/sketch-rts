import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { CELL_GROUND, groundSegmentAdvance, setBuildingBodies, steerPoint } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { miningApproachOutsideFire } from './mining-fire';
import { medicalApproachRoad } from './medical-task-safety';

function entryScene(extra: number, tower = false, mineX = tower ? 788 : 800) {
  let scene = sketchScene('native-mining-entry').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 1200, 608).townHall('foe', 1600, 1600).goldMine('ore', mineX, 600, 1000)
    .worker('us', mineX + GOLD_MINE_RULES.entryRange + extra, 600, { id: 'miner' });
  if (tower) scene = scene.tower('foe', 352, 608, { id: 'tower' });
  return scene.build().createGame();
}

it('native mining enters gather at44 without advancing a new movement step', () => {
  const game = entryScene(0), worker = game.units.find(unit => unit.id === 'miner')!;
  const before = { x: worker.x, y: worker.y };
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: [worker.id], resourceId: 'ore' });
  stepGame(game);
  expect(worker.order.type === 'mine' && worker.order.phase === 'gather').toBe(true);
  expect({ x: worker.x, y: worker.y }).toEqual(before);
});

it('native mining moves past continuous44 entry before the following tick gathers', () => {
  const game = entryScene(.1), worker = game.units.find(unit => unit.id === 'miner')!;
  const snapshot = snapshotGame(game), mine = snapshot.resources.find(resource => resource.id === 'ore')!;
  const entry = medicalApproachRoad(snapshot, worker, mine, GOLD_MINE_RULES.entryRange)!.at(-1)!;
  expect(Math.hypot(entry.x - mine.x, entry.y - mine.y)).toBeCloseTo(44, 10);
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: [worker.id], resourceId: mine.id });
  stepGame(game);
  expect(game.match.winner).toBeNull();
  expect(worker.order.type === 'mine' && worker.order.phase === 'toMine').toBe(true);
  expect(Math.hypot(worker.x - mine.x, worker.y - mine.y)).toBeLessThan(44);
  stepGame(game);
  expect(worker.order.type === 'mine' && worker.order.phase === 'gather').toBe(true);
});

it('rejects a constructed tower boundary crossed only by the real native entry step', () => {
  const game = entryScene(.1, true), worker = game.units.find(unit => unit.id === 'miner')!;
  const tower = game.buildings.find(building => building.id === 'tower')!;
  // Explicit constructed contract: the ordinary scene's native tower pose
  // and stats stay unchanged. Its mining entry lies just outside480; this
  // is separate from the actual western mine far inside both fire circles.
  const mine = game.resources.find(resource => resource.id === 'ore')!;
  const snapshot = snapshotGame(game), entry = medicalApproachRoad(snapshot, worker, mine, 44)!.at(-1)!;
  expect(Math.hypot(entry.x - tower.x, entry.y - tower.y)).toBeGreaterThan(tower.attackRange);
  expect(miningApproachOutsideFire(snapshot, 'us', worker, mine, { teams: game.teams })).toBe(false);
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: [worker.id], resourceId: mine.id });
  stepGame(game);
  expect(Math.hypot(worker.x - tower.x, worker.y - tower.y)).toBeLessThanOrEqual(tower.attackRange);
  for (let tick = 0; tick < 60 && worker.hp === worker.maxHp; tick++) stepGame(game);
  expect(worker.hp).toBeLessThan(worker.maxHp);
});

it('includes a native grass-to-mud entry step that terrain integration would understate', () => {
  const game = entryScene(.01, true, 790.9), worker = game.units.find(unit => unit.id === 'miner')!;
  // Explicit constructed boundary. Native movement prices the whole tick at
  // its grass origin, even though the last part crosses into the mud cell.
  const cells = Array<string>(128 * 128).fill('.');
  cells[18 * 128 + 25] = 'm';
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: cells.join('') };
  setBuildingBodies(game.map, [...game.buildings, ...game.obstacles ?? []]);
  const snapshot = snapshotGame(game), mine = snapshot.resources.find(resource => resource.id === 'ore')!;
  const tower = snapshot.buildings.find(building => building.id === 'tower')!;
  const entry = medicalApproachRoad(snapshot, worker, mine, GOLD_MINE_RULES.entryRange)!.at(-1)!;
  const integrated = groundSegmentAdvance(snapshot.map, entry, steerPoint(snapshot.map, worker, mine), worker.speed / SIM_TICKS_PER_SECOND);
  expect(Object.values(CELL_GROUND).filter(ground => ground.land).every(ground => ground.pace <= 1)).toBe(true);
  expect(Math.hypot(integrated.x - tower.x, integrated.y - tower.y)).toBeGreaterThan(tower.attackRange);
  const admitted = miningApproachOutsideFire(snapshot, 'us', worker, mine, { teams: game.teams });
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: [worker.id], resourceId: mine.id });
  stepGame(game);
  const nativeStep = { x: worker.x, y: worker.y, gap: Math.hypot(worker.x - tower.x, worker.y - tower.y) };
  expect(nativeStep.gap).toBeLessThanOrEqual(tower.attackRange);
  for (let tick = 0; tick < 60 && worker.hp === worker.maxHp; tick++) stepGame(game);
  expect(worker.hp).toBeLessThan(worker.maxHp);
  console.info('constructed-native-mining-entry', { entry, integrated, nativeStep, towerRange: tower.attackRange,
    hpAfterNativeFire: worker.hp, admitted });
  expect(admitted).toBe(false);
});
