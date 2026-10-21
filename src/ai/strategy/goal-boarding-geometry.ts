import { BOARDING_GAP, boardingBerthCandidateAt } from '../../shared/naval';
import { distanceToHull, shareShipProfile, shipProfile } from '../../shared/ship-geometry';
import { advanceNearestShipPose, beginNearestShipPose, type NearestShipPoseCursor } from '../../shared/ship-navigation';
import { isWalkable } from '../../shared/terrain';
import type { GameSnapshot, Unit } from '../../shared/types';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalBerth, GoalGeometryReader, GoalHullCandidate, GoalPublishedValue } from './goal-grounding-ports';
import type { GoalFactReader } from './goal-planner-types';
import { advanceGoalBoardingCandidate, beginGoalBoardingCandidate, type GoalBoardingCandidateCursor } from './goal-boarding-candidates';
import { landIdAt, seaIdAt, type RegionIndex, type Shore } from './regions';
import type { Point } from './types';

/** Native ground projection and partial walking destinations are distinct
 * from an exact route proof. Implementations must use the injected owner-think
 * fields/geometry queue. There is no synchronous native fallback. */
export type GoalNativeGroundRequest = Readonly<{ kind: 'project-goal'; point: Point; mover: 'land' | 'sea' }>
  | Readonly<{ kind: 'walk-destination'; from: Point; goal: Point }>;
export type GoalNativeGroundReader = (request: GoalNativeGroundRequest) => GoalPublishedValue<Point>;
type Candidate = { x: number; y: number; score: number; index: number };
type Cursor = {
  attempt: number; ground: Point; water: Point; heading: number;
  phase: 'project' | 'scan' | 'walk' | 'pose' | 'fallback-land' | 'fallback-sea' | 'finish';
  scan: number; after: Candidate | null; best: Candidate | null; land: Point | null;
  candidates: GoalBoardingCandidateCursor | null;
  pose: NearestShipPoseCursor; fallback: boolean; proofIds: string[];
};
export function createGoalBoardingGeometry(input: Readonly<{
  snapshot: GameSnapshot; geometry: GoalGeometryReader; geometryRevision: string; readFact: GoalFactReader;
  regions?: RegionIndex;
  readGroundPoint?: GoalNativeGroundReader;
}>): (passenger: Unit, hull: GoalHullCandidate, shore: Shore) => GoalPublishedValue<GoalBerth> {
  return (passenger, hull, shore) => {
    const preparedCells = input.regions?.scannedRows === input.regions?.totalRows
      ? input.regions?.boardingCellsByLand?.get(shore.landId)?.get(shore.seaId) ?? (input.regions?.boardingCellsByLand ? [] : undefined)
      : undefined;
    const profile = shipProfile(hull.assessment);
    if (!profile) return { state: 'unmet', reason: { code: 'native-hull-profile-unavailable', factIds: hull.factIds, values: {} } };
    const hullVersion = input.geometry.reference?.(`hull:${hull.assessment.kind}`, {
      hull: profile.hull, heading: hull.assessment.sailing?.heading ?? 0,
    });
    const shoreVersion = input.geometry.reference?.('shore', shore);
    const references = hullVersion && shoreVersion ? [hullVersion, shoreVersion] : undefined;
    const key = `${preparedCells ? 'boarding-near' : 'boarding'}:${goalValueKey(references
      ? [hull.reference, hullVersion, passenger.radius, shoreVersion]
      : [hull.reference, profile.hull, hull.assessment.sailing?.heading ?? 0, passenger.radius, shore])}`;
    const pending = (code: string): GoalPublishedValue<Point> => ({ state: 'pending', requestIds: [key],
      reason: { code, factIds: [key], values: {} } });
    const nativePoint: GoalNativeGroundReader = request => {
      if (input.readGroundPoint) return input.readGroundPoint(request);
      if (request.kind === 'project-goal') {
        const { point, mover } = request;
        return point.x >= 0 && point.y >= 0 && point.x <= input.snapshot.map.width && point.y <= input.snapshot.map.height
          && isWalkable(input.snapshot.map, point.x, point.y, mover)
          ? { state: 'met', value: point, factIds: [] } : pending('native-goal-projection-pending');
      }
      const fact = goalFact({ kind: 'route', mover: 'land', from: { landId: shore.landId, point: request.from },
        to: { landId: shore.landId, point: request.goal } });
      const observed = input.readFact(fact);
      // An exact published road proves walkDestination reaches its goal. A
      // missing exact road does not prove its partial native endpoint.
      return observed.state === 'met' && observed.route ? { state: 'met', value: request.goal, factIds: [fact.id] }
        : observed.state === 'pending' ? { state: 'pending', requestIds: [observed.requestId], reason: observed.reason }
        : pending('native-partial-walk-destination-pending');
    };
    const read = input.geometry<Cursor, { berth: GoalBerth | null; factIds: readonly string[] }>({ key, revision: input.geometryRevision,
      ...(references ? { references } : {}),
      initialState: { attempt: 0, ground: shore.ground, water: shore.water, heading: hull.assessment.sailing?.heading ?? 0,
        phase: 'project', scan: 0, after: null, best: null, land: null, candidates: null, pose: beginNearestShipPose(), fallback: false, proofIds: [] },
      advance(state, allowance) {
        let work = 0;
        const done = (berth: GoalBerth | null) => ({ state, work, done: true,
          value: { berth, factIds: state.proofIds } });
        const person = { ...passenger }, ship = { ...hull.assessment, sailing: { ...hull.assessment.sailing! } };
        delete person.deck; delete person.cabin; shareShipProfile(hull.assessment, ship);
        const acceptPoint = (value: GoalPublishedValue<Point>): Point | undefined => {
          if (value.state !== 'met') return;
          state.proofIds = [...new Set([...state.proofIds, ...value.factIds])].sort();
          return Number.isFinite(value.value.x) && Number.isFinite(value.value.y)
            ? { x: value.value.x, y: value.value.y } : undefined;
        };
        while (work < allowance) {
          ship.x = state.water.x; ship.y = state.water.y; ship.sailing.heading = state.heading;
          person.x = state.ground.x; person.y = state.ground.y;
          if (state.phase === 'project') {
            const projected = acceptPoint(nativePoint({ kind: 'project-goal', point: state.ground, mover: 'land' }));
            if (!projected) return { state, work, done: false };
            work++; state.ground = projected; state.phase = 'scan'; continue;
          }
          if (state.phase === 'scan') {
            if (preparedCells) {
              const next = preparedCells.length ? advanceGoalBoardingCandidate(input.snapshot.map, person, ship,
                state.candidates ??= beginGoalBoardingCandidate(), allowance - work, state.after) : { work: 0, done: true, value: null };
              work += next.work;
              if (!next.done) return { state, work, done: false };
              state.best = next.value; state.candidates = null;
              state.phase = state.best ? 'walk' : 'fallback-land'; state.pose = beginNearestShipPose(); state.fallback = !state.best; continue;
            }
            const count = input.snapshot.map.terrain?.cells.length ?? 0;
            if (!count) return done(null);
            if (state.scan < count) {
              const index = state.scan++;
              const candidate = boardingBerthCandidateAt(input.snapshot.map, person, ship, index); work++;
              if (candidate && (!state.after || candidate.score > state.after.score || candidate.score === state.after.score && index > state.after.index)
                && (!state.best || candidate.score < state.best.score || candidate.score === state.best.score && index < state.best.index))
                state.best = { ...candidate, index };
              continue;
            }
            state.phase = state.best ? 'walk' : 'fallback-land'; state.pose = beginNearestShipPose(); state.fallback = !state.best; continue;
          }
          if (state.phase === 'walk' || state.phase === 'fallback-land') {
            let goal: Point = state.best ? { x: state.best.x, y: state.best.y } : state.water;
            if (state.fallback) {
              const projected = acceptPoint(nativePoint({ kind: 'project-goal', point: state.water, mover: 'land' }));
              if (!projected) return { state, work, done: false };
              goal = projected;
            }
            const land = acceptPoint(nativePoint({ kind: 'walk-destination', from: state.ground, goal }));
            if (!land) return { state, work, done: false };
            work++; state.land = land;
            state.phase = state.fallback ? 'fallback-sea' : 'pose'; continue;
          }
          if (state.phase === 'fallback-sea') {
            const projected = acceptPoint(nativePoint({ kind: 'project-goal', point: state.land!, mover: 'sea' }));
            if (!projected) return { state, work, done: false };
            work++; state.best = { ...projected, score: 0, index: -1 }; state.phase = 'pose'; continue;
          }
          const next = advanceNearestShipPose(input.snapshot.map, ship, { x: state.best!.x, y: state.best!.y }, state.pose, allowance - work);
          work += next.work; state.pose = next.cursor;
          if (!next.done) return { state, work, done: false };
          const pose = next.value;
          if (pose && state.land && (state.fallback || Math.hypot(state.land.x - state.best!.x, state.land.y - state.best!.y) < 1)) {
            const dock = { ...ship, x: pose.x, y: pose.y, sailing: { heading: pose.heading, speed: 0, load: 0, balance: 0 } };
            shareShipProfile(ship, dock);
            if (distanceToHull(dock, state.land) <= passenger.radius + BOARDING_GAP
              && landIdAt(input.snapshot.map, state.land) === shore.landId && seaIdAt(input.snapshot.map, pose) === shore.seaId) {
              if (state.land.x === state.ground.x && state.land.y === state.ground.y && pose.x === state.water.x && pose.y === state.water.y)
                return done({ ground: state.land, water: { x: pose.x, y: pose.y }, heading: pose.heading });
              state.attempt++;
              if (state.attempt >= 4) return done(null);
              state.ground = state.land; state.water = { x: pose.x, y: pose.y }; state.heading = pose.heading;
              state.phase = 'project'; state.after = null; state.best = null; state.scan = 0; state.candidates = null; state.land = null; state.pose = beginNearestShipPose(); continue;
            }
          }
          if (state.fallback) return done(null);
          state.after = state.best; state.best = null; state.scan = 0; state.candidates = null; state.phase = 'scan'; state.land = null; state.pose = beginNearestShipPose();
        }
        return { state, work, done: false };
      } });
    if (read.state !== 'met') return read;
    const factIds = [...new Set([...read.factIds, ...read.value.factIds])].sort();
    return read.value.berth ? { ...read, value: read.value.berth, factIds } : { state: 'unmet', reason: {
      code: 'no-stable-native-boarding-berth', factIds, values: {} } };
  };
}
