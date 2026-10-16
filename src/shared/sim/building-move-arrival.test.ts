import { describe, expect, it } from 'vitest';
import { createBuilding, createUnit } from '../map';
import { buildingMoveArrival, createGame, createNativeQueryFrame, snapshotGame, stepGame } from '../sim';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.scriptedVictory = true;
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.mercenaryCamps = []; game.projectiles = []; game.effects = [];
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const farm = createBuilding('farm', 'player', 'farm', 1024, 1024, true);
  game.buildings.push(farm);
  const unit = createUnit('patient', 'player', 'footman', 950, 1024);
  unit.order = { type: 'move', x: 995, y: 1024, avoidCombat: true };
  game.units.push(unit);
  return { game, unit, farm, goal: unit.order };
}

describe('native building-caused move arrival query', () => {
  it('uses native steering and the reachable destination without changing the input', () => {
    const { game, unit, goal } = scene();
    const before = snapshotGame(game), nextId = game.nextId;
    const frame = createNativeQueryFrame(game);
    const predicted = buildingMoveArrival(frame, unit, goal, 30)!;
    expect(predicted).toBeDefined();
    expect(predicted.reason).toBe('destination');
    expect(snapshotGame(game)).toStrictEqual(before);
    expect(game.nextId).toBe(nextId);
    while (unit.order.type === 'move' && game.tick < 30) stepGame(game);
    expect(game.tick).toBe(predicted.movementTick);
    expect(unit.order).toEqual({ type: 'idle' });
    expect({ x: unit.x, y: unit.y }).toEqual(predicted.point);
    expect(Math.hypot(unit.x - goal.x, unit.y - goal.y)).toBeGreaterThan(5);
  });

  it('counts an already touching body as one movement step rather than tick zero', () => {
    const { game, unit, farm, goal } = scene();
    unit.x = farm.x - farm.radius - unit.radius - 1;
    const predicted = buildingMoveArrival(createNativeQueryFrame(game), unit, goal, 1)!;
    expect(predicted?.movementTick).toBe(1);
    expect(predicted?.buildingId).toBe(farm.id);
    stepGame(game);
    expect(unit.order.type).toBe('idle');
    expect({ x: unit.x, y: unit.y }).toEqual(predicted.point);
  });

  it('does not reject a near-building goal whose actual walk cannot arrive within the horizon', () => {
    const { game, unit, goal } = scene();
    unit.x = 800;
    expect(buildingMoveArrival(createNativeQueryFrame(game), unit, goal, 15)).toBeUndefined();
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    expect(unit.order.type).toBe('move');
  });

  it('keeps ordinary arrival and no-terrain movement outside the building-contact result', () => {
    const { game, unit } = scene();
    expect(buildingMoveArrival(createNativeQueryFrame(game), unit, { x: unit.x + 1, y: unit.y }, 1)).toBeUndefined();
    delete game.map.terrain;
    const goal = { x: 995, y: 1024 };
    expect(buildingMoveArrival(createNativeQueryFrame(game), unit, goal, 30)).toBeUndefined();
  });

  it('honors current terrain pace in the same native movement path', () => {
    const { game, unit, goal } = scene();
    game.map.terrain!.cells = 'm'.repeat(128 * 128);
    const predicted = buildingMoveArrival(createNativeQueryFrame(game), unit, goal, 60)!;
    while (unit.order.type === 'move' && game.tick < 60) stepGame(game);
    expect(game.tick).toBe(predicted.movementTick);
    expect({ x: unit.x, y: unit.y }).toEqual(predicted.point);
  });

  it('distinguishes circle contact from the terrain destination at the actual 16245 geometry', () => {
    const { game } = scene();
    game.buildings = [createBuilding('hall', 'player', 'townHall', 1520, 3888, true)];
    const patient = createUnit('rider', 'player', 'horseArcher', 1568.857841442834, 3930.7875797658435);
    patient.speed = 99;
    const goal = { x: 1569.0706993622325, y: 3851.5378656243647 };
    patient.order = { type: 'move', ...goal, avoidCombat: true };
    game.units = [patient];
    const predicted = buildingMoveArrival(createNativeQueryFrame(game), patient, goal, 1)!;
    expect(predicted).toMatchObject({ buildingId: 'hall', movementTick: 1, reason: 'buildingContact' });
    stepGame(game);
    expect(patient.order).toEqual({ type: 'idle' });
    expect({ x: patient.x, y: patient.y }).toEqual(predicted.point);
  });
});
