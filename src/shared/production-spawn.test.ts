import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from './catalog';
import { createBuilding, createUnit } from './map';
import { GOLD_MINE_RULES } from './mining';
import { landSpawnPoint, landSpawnPrototype, productionRallyPoint } from './production-spawn';
import { shipBodyClearAtPose } from './ship-collisions';
import { shipLaunchPose, shipLaunchPrototype } from './ship-launch';
import { hullFits } from './ship-navigation';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { footprintHalf, setBuildingBodies } from './terrain';
import type { GameMap, Obstacle, UnitKind } from './types';

function scene(terrain = true) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.map = { ...game.map, width: 1280, height: 1280, ...(terrain ? { terrain: { cell: 32, cols: 40, rows: 40, cells: '.'.repeat(1600) } } : {}) };
  if (!terrain) delete game.map.terrain;
  game.units = []; game.resources = []; game.items = []; game.mercenaryCamps = []; game.shops = [];
  game.scriptedVictory = true;
  const building = createBuilding('producer', 'player', 'barracks', 656, 656, true);
  game.buildings = [building]; game.players.player.gold = 10000; game.players.player.supplyCap = 100;
  setBuildingBodies(game.map, game.buildings);
  return { game, building };
}
function probe(context: ReturnType<typeof scene>, kind: UnitKind = 'footman') {
  return landSpawnPrototype(context.building, kind);
}
function gate(id: string, x: number, y: number, radius = 16): Obstacle {
  return { id, kind: 'gate', owner: 'neutral', x, y, radius, hp: 300, maxHp: 300, along: { x: 0, y: 1 } };
}
function setCells(context: ReturnType<typeof scene>, char: (col: number, row: number) => string) {
  context.game.map.terrain = { ...context.game.map.terrain!, cells: Array.from({ length: 1600 }, (_, at) => char(at % 40, Math.floor(at / 40))).join('') };
  setBuildingBodies(context.game.map, [...context.game.buildings, ...(context.game.obstacles ?? [])]);
}
function waterMap(): GameMap {
  return { ...scene().game.map, width: 1600, height: 1280, terrain: { cell: 32, cols: 50, rows: 40,
    cells: Array.from({ length: 2000 }, (_, at) => at % 50 < 10 ? '.' : '~').join('') } };
}

describe('rally-directed production exits', () => {
  it.each([true, false])('exits from the rally side with complete body clearance (terrain %s)', terrain => {
    const context = scene(terrain), { game, building } = context, unit = probe(context);
    building.rallyX = 1100; building.rallyY = building.y;
    const east = landSpawnPoint(game, building, unit)!;
    expect(east.x).toBeGreaterThan(building.x);
    const half = terrain ? footprintHalf(building.radius, 32) : building.radius;
    expect(east.x - building.x - half).toBeGreaterThanOrEqual(unit.radius + 3.99);
    expect(east.x - building.x).toBeLessThanOrEqual(half + unit.radius + 4.01);
    building.rallyX = 100;
    const west = landSpawnPoint(game, building, unit)!;
    expect(west.x).toBeLessThan(building.x);
    expect(west.y).toBe(building.y);
  });

  it('updates a moving ally rally and an active resource rally without recreating body probes', () => {
    const context = scene(), { game, building } = context, unit = probe(context);
    const target = createUnit('ally', 'player', 'archer', 1100, building.y); game.units.push(target);
    building.rallyTarget = { type: 'unit', unitId: target.id };
    expect(landSpawnPoint(game, building, unit)!.x).toBeGreaterThan(building.x);
    target.x = 100;
    expect(landSpawnPoint(game, building, unit)!.x).toBeLessThan(building.x);
    expect(probe(context)).toBe(unit);
    game.resources.push({ id: 'gold', kind: 'goldMine', x: building.x, y: 1100, amount: 100 });
    building.rallyTarget = { type: 'resource', resourceId: 'gold' };
    expect(productionRallyPoint(game, building)).toEqual({ x: building.x, y: 1100 });
    expect(landSpawnPoint(game, building, unit)!.y).toBeGreaterThan(building.y);
  });

  it('chooses a nearby free exit around a body rather than overlapping the preferred spawn', () => {
    const context = scene(), { game, building } = context, unit = probe(context);
    building.rallyX = 1100; building.rallyY = building.y;
    const first = landSpawnPoint(game, building, unit)!;
    const blocker = createUnit('traffic', 'player', 'footman', first.x, first.y); game.units.push(blocker);
    const alternative = landSpawnPoint(game, building, unit)!;
    expect(alternative.x).toBeGreaterThan(building.x);
    expect(Math.hypot(alternative.x - blocker.x, alternative.y - blocker.y)).toBeGreaterThanOrEqual(unit.radius + blocker.radius + 3.99);
    blocker.hp = 0;
    expect(landSpawnPoint(game, building, unit)).toEqual(first);
  });

  it('avoids a nearby gold mine body and retains the trained worker resource rally', () => {
    const { game, building } = scene();
    Object.assign(building, createBuilding(building.id, 'player', 'townHall', 656, 656, true));
    setBuildingBodies(game.map, game.buildings);
    const mine = { id: 'close-mine', kind: 'goldMine' as const, x: building.x + 88, y: building.y, amount: 1000 };
    game.resources.push(mine);
    issuePlayerCommand(game, 'player', { type: 'setRally', buildingIds: [building.id], x: mine.x, y: mine.y, target: { type: 'resource', resourceId: mine.id } });
    issuePlayerCommand(game, 'player', { type: 'train', buildingId: building.id, unitKind: 'worker' });
    building.queue[0]!.remaining = 1;
    stepGame(game);
    const worker = game.units.find(unit => unit.kind === 'worker')!;
    expect(worker).toBeDefined(); expect(building.queue).toHaveLength(0);
    expect(Math.hypot(worker.x - mine.x, worker.y - mine.y)).toBeGreaterThanOrEqual(worker.radius + GOLD_MINE_RULES.radius + 3.99);
    expect(worker.order).toMatchObject({ type: 'mine', resourceId: mine.id });
  });

  it('uses the training building rally for the actual unit position and subsequent move', () => {
    const { game, building } = scene();
    building.rallyX = 100; building.rallyY = building.y;
    issuePlayerCommand(game, 'player', { type: 'train', buildingId: building.id, unitKind: 'footman' });
    building.queue[0]!.remaining = 1;
    stepGame(game);
    const unit = game.units.find(unit => unit.kind === 'footman')!;
    expect(unit.x).toBeLessThan(building.x); expect(unit.order).toMatchObject({ type: 'move', x: 100, y: building.y });
  });

  it('does not jump over a terrain barrier to an outer free row', () => {
    const context = scene(), { game, building } = context;
    setCells(context, col => col === 22 ? '#' : '.');
    building.rallyX = 1100; building.rallyY = building.y;
    const from = landSpawnPoint(game, building, probe(context))!;
    expect(from.x).toBeLessThan(22 * 32);
  });

  it('does not jump past a neighboring gate and reacts when that gate is destroyed', () => {
    const context = scene(), { game, building } = context, unit = probe(context);
    building.rallyX = 1100; building.rallyY = building.y;
    const blocker = gate('near-gate', 736, 656, 32); game.obstacles = [blocker];
    setBuildingBodies(game.map, [...game.buildings, blocker]);
    const blocked = landSpawnPoint(game, building, unit)!;
    expect(blocked.x).toBeLessThan(736);
    expect(Math.hypot(Math.max(0, Math.abs(blocked.x - blocker.x) - 32), Math.max(0, Math.abs(blocked.y - blocker.y) - 32))).toBeGreaterThanOrEqual(unit.radius + 3.99);
    blocker.hp = 0; setBuildingBodies(game.map, game.buildings);
    const reopened = landSpawnPoint(game, building, unit)!;
    expect(reopened.x).toBeGreaterThan(building.x); expect(reopened.y).toBe(building.y);
  });

  it('waits for a traffic-blocked rally-side gateway instead of birthing into an isolated courtyard', () => {
    const context = scene(), { game, building } = context, unit = probe(context);
    // A building in the gap of a full-height wall separates its two exits.
    setCells(context, (col, row) => col >= 19 && col <= 21 && (row < 19 || row > 21) ? '#' : '.');
    building.rallyX = 1100; building.rallyY = building.y;
    const blocker = createUnit('east-traffic', 'player', 'rockGolem', 812, 656);
    blocker.radius = blocker.bodyRadius = 128; game.units.push(blocker);
    expect(landSpawnPoint(game, building, unit)).toBeUndefined();
    blocker.x = 1100;
    expect(landSpawnPoint(game, building, unit)!.x).toBeGreaterThan(building.x);
  });

  it('keeps a completed paid land job queued, then releases once without extra payment or lost IDs', () => {
    const context = scene(), { game, building } = context;
    issuePlayerCommand(game, 'player', { type: 'train', buildingId: building.id, unitKind: 'footman' });
    const job = building.queue[0]!; job.remaining = 1;
    const blocker = createUnit('traffic', 'player', 'rockGolem', building.x, building.y);
    blocker.radius = blocker.bodyRadius = 500; blocker.order = { type: 'hold', x: blocker.x, y: blocker.y }; game.units.push(blocker);
    const balance = game.players.player.gold, id = game.nextId;
    for (let tick = 0; tick < 3; tick++) stepGame(game);
    expect(building.queue).toEqual([job]); expect(job.remaining).toBe(0); expect(game.nextId).toBe(id);
    expect(game.players.player.gold).toBe(balance); expect(balance).toBe(10000 - UNIT_DEFS.footman.cost);
    const saved = snapshotGame(game), replay = scene().game;
    restoreSnapshotIntoGame(replay, saved, game.nextId);
    for (const world of [game, replay]) world.units.find(body => body.id === blocker.id)!.hp = 0;
    for (let tick = 0; tick < 3; tick++) {
      stepGame(game); stepGame(replay); expect(checksumGame(replay)).toBe(checksumGame(game));
    }
    expect(building.queue).toHaveLength(0); expect(game.units.filter(unit => unit.kind === 'footman')).toHaveLength(1);
    expect(game.nextId).toBe(id + 1); expect(game.players.player.gold).toBe(balance);
  });

  it('launches toward the live water rally while preserving hull and pier clearance', () => {
    const { game, building: dock } = scene(); game.map = waterMap();
    Object.assign(dock, createBuilding(dock.id, 'player', 'shipyard', 304, 624, true));
    dock.rallyX = 1200; dock.rallyY = 200;
    const ship = shipLaunchPrototype(dock, 'transport'), north = shipLaunchPose(game, dock, ship)!;
    dock.rallyY = 1100;
    const south = shipLaunchPose(game, dock, ship)!;
    expect(north.y).toBeLessThan(south.y);
    for (const pose of [north, south]) {
      expect(hullFits(game.map, ship, pose)).toBe(true);
      expect(shipBodyClearAtPose(game.map, ship, pose, [dock])).toBe(true);
      expect(pose.x).toBeGreaterThan(dock.x);
    }
  });

  it('keeps a sea rally in a separate pond from changing this pier into a cross-land teleporter', () => {
    const { game, building: dock } = scene(); game.map = waterMap();
    Object.assign(dock, createBuilding(dock.id, 'player', 'shipyard', 304, 624, true));
    game.map.terrain!.cells = Array.from({ length: 2000 }, (_, at) => at % 50 >= 10 && at % 50 <= 11 && Math.floor(at / 50) >= 17 && Math.floor(at / 50) <= 21 || at % 50 >= 14 ? '~' : '.').join('');
    dock.rallyX = 1100; dock.rallyY = 624;
    expect(shipLaunchPose(game, dock, shipLaunchPrototype(dock, 'carrier'))).toBeUndefined();
  });

  it('points a freely departing hull bow toward the water rally', () => {
    const { game, building: dock } = scene(); game.map = waterMap();
    Object.assign(dock, createBuilding(dock.id, 'player', 'shipyard', 304, 624, true));
    dock.rallyX = 1200; dock.rallyY = dock.y;
    const pose = shipLaunchPose(game, dock, shipLaunchPrototype(dock, 'transport'))!;
    expect(pose.y).toBe(dock.y); expect(pose.heading).toBe(0);
  });

  it('does not launch an outer hull row across a short peninsula even when water joins around its ends', () => {
    const { game, building: dock } = scene(); game.map = waterMap();
    Object.assign(dock, createBuilding(dock.id, 'player', 'shipyard', 304, 624, true));
    game.map.terrain = { ...game.map.terrain!, cells: Array.from({ length: 2000 }, (_, at) => at % 50 < 10 || at % 50 === 12 && Math.floor(at / 50) >= 16 && Math.floor(at / 50) <= 22 ? '.' : '~').join('') };
    dock.rallyX = 1100; dock.rallyY = 624;
    expect(shipLaunchPose(game, dock, shipLaunchPrototype(dock, 'carrier'))).toBeUndefined();
  });
});
