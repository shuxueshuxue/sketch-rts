import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unitMover } from '../../shared/catalog';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import * as routes from '../../shared/route-selection';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import { circleInPolygon, distanceToHull, shipProfile, worldToLocal, type Point } from '../../shared/ship-geometry';
import * as terrain from '../../shared/terrain';
import type { GameCommand, GameSnapshot, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { frontRecovery, postRecoveryAssignments, postRecoveryCommands } from './front-recovery';
import { groundScreenGoal, groundScreenMoves } from './ground-screen-goal';
import { bootstrapPolicyContext } from './policy';

type Move = Extract<GameCommand, { type: 'move' }>;
type SavedContext = {
  snapshot: GameSnapshot;
  plannerSnapshot: GameSnapshot;
  memories: Record<string, AiPolicyMemory>;
  setup: { rulesVersion: number; agents: { p0: { version: string } } };
  phase: string;
  entries?: { playerId: string; scriptId: string; command: GameCommand }[];
};
type Fixture = {
  sourceHead: string;
  contexts: Record<string, { before: SavedContext; after: SavedContext }>;
};
const SHIP = 'unit-p0-warship-30661';
const PATIENT = 'unit-p0-summoner-60228';
const CASTER = 'unit-p0-summoner-15312';
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

afterEach(() => vi.restoreAllMocks());

function context(tick: 154485 | 154575) {
  const bytes = readFileSync(new URL('./fixtures/ground-hull-detour-8181-154485-154575.json.gz', import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('4b57129a225345bd70d98e24bdc4a223db9eec1d67bda7a772defe9b5e630aaf');
  const fixture = JSON.parse(gunzipSync(bytes).toString()) as Fixture;
  expect(fixture.sourceHead).toBe('8181b23bd21c1c93a69bdcc7908e87cc291deb9f');
  const pair = fixture.contexts[String(tick)]!;
  expect(pair.before.phase).toBe('before-p0-planner');
  expect(pair.after.phase).toBe('after-p0-plan-before-other-owners-or-public-issue');
  expect(pair.before.snapshot).toEqual(pair.before.plannerSnapshot);
  expect(pair.before.snapshot).toEqual(pair.after.plannerSnapshot);
  expect(pair.before.snapshot.tick).toBe(tick);
  expect(pair.before.setup.rulesVersion).toBe(2);
  expect(pair.before.setup.agents.p0.version).toBe('v9_summoner');
  expect(Object.keys(pair.before.memories).sort()).toEqual(['p0', 'p1', 'p2']);
  const snapshot = pair.before.plannerSnapshot;
  terrain.setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  return { pair, snapshot };
}
function actor(snapshot: GameSnapshot, id: string): Unit {
  const unit = snapshot.units.find(unit => unit.id === id);
  if (!unit) throw Error('Missing actual closed-context actor ' + id);
  return unit;
}
function options(saved: SavedContext): AiPolicyContext {
  return bootstrapPolicyContext(saved.plannerSnapshot, 'p0', 'v9_summoner', {
    ...(saved.plannerSnapshot.teams ? { teams: saved.plannerSnapshot.teams } : {}),
    memory: structuredClone(saved.memories.p0!),
  });
}
function actualMove(saved: SavedContext, id: string, scriptId: string): Move {
  const rows = saved.entries?.filter(entry => entry.playerId === 'p0' && entry.scriptId === scriptId
    && entry.command.type === 'move' && entry.command.unitIds.includes(id));
  expect(rows).toHaveLength(1);
  const command = rows![0]!.command;
  if (command.type !== 'move') throw Error('Actual publication must be a move');
  return command;
}
function hullAt(snapshot: GameSnapshot, point: Point) {
  return snapshot.units.find(ship => {
    const profile = shipProfile(ship);
    return profile && circleInPolygon(worldToLocal(ship, point), 0, profile.hull);
  });
}
function expectExecutableWaypoint(snapshot: GameSnapshot, unit: Unit, point: Point, desired: Point) {
  expect(distance(unit, point)).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);
  expect(terrain.isOpenGround(snapshot.map, point.x, point.y)).toBe(true);
  expect(terrain.sameGround(snapshot.map, unit, point)).toBe(true);
  expect(hullAt(snapshot, point)).toBeUndefined();
  const approach = routes.groundSteeringRoute(snapshot.map, unit, point);
  const onward = routes.groundSteeringRoute(snapshot.map, point, desired);
  expect(approach.length).toBeGreaterThan(1);
  expect(distance(approach.at(-1)!, point)).toBeLessThanOrEqual(MOVE_ORDER_ARRIVAL_RANGE);
  expect(distance(onward.at(-1)!, desired)).toBeLessThanOrEqual(MOVE_ORDER_ARRIVAL_RANGE);
  for (const road of [approach, onward]) {
    for (let index = 1; index < road.length; index++) {
      const end = road[index]!;
      expect(constrainGroundShipStep(snapshot.map, unit, road[index - 1]!, end, snapshot.units)).toEqual(end);
    }
  }
  // Off-deck bodies remain physical even if a stale cabin field is present.
  const bodies = snapshot.units.filter(other => other.id !== unit.id && other.hp > 0 && !other.deck
    && !shipProfile(other) && unitMover(other.kind) === 'land'
    && terrain.isWalkable(snapshot.map, other.x, other.y));
  for (let index = 1; index < approach.length; index++) {
    expect(capsuleClearsBodies(approach[index - 1]!, approach[index]!, unit.radius, bodies)).toBe(true);
  }
}

describe('bootstrap local ground-hull detour', () => {
  it('admits a real15312 waypoint around a hull clipping an external ground goal', () => {
    const { pair, snapshot } = context(154575), unit = actor(snapshot, CASTER);
    const command = actualMove(pair.after, unit.id, 'v6Backline'), opts = options(pair.before);
    expect(unit.deck).toBeUndefined();
    expect(unit.order.type).toBe('move');
    expect(hullAt(snapshot, command)).toBeUndefined();
    expect(terrain.isOpenGround(snapshot.map, command.x, command.y)).toBe(true);
    expect(distanceToHull(actor(snapshot, SHIP), unit)).toBeLessThanOrEqual(unit.radius + MOVE_ORDER_ARRIVAL_RANGE);
    const aim = terrain.steerPoint(snapshot.map, unit, command);
    expect(constrainGroundShipStep(snapshot.map, unit, unit, aim, snapshot.units)).not.toEqual(aim);
    const before = structuredClone({ pair, opts });
    const point = groundScreenGoal(snapshot, unit, command);
    expect(point).toBeDefined();
    if (!point) throw Error('Actual15312 must have an executable waypoint');
    expect(point).not.toEqual({ x: command.x, y: command.y });
    expectExecutableWaypoint(snapshot, unit, point, command);
    expect(groundScreenMoves(snapshot, 'p0', opts, [command])).toEqual([{ ...command, x: point.x, y: point.y }]);
    expect({ pair, opts }).toEqual(before);
    // Static first-waypoint admission is not a native arrival, healing or match-win claim.
  });

  it('keeps actual crowded60228 care ownership and publishes an honest hold without a waypoint', () => {
    const { pair, snapshot } = context(154485), patient = actor(snapshot, PATIENT), opts = options(pair.before);
    const actual = actualMove(pair.after, patient.id, 'frontRecovery');
    expect(actual).toEqual({ type: 'move', unitIds: [PATIENT], x: 2224, y: 976, avoidCombat: true });
    const assignmentsBefore = postRecoveryAssignments(snapshot, 'p0', opts);
    const shape = (assignments: typeof assignmentsBefore) => assignments.map(({ patient, post, point, walk }) => ({
      patientId: patient.id, postId: post.id, point: { x: point.x, y: point.y }, walk,
    }));
    const assignmentShape = structuredClone(shape(assignmentsBefore));
    const claimsBefore = [...frontRecovery.claimsUnits!(snapshot, 'p0', opts)].sort();
    const raw = postRecoveryCommands(assignmentsBefore);
    expect(raw).toEqual(pair.after.entries!.filter(entry => entry.playerId === 'p0' && entry.scriptId === 'frontRecovery').map(entry => entry.command));
    expect(raw).toEqual([actual]);
    expect(claimsBefore).toEqual([PATIENT]);
    const before = structuredClone({ pair, opts });
    expect(groundScreenGoal(snapshot, patient, actual)).toBeUndefined();
    expect(frontRecovery.run(snapshot, 'p0', opts)).toEqual([{ type: 'holdPosition', unitIds: [PATIENT] }]);
    expect([...frontRecovery.claimsUnits!(snapshot, 'p0', opts)].sort()).toEqual(claimsBefore);
    expect(shape(postRecoveryAssignments(snapshot, 'p0', opts))).toEqual(assignmentShape);
    expect({ pair, opts }).toEqual(before); // complete world and all three saved memories

    // Explicit earlier-owner counterfactual on a fresh actual input; original memory is never tuned.
    const owned = context(154485), ownedOptions = options(owned.pair.before);
    const originalWorldAndMemories = structuredClone(owned.pair);
    const earlier: AiScript = {
      id: 'earlierAssignment', phase: 'tactics', claimsUnits: () => new Set([PATIENT]),
      run: () => ({ type: 'holdPosition', unitIds: [PATIENT] }),
    };
    const entries = runAiCommandEntriesFromScripts(owned.snapshot, 'p0', [earlier, frontRecovery], ownedOptions);
    expect(entries).toEqual([{ scriptId: earlier.id, command: { type: 'holdPosition', unitIds: [PATIENT] } }]);
    expect(owned.pair).toEqual(originalWorldAndMemories);
    // Runner bookkeeping may prune/update its separate cloned policy memory normally.
  });

  it('preserves a move when a nearby nonblocking hull accompanies a distant segment blocker', () => {
    const { snapshot } = context(154575), unit = structuredClone(actor(snapshot, CASTER));
    const sourceShip = actor(snapshot, SHIP);
    const near = structuredClone(sourceShip), far = structuredClone(sourceShip);
    if (!near.sailing || !far.sailing) throw Error('Actual ship must retain its native sailing pose');
    near.sailing.heading = 0; far.sailing.heading = 0;
    near.id = 'contract-near-hull'; far.id = 'contract-distant-hull';
    unit.x = 600; unit.y = 800;
    const desired = { x: 1600, y: 800 };
    unit.order = { type: 'move', ...desired };
    const tip = shipProfile(near)!.hull.reduce((best, point) => point.x > best.x ? point : best);
    near.x = unit.x - unit.radius - MOVE_ORDER_ARRIVAL_RANGE / 2 - tip.x;
    near.y = unit.y - tip.y;
    far.x = 1100; far.y = 800;
    // Explicit geometry counterfactual only: a bare map and fresh bodies/cache identity.
    const { terrain: _terrain, ...bareMap } = snapshot.map;
    snapshot.map = bareMap;
    snapshot.buildings = []; snapshot.obstacles = [];
    snapshot.units = [unit, near, far];
    expect(hullAt(snapshot, desired)).toBeUndefined();
    expect(distanceToHull(near, unit)).toBeLessThanOrEqual(unit.radius + MOVE_ORDER_ARRIVAL_RANGE);
    expect(distanceToHull(far, unit)).toBeGreaterThan(unit.radius + MOVE_ORDER_ARRIVAL_RANGE);
    expect(constrainGroundShipStep(snapshot.map, unit, unit, desired, [near])).toEqual(desired);
    expect(constrainGroundShipStep(snapshot.map, unit, unit, desired, snapshot.units)).not.toEqual(desired);
    const fullRoad = vi.spyOn(routes, 'groundSteeringRoute'), projection = vi.spyOn(terrain, 'walkDestination');
    const before = structuredClone(snapshot);
    expect(groundScreenGoal(snapshot, unit, desired)).toBe(desired);
    expect(fullRoad).not.toHaveBeenCalled();
    expect(projection).not.toHaveBeenCalled();
    expect(snapshot).toEqual(before);
  });
});
