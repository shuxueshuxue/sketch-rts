import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../sim';
import { decksCanTransfer, decksSupportCrossing } from '../connected-decks';
import { shipPointVelocity } from '../ship-collisions';
import { headingDifference } from '../ship-navigation';
import { SIM_TICKS_PER_SECOND } from '../time';
import { advanceShip, beginShipMotionFrame, retainedShipYawRate, shipMotionLimits } from '../ship-motion';
import { shipProfile } from '../ship-geometry';

function ordinaryService() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ordinary-service-yaw-39600.json.gz', import.meta.url))).toString());
  expect(saved.provenance.classification).toContain('Actual ordinary bootstrapGame opening');
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const source = game.units.find(unit => unit.id === 'unit-p0-warship-1064')!;
  const target = game.units.find(unit => unit.id === 'unit-p0-warship-1127')!;
  const worker = game.units.find(unit => unit.id === 'unit-p0-worker-1833')!;
  return { game, source, target, worker };
}

it.each(['existing', 'stop', 'board', 'stop-and-board'] as const)
  ('releases the ordinary service seam after an actually motionless tick with %s public orders', orders => {
    const { game, source, target, worker } = ordinaryService();
    expect(source.sailing!.yawRate).toBeGreaterThan(.2);
    expect(decksSupportCrossing(source, target, worker)).toBe(true);
    expect(decksCanTransfer(source, target, worker)).toBe(false);
    if (orders.includes('stop')) issuePlayerCommand(game, 'p0', { type: 'stop', unitIds: [source.id, target.id] });
    if (orders.includes('board')) issuePlayerCommand(game, 'p0', { type: 'board', unitIds: [worker.id], transportId: target.id });
    // A command cannot rewrite the preceding completed tick's physical rate.
    expect(decksCanTransfer(source, target, worker)).toBe(false);
    const before = [source, target].map(ship => ({ x: ship.x, y: ship.y, heading: ship.sailing!.heading }));
    const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId }));
    const restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId);
    stepGame(game); stepGame(restored);
    expect([source, target].map(ship => ({ x: ship.x, y: ship.y, heading: ship.sailing!.heading }))).toEqual(before);
    expect(source.sailing).toMatchObject({ yawRate: 0, speed: 0, velocityX: 0, velocityY: 0 });
    expect(decksCanTransfer(source, target, worker)).toBe(true);
    expect(shipPointVelocity(source, worker)).toEqual({ x: 0, y: 0 });
    expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
  });

it('retains actual in-place weapon rotation in saved point velocity instead of treating it as a stationary seam', () => {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 2400, height: 2400, terrain: { cell: 40, cols: 60, rows: 60, cells: '~'.repeat(3600) } };
  const ship = game.spawnUnit('player', 'warship', 1000, 1000), target = game.spawnUnit('enemy', 'transport', 1300, 1000);
  ship.sailing!.heading = Math.PI / 2;
  issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: target.id });
  const start = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
  stepGame(game);
  const angularTravel = headingDifference(start.heading, ship.sailing!.heading);
  expect(angularTravel).toBeLessThan(-.01); expect({ x: ship.x, y: ship.y }).toEqual({ x: start.x, y: start.y });
  const atBow = { x: ship.x, y: ship.y + 100 };
  const velocity = shipPointVelocity(ship, atBow);
  expect(velocity.x).toBeCloseTo(-angularTravel * SIM_TICKS_PER_SECOND * 100, 8);
  expect(Math.abs(velocity.x)).toBeGreaterThan(20);
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId }));
  const restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId);
  restored.scriptedVictory = true;
  expect(shipPointVelocity(restored.units.find(unit => unit.id === ship.id)!, atBow)).toEqual(velocity);
  for (let tick = 0; tick < 15; tick++) { stepGame(game); stepGame(restored); }
  expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
});

function pivotContactScene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = []; game.obstacles = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 4096, height: 4096, terrain: { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) } };
  const ship = game.spawnUnit('player', 'transport', 1600, 1600), other = game.spawnUnit('player', 'transport', 1800, 1900);
  ship.x = 1600; ship.y = 1600; other.x = 1700; other.y = 1600 + 2 * Math.max(...shipProfile(ship)!.hull.map(point => point.y)) + 1;
  ship.sailing!.heading = 0; other.sailing!.heading = 0; ship.sailing!.speed = 15; ship.sailing!.yawRate = .3;
  const lever = 50, pivot = { x: ship.x - lever, y: ship.y }, goal = { x: pivot.x + lever * Math.cos(Math.PI / 4), y: pivot.y + lever * Math.sin(Math.PI / 4) };
  issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], ...goal, avoidCombat: true });
  ship.sailing!.route = { goalX: goal.x, goalY: goal.y, points: [{ ...goal, heading: Math.PI / 4, pivot }], end: goal, cruise: false };
  return { game, ship, other };
}

it('keeps a partial pivot collision stopped at the saved boundary and through the next native ticks', () => {
  const { game, ship, other } = pivotContactScene();
  for (let tick = 0; tick < 4; tick++) stepGame(game);
  const heading = ship.sailing!.heading, hp = ship.hp;
  stepGame(game);
  expect(ship.hp).toBeLessThan(hp); expect(other.hp).toBe(ship.hp);
  expect(ship.sailing!.heading).toBeGreaterThan(heading);
  expect(ship.sailing!.heading - heading).toBeLessThan(shipMotionLimits(ship).turnRate / SIM_TICKS_PER_SECOND);
  expect(ship.sailing).toMatchObject({ speed: 0, yawRate: 0 });
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId }));
  const restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId); restored.scriptedVictory = true;
  const contactHp = ship.hp;
  for (let tick = 0; tick < 15; tick++) { stepGame(game); stepGame(restored); }
  expect(ship.hp).toBe(contactHp); expect(other.hp).toBe(contactHp);
  expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
});

it('retains only a later legal turn after contact rather than restoring the spent pivot travel', () => {
  const { game, ship } = pivotContactScene();
  const start = ship.sailing!.heading;
  let contact = false;
  for (let tick = 0; tick < 5; tick++) {
    beginShipMotionFrame(game.units, game.map);
    if (!advanceShip(ship, game.map, game.units, { yaw: .015, pivotLever: 50 })) { contact = true; break; }
  }
  expect(contact).toBe(true); expect(ship.sailing!.heading).toBeGreaterThan(start);
  expect(retainedShipYawRate(ship, start)).toBe(0);
  const contactHeading = ship.sailing!.heading;
  expect(advanceShip(ship, game.map, game.units, { yaw: -.001 })).toBe(true);
  expect(retainedShipYawRate(ship, start)).toBeCloseTo(headingDifference(contactHeading, ship.sailing!.heading) * SIM_TICKS_PER_SECOND, 10);
  expect(retainedShipYawRate(ship, start)).toBeCloseTo(-.02, 10);
});

it.each([false, true])('also spends an already-turned struck hull angular momentum, reversed unit order=%s', reverse => {
  const { game, ship, other } = pivotContactScene();
  ship.order = { type: 'idle' }; other.order = { type: 'idle' };
  ship.x = 1600; ship.y = 1600; other.x = ship.x + 2 * Math.max(...shipProfile(ship)!.hull.map(point => point.x)) + .4; other.y = ship.y;
  Object.assign(ship.sailing!, { heading: 0, speed: 64, velocityX: 64, velocityY: 0, route: undefined });
  Object.assign(other.sailing!, { heading: Math.PI, speed: 64, velocityX: -64, velocityY: 0, route: undefined });
  if (reverse) game.units.reverse();
  const starts = new Map(game.units.map(unit => [unit.id, unit.sailing!.heading]));
  beginShipMotionFrame(game.units, game.map);
  expect(advanceShip(other, game.map, game.units, { yaw: .001 })).toBe(true);
  expect(other.sailing!.heading).not.toBe(starts.get(other.id));
  expect(advanceShip(ship, game.map, game.units, { surge: 64 / SIM_TICKS_PER_SECOND })).toBe(false);
  expect(other.sailing).toMatchObject({ speed: 0, yawRate: 0 });
  for (const boat of [ship, other]) {
    boat.sailing!.yawRate = retainedShipYawRate(boat, starts.get(boat.id));
    expect(boat.sailing!.yawRate).toBe(0);
  }
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId }));
  const restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId); restored.scriptedVictory = true;
  for (let tick = 0; tick < 5; tick++) { stepGame(game); stepGame(restored); }
  expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
});
