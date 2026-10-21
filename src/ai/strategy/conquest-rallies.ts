import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { distanceToHull, isShipKind } from '../../shared/ship-geometry';
import { canReach } from '../../shared/naval';
import { sameGround, walkableGoal } from '../../shared/terrain';
import type { Unit } from '../../shared/types';
import { bootstrapCampApproach } from '../bootstrap_1/camp-geometry';
import { THINK_TICKS } from '../bootstrap_1/mounted-micro';
import { armedFoes, retreatThreatReach } from '../bootstrap_1/safe-land-route';
import { averagePoint, distance } from '../policy/spatial';
import { neutralCampPointContacts } from '../situation/neutral-camp-contact';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import type { AllocationMethodQuoteInput, AllocationPrecondition, AllocationReason } from './allocation-types';
import type { AllocationLandRouteReader } from './allocation-arrival-query';
import type { AssemblyPost } from './assembly-facts';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { landIdAt } from './regions';
import { strategyTeamOptions } from './ownership';
import { strategicTargetCamp } from './target-camp';
import type { LandId, Target } from './types';
import { unitArrival } from './unit-arrivals';

type RallyInput = Pick<AllocationMethodQuoteInput, 'snapshot' | 'situation' | 'objective' | 'executions'> & Readonly<{ methodId: string }>;
let planningRoute: AllocationLandRouteReader | undefined;
/** One synchronous planning scope. Nested calls and exceptions restore the
 * previous reader; execution outside this scope retains native behavior. */
export function withConquestAssemblyPlanning<T>(reader: AllocationLandRouteReader, run: () => T): T {
  const previous = planningRoute; planningRoute = reader;
  try { return run(); } finally { planningRoute = previous; }
}
const combatant = (unit: Unit) => unit.hp > 0 && unit.kind !== 'worker' && unitMover(unit.kind) === 'land'
  && unit.attackDamage > 0 && unit.expiresTick === undefined;

/** Stable, land-local posts. Existing native camp staging and published
 * departure ground facts supply the points; no new navigation is introduced. */
export function conquestAssemblyPosts(input: RallyInput): readonly AssemblyPost[] {
  return assemblyPosts(input).posts;
}
function assemblyPosts(input: RallyInput) {
  const { snapshot, situation, objective, methodId } = input, owner = situation.owner;
  const facts = neutralCampExposure(snapshot), camp = strategicTargetCamp(snapshot, objective.target, facts);
  const fighters = snapshot.units.filter(unit => unit.owner === owner && combatant(unit) && !unit.deck && !unit.cabin)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const bases = snapshot.buildings.filter(building => building.owner === owner && building.hp > 0 && building.complete
    && (building.kind === 'townHall' || BUILDING_DEFS[building.kind].trains.some(kind => kind !== 'worker'
      && unitMover(kind) === 'land' && UNIT_DEFS[kind].attackDamage > 0)))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const lands = new Set([...fighters, ...bases].flatMap(entity => landIdAt(snapshot.map, entity) ?? []));
  const prior = input.executions.find(action => action.token.actionId === `${methodId}/assemble-force`);
  const retained = prior?.intent.kind === 'assemble-force' ? prior.intent.posts : [];
  const foes = armedFoes(snapshot, owner, strategyTeamOptions(snapshot));
  const hulls = snapshot.units.filter(unit => unit.hp > 0 && isShipKind(unit.kind));
  const result: AssemblyPost[] = [];
  const pending = new Map<LandId, AllocationReason[]>();
  for (const landId of [...lands].sort()) {
    const group = fighters.filter(unit => landIdAt(snapshot.map, unit) === landId);
    const localBases = bases.filter(building => landIdAt(snapshot.map, building) === landId);
    const actor = group[0] ?? snapshot.units.find(unit => unit.owner === owner && unit.hp > 0 && unitMover(unit.kind) === 'land'
      && !unit.deck && !unit.cabin && landIdAt(snapshot.map, unit) === landId);
    if (!actor) continue;
    const home = localBases.find(building => building.kind === 'townHall') ?? localBases[0] ?? actor;
    const candidates: Target[] = retained.filter(post => post.target.landId === landId).map(post => post.target);
    if (camp && objective.target.landId === landId && group.length) {
      const read = planningRoute;
      const route: AllocationLandRouteReader | undefined = read && ((from, goal) => {
        const answer = read(from, goal);
        if (answer.status === 'unknown') {
          const reasons = pending.get(landId) ?? [];
          reasons.push({ code: answer.reasonCode, factIds: [actor.id], values: {
            fromX: from.x, fromY: from.y, goalX: goal.x, goalY: goal.y } });
          pending.set(landId, reasons);
        }
        return answer;
      });
      const approach = bootstrapCampApproach(snapshot, home, [actor], camp, averagePoint(group), facts.camps.map(value => value.camp), route);
      if (approach) candidates.push({ point: approach.staging, landId });
    }
    for (const unit of group) {
      const fact = situation.units.find(fact => fact.id === unit.id), arrival = fact && unitArrival(fact, objective.target.entityId ?? '');
      if (!arrival || !('crossings' in arrival)) continue;
      for (const crossing of arrival.crossings) if (crossing.departureGround && landIdAt(snapshot.map, crossing.departureGround) === landId) {
        // Keep a landward assembly post outside the live hull footprint. The
        // later transport action retains the exact native boarding pair.
        const dx = home.x - crossing.departureGround.x, dy = home.y - crossing.departureGround.y, length = Math.hypot(dx, dy) || 1;
        candidates.push({ point: walkableGoal(snapshot.map, crossing.departureGround.x + dx / length * ASSEMBLY_RANGE,
          crossing.departureGround.y + dy / length * ASSEMBLY_RANGE), landId });
      }
    }
    candidates.push(...localBases.map(base => ({ point: walkableGoal(snapshot.map, base.x, base.y), landId })),
      ...group.map(unit => ({ point: { x: unit.x, y: unit.y }, landId })));
    const target = candidates.find(candidate => landIdAt(snapshot.map, candidate.point) === landId && sameGround(snapshot.map, actor, candidate.point)
      && hulls.every(hull => distanceToHull(hull, candidate.point) > actor.radius)
      && !neutralCampPointContacts(snapshot, actor, candidate.point, { facts, arrivalMode: 'hold' }).length
      && foes.every(foe => distance(foe, candidate.point) > retreatThreatReach(snapshot, foe, actor, THINK_TICKS) + ASSEMBLY_RANGE
        // A nearby opponent remains unsafe in planning. Even an unreachable
        // land route can permit fire across water; do not infer safety or call
        // native reachability outside the shared ledger.
        || !planningRoute && 'order' in foe && !canReach(snapshot.map, foe, { ...actor, x: candidate.point.x, y: candidate.point.y }, snapshot.units)));
    if (target) result.push({ id: `${methodId}/rally:${landId}`, target, unitIds: group.map(unit => unit.id) });
  }
  return { posts: result, pending };
}

/** Every quote binds only its actual combat bundle. A boat passenger cannot
 * acquire an invented land origin, and a source without a safe observed post
 * remains an explicit prerequisite instead of a cross-water move. */
export function bindConquestAssemblyPosts(input: RallyInput & Readonly<{ unitIds: readonly string[] }>) {
  const geometry = assemblyPosts(input), all = geometry.posts, posts: AssemblyPost[] = [], missing: AllocationPrecondition[] = [];
  const selected = new Set(input.unitIds), members = input.snapshot.units.filter(unit => selected.has(unit.id)
    && unit.owner === input.situation.owner && combatant(unit));
  const perLand = new Map<LandId, string[]>();
  for (const unit of members) {
    const land = !unit.deck && !unit.cabin ? landIdAt(input.snapshot.map, unit) : undefined;
    const post = land && all.find(post => post.target.landId === land);
    if (land && post) { const ids = perLand.get(land) ?? []; ids.push(unit.id); perLand.set(land, ids); continue; }
    const code = unit.deck || unit.cabin ? 'assembly-aboard-origin-unquoted' : 'assembly-safe-post-unquoted';
    missing.push({ id: `${input.methodId}/${code}:${unit.id}`, kind: 'route', status: 'unknown',
      reason: { code, factIds: [unit.id], values: {} }, demand: null, subgoalIds: [`${input.methodId}/assemble-force`] });
    for (const pending of land ? geometry.pending.get(land) ?? [] : []) missing.push({
      id: `${input.methodId}/rally-pending:${unit.id}:${pending.values.fromX},${pending.values.fromY}:${pending.values.goalX},${pending.values.goalY}`,
      kind: 'route', status: 'unknown', reason: pending, demand: null, subgoalIds: [`${input.methodId}/assemble-force`] });
  }
  for (const post of all) posts.push({ ...post, unitIds: (perLand.get(post.target.landId!) ?? []).sort() });
  return { posts, missing, unitIds: members.map(unit => unit.id).sort() };
}
