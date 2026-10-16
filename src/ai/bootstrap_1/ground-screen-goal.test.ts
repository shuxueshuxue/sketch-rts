import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { groundSteeringRoute } from '../../shared/route-selection';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import { circleInPolygon, shipProfile, worldToLocal, type Point } from '../../shared/ship-geometry';
import { isOpenGround, sameGround, setBuildingBodies } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AiPolicyContext } from '../policy/types';
import { groundScreenGoal, groundScreenMoves } from './ground-screen-goal';

type Saved = {
  snapshot: GameSnapshot;
  nextId: number;
  memories: Record<string, AiPolicyMemory>;
  setup: { rulesVersion: number };
};
const SHIP = 'unit-p0-warship-30661';
const LAND = ['unit-p0-summoner-60228', 'unit-p0-summoner-3812'] as const;
const DECK = 'unit-p0-summoner-4065';
const BAD_GOALS = [
  { tick: 122730, x: 2596.701436665876, y: 3638.8835188478056 },
  { tick: 123780, x: 2580.049054455763, y: 3580.070841027671 },
  { tick: 124680, x: 2592.0396387576898, y: 3586.389178659614 },
] as const;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function fixture(): Saved {
  const bytes = readFileSync(new URL('./fixtures/backline-ground-5b5-123600.json.gz', import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('1bbfb8c47e357a57feae38dda64dbfd672c2b216ea7337b6637d15ac855030e5');
  const saved = JSON.parse(gunzipSync(bytes).toString()) as Saved;
  expect(saved.snapshot.tick).toBe(123600);
  expect(saved.setup.rulesVersion).toBe(2);
  expect(Object.keys(saved.memories).sort()).toEqual(['p0', 'p1', 'p2']);
  // Match the public planner's building overlay without constructing a Game.
  setBuildingBodies(saved.snapshot.map, [...saved.snapshot.buildings, ...(saved.snapshot.obstacles ?? [])]);
  return saved;
}
function actor(snapshot: GameSnapshot, id: string): Unit {
  const unit = snapshot.units.find(unit => unit.id === id);
  if (!unit) throw Error('Missing closed-frame actor: ' + id);
  return unit;
}
function context(saved: Saved): AiPolicyContext {
  return { ...(saved.snapshot.teams ? { teams: saved.snapshot.teams } : {}), memory: structuredClone(saved.memories.p0!) };
}
// The private native deckPointOrder uses this exact public-geometry predicate:
// first hull, radius zero, including enemy and not-yet-cleaned-up zero-HP hulls.
// These assertions classify command intent; they do not issue a native command.
function nativeGoalHull(snapshot: GameSnapshot, point: Point) {
  return snapshot.units.find(unit => {
    const profile = shipProfile(unit);
    return profile && circleInPolygon(worldToLocal(unit, point), 0, profile.hull);
  });
}
function expectExecutableGroundGoal(snapshot: GameSnapshot, unit: Unit, point: Point, desired: Point) {
  expect(nativeGoalHull(snapshot, point)).toBeUndefined();
  expect(isOpenGround(snapshot.map, point.x, point.y)).toBe(true);
  expect(sameGround(snapshot.map, unit, point)).toBe(true);
  expect(distance(unit, point)).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);
  // A new station must approach the requested screen rather than return home.
  expect(distance(point, desired)).toBeLessThan(distance(unit, desired));
  const road = groundSteeringRoute(snapshot.map, unit, point);
  expect(road.length).toBeGreaterThan(1);
  expect(distance(road.at(-1)!, point)).toBeLessThanOrEqual(MOVE_ORDER_ARRIVAL_RANGE);
  for (let i = 1; i < road.length; i++) {
    const end = road[i]!;
    expect(constrainGroundShipStep(snapshot.map, unit, road[i - 1]!, end, snapshot.units)).toEqual(end);
  }
}

describe('bootstrap ordinary ground screen destinations', () => {
  // Closed real123600 full frame, not the original preworld at any command tick
  // below. The three historical XYs are explicit geometry counterfactuals at
  // this stationary ship pose. 4065 is already aboard; only60228/3812 are land.
  it.each(BAD_GOALS)('keeps the historical $tick goal off a deck for both actual land actors', desired => {
    for (const id of LAND) {
      const saved = fixture(), unit = actor(saved.snapshot, id);
      expect(unit.deck).toBeUndefined();
      expect(unit.order.type).not.toBe('board');
      expect(nativeGoalHull(saved.snapshot, desired)?.id).toBe(SHIP);
      const before = JSON.stringify(saved);
      const point = groundScreenGoal(saved.snapshot, unit, desired);
      expect(point).toBeDefined();
      if (!point) throw Error('The actual coast needs an executable ground station');
      expect(point).not.toEqual({ x: desired.x, y: desired.y });
      expectExecutableGroundGoal(saved.snapshot, unit, point, desired);
      expect(JSON.stringify(saved)).toBe(before);
    }
  });

  it('preserves a nearby unaffected move, its queue and avoidance values', () => {
    const saved = fixture(), unit = actor(saved.snapshot, LAND[0]), options = context(saved);
    const desired = { x: unit.x + 8, y: unit.y + 8 };
    expect(isOpenGround(saved.snapshot.map, desired.x, desired.y)).toBe(true);
    expect(nativeGoalHull(saved.snapshot, desired)).toBeUndefined();
    expect(groundScreenGoal(saved.snapshot, unit, desired)).toBe(desired);
    const commands: GameCommand[] = [
      { type: 'move', unitIds: [unit.id], ...desired, queued: true, avoidCombat: true },
      { type: 'attack', unitIds: [unit.id], targetId: 'unchanged-target', queued: true },
    ];
    const before = JSON.stringify({ saved, options, commands });
    expect(groundScreenMoves(saved.snapshot, 'p0', options, commands)).toBe(commands);
    expect(JSON.stringify({ saved, options, commands })).toBe(before);
  });

  // This is the common adapter only. Family screen entrypoints, full-owner
  // planning and native continuation need their own actual-context evidence.
  it('publishes a nonself ground move while preserving other command order', () => {
    const saved = fixture(), unit = actor(saved.snapshot, LAND[0]), options = context(saved);
    const first: GameCommand = { type: 'holdPosition', unitIds: [DECK] };
    const move: GameCommand = { type: 'move', unitIds: [unit.id], x: BAD_GOALS[0].x, y: BAD_GOALS[0].y,
      avoidCombat: true, queued: true };
    const last: GameCommand = { type: 'follow', unitIds: [DECK], targetId: SHIP };
    const commands = [first, move, last], before = JSON.stringify({ saved, options, commands });
    const result = groundScreenMoves(saved.snapshot, 'p0', options, commands);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(first);
    expect(result[2]).toBe(last);
    const replacement = result[1]!;
    expect(replacement.type).toBe('move');
    if (replacement.type !== 'move') throw Error('The actual coast must yield progress, not a hold');
    expect(replacement.unitIds).toEqual([unit.id]);
    expect(replacement.queued).toBe(true);
    expect(replacement.avoidCombat).toBe(true);
    expectExecutableGroundGoal(saved.snapshot, unit, replacement, move);
    expect(JSON.stringify({ saved, options, commands })).toBe(before);
  });

  it('preserves explicit boarding commands by reference', () => {
    const saved = fixture(), options = context(saved);
    const commands: GameCommand[] = [
      { type: 'board', unitIds: [LAND[0]], transportId: SHIP },
      { type: 'boardShip', unitIds: [LAND[1]], targetId: SHIP, queued: true },
    ];
    expect(groundScreenMoves(saved.snapshot, 'p0', options, commands)).toBe(commands);
  });

  it.each(['deck', 'native-board', 'ferry-crew', 'naval-hull'] as const)(
    'preserves the %s owner instead of redirecting it to ground', role => {
      const saved = fixture(), options = context(saved);
      const unit = actor(saved.snapshot, role === 'deck' ? DECK : role === 'naval-hull' ? SHIP : LAND[0]);
      if (role === 'deck') expect(unit.deck?.shipId).toBe(SHIP);
      if (role === 'native-board') unit.order = { type: 'board', transportId: SHIP };
      if (role === 'ferry-crew') {
        // Explicit ownership counterfactual; this frame has no ferry mission.
        options.memory.naval ??= {};
        options.memory.naval.ferries = { [SHIP]: {
          purpose: 'assault', targetId: 'contract-target', from: { x: unit.x, y: unit.y },
          to: { x: BAD_GOALS[0].x, y: BAD_GOALS[0].y }, phase: 'loading',
          crewIds: [unit.id], sinceTick: saved.snapshot.tick,
        } };
      }
      const commands: GameCommand[] = [
        { type: 'move', unitIds: [unit.id], x: BAD_GOALS[0].x, y: BAD_GOALS[0].y, queued: true, avoidCombat: true },
      ];
      const before = JSON.stringify({ saved, options, commands });
      expect(groundScreenMoves(saved.snapshot, 'p0', options, commands)).toBe(commands);
      expect(JSON.stringify({ saved, options, commands })).toBe(before);
    },
  );

  it.each(['enemy', 'zero-hp'] as const)('does not mistake a %s hull goal for ground', kind => {
    const saved = fixture(), unit = actor(saved.snapshot, LAND[0]), ship = actor(saved.snapshot, SHIP);
    // Explicit native point-selection counterfactuals, before cleanup.
    if (kind === 'enemy') ship.owner = 'p1'; else ship.hp = 0;
    expect(nativeGoalHull(saved.snapshot, BAD_GOALS[0])?.id).toBe(SHIP);
    const before = JSON.stringify(saved);
    const point = groundScreenGoal(saved.snapshot, unit, BAD_GOALS[0]);
    expect(point).toBeDefined();
    if (!point) throw Error('A hull owner or HP change must not erase the reachable shore');
    expectExecutableGroundGoal(saved.snapshot, unit, point, BAD_GOALS[0]);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('publishes an explicit unqueued hold when every ground candidate is rejected', () => {
    const saved = fixture(), snapshot = saved.snapshot, options = context(saved);
    const unit = actor(snapshot, LAND[0]), ship = actor(snapshot, SHIP), terrain = snapshot.map.terrain!;
    const col = Math.floor(unit.x / terrain.cell), row = Math.floor(unit.y / terrain.cell);
    const cell = row * terrain.cols + col;
    // Explicit geometry negative: one land cell, covered by a stationary hull.
    // Fresh cloned units have no earlier collision frame; the live game and
    // the historical map/ship never receive these edits.
    const cells = '~'.repeat(terrain.cells.length);
    snapshot.map = { ...snapshot.map, terrain: { ...terrain,
      cells: cells.slice(0, cell) + '.' + cells.slice(cell + 1),
    } };
    ship.x = (col + .5) * terrain.cell;
    ship.y = (row + .5) * terrain.cell;
    const desired = { x: ship.x, y: ship.y };
    unit.order = { type: 'move', ...desired, deckShipId: SHIP, deckPoint: { x: 0, y: 0 } };
    unit.orderQueue = [];
    setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
    expect(unit.deck).toBeUndefined();
    expect(isOpenGround(snapshot.map, unit.x, unit.y)).toBe(true);
    expect(nativeGoalHull(snapshot, desired)?.id).toBe(SHIP);
    const before = JSON.stringify({ saved, options });
    expect(groundScreenGoal(snapshot, unit, desired)).toBeUndefined();
    const commands: GameCommand[] = [{ type: 'move', unitIds: [unit.id], ...desired }];
    const result = groundScreenMoves(snapshot, 'p0', options, commands);
    // sim581–584 issues a fresh hold order, replacing the hazardous move;
    // this pure contract checks publication, not native movement or survival.
    expect(result).toEqual([{ type: 'holdPosition', unitIds: [unit.id] }]);
    expect(result.some(command => command.type === 'move')).toBe(false);
    expect(JSON.stringify({ saved, options })).toBe(before);
  });
});
