import { expect, it } from 'vitest';
import { createUnit } from '../../shared/map';
import { createGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { createNavalMetricsTracker } from './naval-metrics';
import { UNIT_DEFS } from '../../shared/catalog';

function measurement() {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [] });
  // Two land masses separated by open sea. Read synthetic frames so the assertions
  // exercise the observer independently of boarding/steering policy.
  game.map = { ...game.map, width: 4000, height: 4000, terrain: { cell: 100, cols: 40, rows: 40, cells: ('..........' + '~'.repeat(20) + '..........').repeat(40) } };
  game.units = [];
  game.items = [];
  game.buildings[0]!.x = 500; game.buildings[0]!.y = 500;
  game.buildings[1]!.x = 3500; game.buildings[1]!.y = 500;
  const memory = createAiPolicyMemory();
  const tracker = createNavalMetricsTracker({ minutes: [1], memory: owner => owner === 'player' ? memory : undefined });
  const context = { game, match: {} as never, players: ['player', 'enemy'] };
  const state = tracker.create!(context);
  const sample = (second: number) => { game.tick = second * 20; tracker.afterStep!(state, { ...context, after: game }); };
  const result = () => tracker.finish(state, context as never);
  return { game, memory, sample, result };
}

it('counts an actual remote unload, not a drowning, and an empty return completes the round trip', () => {
  const { game, sample, result } = measurement();
  const boat = createUnit('ferry', 'player', 'transport', 1500, 1500);
  const worker = createUnit('settler', 'player', 'worker', 1500, 1500);
  worker.deck = { shipId: boat.id, x: 0, y: 0 };
  game.units = [boat, worker]; sample(1);
  boat.x = 2900; worker.x = 3500; delete worker.deck; sample(10);
  expect(result().player!.firstLandingSecond).toBe(10);
  expect(result().player!.firstMilitaryLandingSecond).toBeNull();
  expect(result().player!.deliveries).toBe(1);
  boat.x = 1500; sample(20);
  expect(result().player!.roundTrips).toBe(1);
  worker.deck = { shipId: boat.id, x: 0, y: 0 }; sample(21);
  game.units = []; sample(22);
  expect(result().player!.landings).toHaveLength(1);
  expect(result().player!.lostGold).toBe(UNIT_DEFS.transport.cost);
});

it('retains an unfinished island attempt until a complete hall really claims its mine', () => {
  const { game, memory, sample, result } = measurement();
  game.resources = [{ id: 'island', kind: 'goldMine', x: 3500, y: 1500, amount: 6000, startAmount: 6000 }];
  memory.naval = { island: { tick: 0, plan: { mineId: 'island', landing: { x: 2900, y: 1500 } } } };
  sample(1); sample(30);
  const hall = { ...game.buildings[0]!, id: 'colony', x: 3300, y: 1500, complete: false };
  game.buildings.push(hall); delete memory.naval.island; sample(40);
  expect(result().player!.plans[0]!.completedSecond).toBeNull();
  hall.complete = true; sample(60);
  expect(result().player!.plans[0]!.completedSecond).toBe(60);
  expect(result().player!.checkpoints[1]).toEqual({ islandBases: 1, islandMines: 1, islandGold: 6000 });
});

it('does not call a hull turning in place stalled, but measures a stationary move order', () => {
  const { game, sample, result } = measurement();
  const boat = createUnit('ferry', 'player', 'transport', 1500, 1500);
  boat.order = { type: 'move', x: 2000, y: 2000 };
  game.units = [boat];
  for (let second = 1; second <= 60; second++) {
    boat.sailing = { heading: second * .2, speed: 0, load: 0, balance: 0 };
    sample(second);
  }
  expect(result().player!.stalledShipSeconds).toBe(0);
  for (let second = 61; second <= 120; second++) sample(second);
  expect(result().player!.stalledShipSeconds).toBeGreaterThan(25);
  expect(result().player!.idleShipSeconds).toBe(0);
});

it('prices an equipped sunken warship once, including its cannon', () => {
  const { game, sample, result } = measurement();
  const ship = game.spawnUnit('enemy', 'warship', 1800, 1800);
  sample(1);
  game.units = game.units.filter(unit => unit.id !== ship.id);
  sample(2); sample(3);
  expect(result().enemy!.lostGold).toBe(UNIT_DEFS.warship.cost);
  expect(result().player!.enemyLostGold).toBe(UNIT_DEFS.warship.cost);
});
