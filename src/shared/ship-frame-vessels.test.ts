import { describe, expect, it } from 'vitest';
import { createBuilding, createUnit } from './map';
import { beginShipCollisionFrame, drainShipCollisionImpacts, groundShipFrameEmpty, shipCollisionImpactCount } from './ship-collisions';
import { shipProfile, shipsIn } from './ship-geometry';
import { advanceShip, beginShipMotionFrame, shipMotionLimits } from './ship-motion';
import { beginShipPlanningFrame, hasShipPlanningFrame, tryConsumeShipPlan } from './ship-planning-budget';
import { createGame, issuePlayerCommand, stepGame } from './sim';
import { perTick } from './time';
import type { GameMap, Unit } from './types';

function sea(): GameMap {
  return { ...createGame('bareDuel', { aiPlayers: [] }).map, width: 4096, height: 4096,
    terrain: { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) } };
}

function vessel(id: string, x = 1000): Unit {
  const ship = createUnit(id, 'player', 'transport', x, 1000);
  ship.sailing = { heading: 0, speed: 64, load: 0, balance: 0, velocityX: 64, velocityY: 0 };
  ship.order = { type: 'move', x: 3000, y: 1000 };
  return ship;
}

describe('explicit simulation vessel frames', () => {
  it('admits a hull trained after an empty tick, then clears its frame on death and the following empty tick', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.units = []; game.items = []; game.resources = []; game.mercenaryCamps = []; game.shops = [];
    game.obstacles = []; game.effects = []; game.projectiles = []; game.scriptedVictory = true;
    let cells = '';
    for (let y = 0; y < 40; y++) for (let x = 0; x < 50; x++) cells += x < 10 ? '.' : '~';
    game.map = { ...game.map, width: 1600, height: 1280, terrain: { cell: 32, cols: 50, rows: 40, cells } };
    const dock = createBuilding('dock', 'player', 'shipyard', 304, 624, true);
    game.buildings = [dock]; game.players.player.gold = 10000; game.players.player.supplyCap = 100;
    issuePlayerCommand(game, 'player', { type: 'train', buildingId: dock.id, unitKind: 'transport' });
    dock.queue[0]!.remaining = 2;

    expect(groundShipFrameEmpty(game.units)).toBe(false);
    stepGame(game);
    expect(game.units).toHaveLength(0);
    expect(groundShipFrameEmpty(game.units)).toBe(true);
    const trainingUnits = game.units;
    stepGame(game);
    const ship = game.units[0]!;
    expect(game.units).toBe(trainingUnits);
    expect(ship.kind).toBe('transport');
    expect(dock.queue).toHaveLength(0);
    expect(hasShipPlanningFrame(ship)).toBe(true);
    expect(groundShipFrameEmpty(game.units)).toBe(false);

    ship.hp = 0;
    stepGame(game);
    expect(game.units).toHaveLength(0);
    expect(game.units).not.toBe(trainingUnits);
    expect(groundShipFrameEmpty(trainingUnits)).toBe(true);
    expect(shipCollisionImpactCount(trainingUnits)).toBe(0);
    expect(drainShipCollisionImpacts(trainingUnits)).toEqual([]);
    // A new array has no collision frame until its first actual simulation step.
    expect(groundShipFrameEmpty(game.units)).toBe(false);
    stepGame(game);
    expect(groundShipFrameEmpty(game.units)).toBe(true);
    expect(shipCollisionImpactCount(game.units)).toBe(0);
  });

  it('keeps non-ship shore passengers in the planning frame and observes ownership changes', () => {
    const ship = vessel('ferry'); ship.order = { type: 'idle' };
    const passenger = createUnit('passenger', 'player', 'footman', 900, 1000);
    passenger.order = { type: 'board', transportId: ship.id };
    const units = [ship, passenger], vessels = shipsIn(units);
    expect(vessels).toEqual([ship]);
    beginShipPlanningFrame(units, 10, vessels);
    expect(tryConsumeShipPlan(ship)).toBe(true);

    passenger.owner = 'enemy';
    beginShipPlanningFrame(units, 11, vessels);
    expect(tryConsumeShipPlan(ship)).toBe(false);
    expect(ship.sailing!.planningRequestedAtTick).toBeUndefined();
  });

  it('resets a dead hull motion budget and prunes its planning ticket without filtering it out of the view', () => {
    const map = sea(), ship = vessel('returning'), units = [ship], vessels = shipsIn(units);
    const travel = perTick(shipMotionLimits(ship).speed);
    beginShipMotionFrame(units, map, [], vessels);
    expect(advanceShip(ship, map, units, { surge: 999 })).toBe(true);
    const spentAt = ship.x;
    expect(advanceShip(ship, map, units, { surge: 999 })).toBe(true);
    expect(ship.x).toBe(spentAt);
    ship.sailing!.planningRequestedAtTick = 4;
    ship.sailing!.planningLastRequestedAtTick = 10;
    ship.hp = 0;
    beginShipMotionFrame(units, map, [], vessels);
    beginShipPlanningFrame(units, 11, vessels);
    expect(groundShipFrameEmpty(units)).toBe(true);
    expect(ship.sailing!.planningRequestedAtTick).toBeUndefined();
    expect(ship.sailing!.planningLastRequestedAtTick).toBeUndefined();

    // Direct callers can revive the same object; the dead frame already renewed its budget.
    ship.hp = ship.maxHp;
    expect(advanceShip(ship, map, units, { surge: 999 })).toBe(true);
    expect(ship.x - spentAt).toBeCloseTo(travel, 6);
  });

  it('builds all collision bodies from the full unit list and clears undrained impacts in a dead fleet', () => {
    const map = sea(); map.terrain!.cells = ','.repeat(128 * 128);
    const ship = vessel('moving'), bow = Math.max(...shipProfile(ship)!.hull.map(point => point.x));
    const walker = createUnit('walker', 'enemy', 'footman', ship.x + bow + 16 + .4, ship.y);
    walker.radius = 16;
    const units = [ship, walker], vessels = shipsIn(units), origin = ship.x;
    beginShipMotionFrame(units, map, [], vessels);
    expect(advanceShip(ship, map, units, { surge: perTick(64) })).toBe(false);
    expect(shipCollisionImpactCount(units)).toBe(1);
    expect(drainShipCollisionImpacts(units)[0]?.other).toBe(walker);

    // Produce another real impact, then leave it undrained before the empty-hull frame.
    ship.x = origin;
    ship.sailing!.speed = 64; ship.sailing!.velocityX = 64;
    beginShipMotionFrame(units, map, [], vessels);
    advanceShip(ship, map, units, { surge: perTick(64) });
    expect(shipCollisionImpactCount(units)).toBe(1);
    ship.hp = 0;
    beginShipCollisionFrame(units, map, [], vessels);
    expect(groundShipFrameEmpty(units)).toBe(true);
    expect(shipCollisionImpactCount(units)).toBe(0);
    expect(drainShipCollisionImpacts(units)).toEqual([]);
  });

  it('retains direct full scans after an equal-length array replacement despite a previously cached empty view', () => {
    const map = sea(), units = [createUnit('walker', 'player', 'footman', 700, 1000)];
    expect(shipsIn(units)).toEqual([]);
    beginShipMotionFrame(units, map);
    expect(groundShipFrameEmpty(units)).toBe(true);
    const ship = vessel('replacement'), bow = Math.max(...shipProfile(ship)!.hull.map(point => point.x));
    const dock = createBuilding('dock', 'player', 'shipyard', ship.x + bow + 32 + .4, ship.y, true);
    dock.radius = 32;
    units[0] = ship;
    beginShipMotionFrame(units, map, [dock]);
    beginShipPlanningFrame(units, 10);
    expect(groundShipFrameEmpty(units)).toBe(false);
    expect(hasShipPlanningFrame(ship)).toBe(true);
    expect(tryConsumeShipPlan(ship)).toBe(true);
    expect(advanceShip(ship, map, units, { surge: perTick(64) })).toBe(false);
    expect(drainShipCollisionImpacts(units)[0]?.other).toBe(dock);
  });
});
