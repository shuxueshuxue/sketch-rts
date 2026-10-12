import { isHealingBuildingKind, unitMover } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { groundSteeringRoute, nearestByRoute } from '../../shared/route-selection';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { retreatV6Front, V7_WOUNDED_SHARE } from '../policy/v6/general';
import { armedFoes, retreatLandTravelTicks, retreatThreatReach } from './safe-land-route';

function safeHealingPosts(snapshot: GameSnapshot, owner: PlayerId, threats: readonly (Unit | Building)[]) {
  return snapshot.buildings.filter(building => building.owner === owner && building.hp > 0 && building.complete
    && isHealingBuildingKind(building.kind) && !threats.some(foe => distance(foe, building) <= retreatThreatReach(snapshot, foe, building, 0)));
}

function reachableCare(snapshot: GameSnapshot, patient: Unit, posts: readonly Building[], foes: readonly (Unit | Building)[]) {
  return posts.flatMap(post => {
    const road = groundSteeringRoute(snapshot.map, patient, post), point = road[road.length - 1]!;
    return distance(point, post) <= post.attackRange && retreatLandTravelTicks(snapshot, patient, point, foes) !== undefined
      ? [{ post, ...point }] : [];
  });
}

/** Existing healing posts give a critical front soldier somewhere useful to withdraw. */
export function recoverBootstrapFront(snapshot: GameSnapshot, owner: PlayerId, wounded: Unit[], point: Point, options: AiPolicyContext) {
  if (wounded.length === 0) return [];
  const foes = armedFoes(snapshot, owner, options), wells = safeHealingPosts(snapshot, owner, foes);
  const groups = new Map<string, { point: Point; units: Unit[] }>();
  for (const unit of wounded) {
    const posts = canReceiveHealing(unit, snapshot) ? reachableCare(snapshot, unit, wells, foes) : [];
    const post = nearestByRoute(snapshot.map, posts, unit, 'land');
    const target = post === undefined ? point : post;
    const key = `${target.x}/${target.y}`, group = groups.get(key);
    if (group) group.units.push(unit); else groups.set(key, { point: target, units: [unit] });
  }
  return [...groups.values()].flatMap(({ point, units }) => retreatV6Front(snapshot, owner, units, point, options));
}

export function postRecoveryAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const patients = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker'
    && unitMover(unit.kind) === 'land' && unit.expiresTick === undefined && unit.hp < unit.maxHp
    && canReceiveHealing(unit, snapshot));
  const foes = patients.length ? armedFoes(snapshot, owner, options) : [];
  const wells = patients.length ? safeHealingPosts(snapshot, owner, foes) : [];
  return patients.flatMap(patient => {
    const posts = reachableCare(snapshot, patient, wells.filter(post => patient.hp < patient.maxHp * V7_WOUNDED_SHARE
      || distance(patient, post) <= post.attackRange
      || patient.order.type === 'move' && patient.order.avoidCombat && distance(patient.order, post) <= post.attackRange), foes);
    const exposed = foes.some(foe => distance(patient, foe) <= retreatThreatReach(snapshot, foe, patient, 0));
    const ready = exposed ? [] : posts.filter(care => distance(patient, care.post) <= care.post.attackRange);
    const post = ready.length ? ready.sort((a, b) => distance(patient, a) - distance(patient, b))[0]
      : nearestByRoute(snapshot.map, posts, patient, 'land');
    return post ? [{ patient, post: post.post, point: post, walk: distance(patient, post.post) > post.post.attackRange || exposed }] : [];
  });
}

/** Care keeps its ordinary movement ownership until the patient has fully recovered. */
export const frontRecovery: AiScript = {
  id: 'frontRecovery', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(postRecoveryAssignments(snapshot, owner, options).map(({ patient }) => patient.id)),
  run: (snapshot, owner, options) => postRecoveryCommands(postRecoveryAssignments(snapshot, owner, options)),
};

export function postRecoveryCommands(assignments: ReturnType<typeof postRecoveryAssignments>): GameCommand[] {
  return assignments.map(({ patient, point, walk }) => walk
    ? { type: 'move', unitIds: [patient.id], x: point.x, y: point.y, avoidCombat: true }
    : { type: 'holdPosition', unitIds: [patient.id] });
}
