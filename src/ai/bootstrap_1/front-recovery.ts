import { isHealingBuildingKind, unitMover } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { nearestByRoute } from '../../shared/route-selection';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { retreatV6Front, V7_WOUNDED_SHARE } from '../policy/v6/general';
import { mountedThreatReach } from './mounted-micro';

function safeHealingPosts(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const threats = [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
  return snapshot.buildings.filter(building => building.owner === owner && building.hp > 0 && building.complete
    && isHealingBuildingKind(building.kind) && !threats.some(foe => distance(foe, building) <= mountedThreatReach(snapshot, foe, building, 0)));
}

/** Existing healing posts give a critical front soldier somewhere useful to withdraw. */
export function recoverBootstrapFront(snapshot: GameSnapshot, owner: PlayerId, wounded: Unit[], point: Point, options: AiPolicyContext) {
  if (wounded.length === 0) return [];
  const wells = safeHealingPosts(snapshot, owner, options);
  const groups = new Map<Point, Unit[]>();
  for (const unit of wounded) {
    const posts = canReceiveHealing(unit, snapshot) ? wells : [];
    const post = nearestByRoute(snapshot.map, posts, unit, 'land');
    const target = post === undefined ? point : post;
    const group = groups.get(target);
    if (group) group.push(unit); else groups.set(target, [unit]);
  }
  return [...groups].flatMap(([post, units]) => retreatV6Front(snapshot, owner, units, post, options));
}

export function postRecoveryAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const patients = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker'
    && unitMover(unit.kind) === 'land' && unit.expiresTick === undefined && unit.hp < unit.maxHp
    && canReceiveHealing(unit, snapshot));
  const wells = patients.length ? safeHealingPosts(snapshot, owner, options) : [];
  return patients.flatMap(patient => {
    const posts = wells.filter(post => patient.hp < patient.maxHp * V7_WOUNDED_SHARE
      || distance(patient, post) <= post.attackRange
      || patient.order.type === 'move' && patient.order.avoidCombat && distance(patient.order, post) <= post.radius);
    const ready = posts.filter(post => distance(patient, post) <= post.attackRange);
    const post = ready.length ? ready.sort((a, b) => distance(patient, a) - distance(patient, b))[0]
      : nearestByRoute(snapshot.map, posts, patient, 'land');
    return post ? [{ patient, post }] : [];
  });
}

/** Care keeps its ordinary movement ownership until the patient has fully recovered. */
export const frontRecovery: AiScript = {
  id: 'frontRecovery', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(postRecoveryAssignments(snapshot, owner, options).map(({ patient }) => patient.id)),
  run: (snapshot, owner, options) => postRecoveryCommands(postRecoveryAssignments(snapshot, owner, options)),
};

export function postRecoveryCommands(assignments: ReturnType<typeof postRecoveryAssignments>): GameCommand[] {
  return assignments.map(({ patient, post }) =>
    distance(patient, post) <= post.attackRange
      ? { type: 'holdPosition', unitIds: [patient.id] }
      : { type: 'move', unitIds: [patient.id], x: post.x, y: post.y, avoidCombat: true });
}
