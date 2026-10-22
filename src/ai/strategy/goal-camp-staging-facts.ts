import { unitMover } from '../../shared/catalog';
import { isOpenGround } from '../../shared/terrain';
import type { Unit } from '../../shared/types';
import { bootstrapCampStaging, type CampApproachPointReader } from '../bootstrap_1/camp-geometry';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import type { AllocationLandRouteReader } from './allocation-arrival-query';
import type { GoalNativeGroundReader } from './goal-boarding-geometry';
import { goalFact, goalValueKey, resolveGoalCamp } from './goal-facts';
import type { GoalFact, GoalFactObservation, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import { landIdAt } from './regions';
import { goalCampStagingOutsideAlert } from './goal-camp-staging-geometry';
export type GoalCampStagingPorts = Readonly<{
  landRoute: AllocationLandRouteReader; readGroundPoint?: GoalNativeGroundReader;
  resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']>;
}>;
const sorted = (ids: readonly string[]) => [...new Set(ids)].sort();
/** Geometry and actual binding only. There is no proof of future target-camp
 * non-exposure, transport success, or victory hidden in this observation. */
export function readGoalCampStagingFact(fact: GoalFact, context: GoalPlanningContext, ports: GoalCampStagingPorts): GoalFactObservation | null {
  const p = fact.predicate; if (p.kind !== 'camp-staging') return null;
  const ids = [fact.id, p.campId], dependencies: unknown[] = [p], pendingIds: string[] = [];
  const answer = (met: boolean, code: string, entityIds: readonly string[] = []): GoalFactObservation => ({
    fact, state: met ? 'met' : 'unmet', observedTick: context.tick,
    revision: goalValueKey([code, dependencies]), evidence: [], entityIds, reason: { code, factIds: sorted(ids), values: {} },
    ...(met ? { availableTick: context.tick } : {}),
  });
  const pending = (code: string): GoalFactObservation => ({ fact, state: 'pending', observedTick: context.tick,
    revision: goalValueKey([code, dependencies]), evidence: [], reason: { code, factIds: sorted(ids), values: {} },
    requestId: sorted(pendingIds)[0] ?? `world:${fact.id}`, requestedTick: context.tick });
  if (context.snapshot.tick !== context.tick || context.situation.tick !== context.tick) return pending('staging-world-epoch-pending');
  const camp = resolveGoalCamp(context.snapshot, p.campId);
  if (camp.status !== 'present') return answer(false, camp.status === 'cleared' ? 'staging-camp-already-cleared' : 'staging-camp-binding-invalid');
  const landId = landIdAt(context.snapshot.map, camp.exposure.camp.center);
  if (!landId || !p.at.landId) return pending('staging-land-pending');
  if (landId !== p.at.landId || landIdAt(context.snapshot.map, p.at.point) !== landId
    || !isOpenGround(context.snapshot.map, p.at.point.x, p.at.point.y)) return answer(false, 'staging-ground-region-invalid');
  const refs = p.cohort;
  if (!refs) return pending('staging-exact-cohort-required');
  if (!refs.length) return answer(false, 'staging-cohort-empty');
  const members = ports.resolveCohort(refs);
  if (members.state === 'pending') { pendingIds.push(...members.requestIds); ids.push(...members.reason.factIds); return pending(members.reason.code); }
  if (members.state !== 'met') return answer(false, members.reason.code);
  if (goalValueKey(sorted(members.candidates.map(member => goalValueKey(member.reference)))) !== goalValueKey(sorted(refs.map(goalValueKey))))
    return pending('staging-cohort-binding-pending');
  const group: Unit[] = [];
  for (const member of members.candidates) {
    const actual = member.reference.kind === 'existing' ? context.snapshot.units.find(unit => member.reference.kind === 'existing' && unit.id === member.reference.entityId) : undefined;
    if (!actual) return pending('staging-current-cohort-pending');
    if (actual.owner !== context.owner || actual.hp <= 0 || unitMover(actual.kind) !== 'land' || actual.deck || actual.cabin)
      return answer(false, 'staging-cohort-not-on-land');
    if (landIdAt(context.snapshot.map, actual) !== landId) return answer(false, 'staging-cohort-on-another-land');
    group.push(actual);
  }
  if (!goalCampStagingOutsideAlert(camp.exposure, p.at.point, group)) return answer(false, 'staging-inside-target-alert');
  // Route/point geometry changes matter here; attack clocks, cosmetics and
  // other unit state do not repeatedly invalidate a geometric world fact.
  dependencies.push(group.map(unit => [unit.id, unit.kind, unit.owner, unit.x, unit.y, unit.radius, unit.deck, unit.cabin]),
    [camp.exposure.camp.center, camp.exposure.camp.reach, camp.exposure.members.map(member => [member.id, member.point])]);
  const center = { x: group.reduce((sum, unit) => sum + unit.x, 0) / group.length, y: group.reduce((sum, unit) => sum + unit.y, 0) / group.length };
  const hall = context.snapshot.buildings.filter(building => building.owner === context.owner && building.hp > 0 && building.complete
    && building.kind === 'townHall' && landIdAt(context.snapshot.map, building) === landId)
    .sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y) || (a.id < b.id ? -1 : 1))[0];
  const home = hall ? { x: hall.x, y: hall.y } : center;
  dependencies.push(home);
  const project: CampApproachPointReader = point => {
    const observed = ports.readGroundPoint?.({ kind: 'project-goal', point, mover: 'land' });
    if (observed) dependencies.push(observed);
    if (observed?.state === 'met') { ids.push(...observed.factIds); return { status: 'known', point: observed.value }; }
    if (observed?.state === 'unmet') return { status: 'unreachable', reasonCode: observed.reason.code };
    pendingIds.push(...(observed?.state === 'pending' ? observed.requestIds : [`ground:${fact.id}`]));
    return { status: 'unknown', reasonCode: 'staging-ground-projection-pending' };
  };
  const met = bootstrapCampStaging(context.snapshot, home, group, camp.exposure.camp, p.at.point,
    neutralCampExposure(context.snapshot).camps.map(row => row.camp), (from, to) => {
      const routeFact = goalFact({ kind: 'route', mover: 'land', from: { landId, point: { x: from.x, y: from.y } }, to: { landId, point: { x: to.x, y: to.y } } });
      const observed = context.readFact(routeFact), road = ports.landRoute(from, to);
      ids.push(routeFact.id); dependencies.push([observed.revision, observed.state, road]);
      if (observed.fact.id !== routeFact.id || observed.observedTick !== context.tick || (observed.availableTick ?? context.tick) > context.tick) {
        pendingIds.push(routeFact.id); return { status: 'unknown', reasonCode: 'staging-route-binding-pending' };
      }
      if (observed.state === 'pending') pendingIds.push(observed.requestId);
      if (road.status === 'unknown' && observed.state !== 'pending') pendingIds.push(routeFact.id);
      // Every route is a world dependency. An unannounced geometric callback
      // cannot independently turn a pending route into a met fact.
      return observed.state === 'met' ? road : { status: observed.state === 'pending' ? 'unknown' : 'unreachable', reasonCode: observed.reason.code };
    }, project);
  return met ? answer(true, 'native-camp-staging-published', group.map(unit => unit.id))
    : pendingIds.length ? pending('native-camp-staging-pending') : answer(false, 'native-camp-staging-invalid');
}
