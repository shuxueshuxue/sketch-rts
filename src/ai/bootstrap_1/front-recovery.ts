import { isHealingBuildingKind } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { nearestByRoute } from '../../shared/route-selection';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { retreatV6Front } from '../policy/v6/general';
import { mountedThreatReach } from './mounted-micro';

/** Existing healing posts give a critical front soldier somewhere useful to withdraw. */
export function recoverBootstrapFront(snapshot: GameSnapshot, owner: PlayerId, wounded: Unit[], point: Point, options: AiPolicyContext) {
  if (wounded.length === 0) return [];
  const threats = [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
  const wells = snapshot.buildings.filter(building => building.owner === owner && building.hp > 0 && building.complete
    && isHealingBuildingKind(building.kind) && !threats.some(foe => distance(foe, building) <= mountedThreatReach(snapshot, foe, building, 0)));
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
