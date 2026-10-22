import { shipProfile } from '../../shared/ship-geometry';
import type { ShipPose } from '../../shared/ship-navigation';
import { isOpenGround, isWalkable } from '../../shared/terrain';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import type { AllocationLandRouteReader } from './allocation-arrival-query';
import type { ArrivalPlanningPhysics } from './arrivals';
import { createGoalBoardingGeometry, type GoalNativeGroundReader } from './goal-boarding-geometry';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalGeometryReader, GoalHullCandidate, GoalPublishedValue } from './goal-grounding-ports';
import type { GoalFactReader } from './goal-planner-types';
import { landIdAt, type RegionIndex } from './regions';
import type { Point } from './types';

// A separate decision port. Exact launch ranking/steering stays optional and
// is not used as a training prerequisite or as a substitute for a born ship.
export { createGoalSeaSpawnReader, type GoalSeaSpawnReader, type GoalSeaSpawn } from './goal-sea-spawn';

export type ArrivalPlanningPhysicsInput = Readonly<{
  snapshot: GameSnapshot; geometry: GoalGeometryReader; geometryRevision: string;
  regions?: RegionIndex;
  landRoute: AllocationLandRouteReader;
  /** Native partial endpoints/projection and harbor launch ranking can only
   * come from a published, budgeted service. Absent capabilities stay pending. */
  readGroundPoint?: GoalNativeGroundReader;
  readLaunchPose?: (yard: Building, prototype: Unit) => GoalPublishedValue<ShipPose>;
}>;

/** This factory is usable before Situation construction: it consumes only the
 * same owner-think geometry/land fields, and never creates a route query, a
 * Situation or a second allowance. Existing naval boarding cursors perform
 * their finite native checks on the injected geometry queue. */
export function createArrivalPlanningPhysics(input: ArrivalPlanningPhysicsInput): ArrivalPlanningPhysics {
  const pending = (id: string, code: string): GoalPublishedValue<never> => ({ state: 'pending', requestIds: [id],
    reason: { code, factIds: [id], values: {} } });
  const readRoute: GoalFactReader = fact => {
    const p = fact.predicate;
    if (p.kind !== 'route' || p.mover !== 'land') throw Error('Arrival boarding requested a non-land fact');
    const route = input.landRoute(p.from.point, p.to.point);
    const base = { fact, observedTick: input.snapshot.tick, revision: input.geometryRevision, evidence: [],
      reason: { code: route.status === 'known' ? 'shared-arrival-land-route' : route.reasonCode,
        factIds: [fact.id], values: {} } };
    return route.status === 'known' ? { ...base, state: 'met', route: { distance: route.distance, ticks: null, points: route.points } }
      : route.status === 'unreachable' ? { ...base, state: 'unmet' }
      : { ...base, state: 'pending', requestId: fact.id, requestedTick: input.snapshot.tick };
  };
  const projection = (request: Extract<Parameters<GoalNativeGroundReader>[0], { kind: 'project-goal' }>) =>
    input.geometry<null, { point: Point | null; open: boolean }>({ key: `arrival-ground-v2:${goalValueKey(request)}`,
      revision: input.geometryRevision, initialState: null, advance: (state, allowance) => {
        if (allowance < 2) return { state, work: 0, done: false };
        const terrain = input.snapshot.map.terrain;
        const point = terrain ? { x: Math.max(0, Math.min(input.snapshot.map.width, request.point.x)),
          y: Math.max(0, Math.min(input.snapshot.map.height, request.point.y)) } : request.point;
        const check = terrain ? { x: Math.min(point.x, terrain.cols * terrain.cell - .001),
          y: Math.min(point.y, terrain.rows * terrain.cell - .001) } : point;
        return { state, work: 2, done: true, value: {
          point: isWalkable(input.snapshot.map, check.x, check.y, request.mover) ? { ...point } : null,
          open: isOpenGround(input.snapshot.map, check.x, check.y, request.mover),
        } };
      } });
  const ground: GoalNativeGroundReader = request => {
    if (input.readGroundPoint) return input.readGroundPoint(request);
    const key = `arrival-ground:${goalValueKey(request)}`;
    if (request.kind === 'walk-destination') {
      // A walker already on its open goal has no journey or partial endpoint
      // to solve. Reuse the published finite placement check instead of asking
      // for an entire goal field merely to prove this native zero-length case.
      if (request.from.x === request.goal.x && request.from.y === request.goal.y) {
        const checked = projection({ kind: 'project-goal', point: request.goal, mover: 'land' });
        if (checked.state !== 'met') return checked;
        return checked.value.open && checked.value.point?.x === request.goal.x && checked.value.point.y === request.goal.y
          ? { ...checked, value: { ...request.goal } } : pending(key, 'arrival-native-partial-ground-pending');
      }
      const fromLand = landIdAt(input.snapshot.map, request.from), toLand = landIdAt(input.snapshot.map, request.goal);
      const fact = goalFact({ kind: 'route', mover: 'land', from: { point: request.from, ...(fromLand ? { landId: fromLand } : {}) },
        to: { point: request.goal, ...(toLand ? { landId: toLand } : {}) } });
      const route = readRoute(fact);
      // A reachable open exact endpoint agrees with native walkDestination.
      // A road to a building's goal seeds or an unreachable exact goal does
      // not establish its native partial endpoint.
      return route.state === 'met' && isOpenGround(input.snapshot.map, request.goal.x, request.goal.y)
        ? { state: 'met', value: { ...request.goal }, factIds: [fact.id] }
        : route.state === 'pending' ? { state: 'pending', requestIds: [route.requestId], reason: route.reason }
        : pending(key, 'arrival-native-partial-ground-pending');
    }
    const result = projection(request);
    if (result.state !== 'met') return result;
    return result.value.point ? { ...result, value: result.value.point } : pending(key, 'arrival-native-goal-projection-pending');
  };
  const boarding = createGoalBoardingGeometry({ ...input, readFact: readRoute, readGroundPoint: ground });
  return {
    ground,
    berth(passenger, ship, shore) {
      const hull: GoalHullCandidate = { id: ship.id, reference: input.snapshot.units.some(unit => unit.id === ship.id)
        ? { kind: 'existing', entityId: ship.id } : { kind: 'binding', name: `arrival-assessment:${ship.id}` },
      assessment: ship, seaId: shore.seaId, availableTick: input.snapshot.tick,
      capacity: shipProfile(ship)?.loadCapacity ?? 0, cargoUnitIds: [], preconditions: [], factIds: [] };
      return boarding(passenger, hull, shore);
    },
    launch: (yard, prototype) => input.readLaunchPose?.(yard, prototype)
      ?? pending(`arrival-launch:${goalValueKey([yard.id, prototype.kind, input.geometryRevision])}`, 'arrival-native-launch-pending'),
  };
}
