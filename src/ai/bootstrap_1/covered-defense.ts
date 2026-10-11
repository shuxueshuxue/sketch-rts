import { isOpenGround, walkingDistance } from '../../shared/terrain';
import { nearestByRoute } from '../../shared/route-selection';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { V6PolicyMemory } from '../memory';
import { resolveAiCommandIntent } from '../policy/commands';
import { averagePoint, distance, type Point } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import type { ArmyDefense } from '../policy/v6/general';
import type { V6Intel } from '../policy/v6/intel';
import { TOWER_STRENGTH } from '../policy/v6/strength';

const POST_RADIUS = 80;
const LEASH = 450;

function step(from: Point, toward: Point, amount: number): Point {
  const gap = distance(from, toward);
  return gap === 0 ? from : { x: from.x + (toward.x - from.x) / gap * amount,
    y: from.y + (toward.y - from.y) / gap * amount };
}

/** Tower support belongs to the fighting post, rather than a count near the hall. */
export function coveredDefenseTarget(snapshot: GameSnapshot, intel: V6Intel): ArmyDefense | undefined {
  const intrusion = intel.intrusion;
  if (!intrusion) return undefined;
  const field = averagePoint(intrusion.attackers);
  const hall = nearestByRoute(snapshot.map, intel.ownHalls, field, 'land');
  if (!hall) return undefined;
  const point = step(hall, field, 200);
  const covering = (post: Point) => intel.ownTowers.filter(tower => tower.complete
    && distance(tower, post) + POST_RADIUS <= tower.attackRange)
    .reduce((power, tower) => power + TOWER_STRENGTH * tower.hp / tower.maxHp, 0);
  const cover = covering(point);
  const posts = intel.ownTowers.flatMap(tower => {
    if (!tower.complete || distance(tower, hall) > tower.attackRange + LEASH) return [];
    const depth = tower.attackRange / 3;
    if (depth <= tower.radius + POST_RADIUS) return [];
    const point = step(tower, field, -depth);
    if (!isOpenGround(snapshot.map, point.x, point.y) || walkingDistance(snapshot.map, hall, point) === undefined) return [];
    return [point];
  });
  const post = nearestByRoute(snapshot.map, posts, intel.armyCenter!, 'land');
  if (post === undefined) return { point, field, hall,
    threat: intrusion.threat, cover, inCover: cover > 0, waitingPoint: point, waitingCover: 0, edge: .9, stay: .6,
    leash: LEASH, guard: step(intel.home, field, -200) };
  return { point, field, hall, threat: intrusion.threat, cover, inCover: cover > 0,
    waitingPoint: post, waitingCover: covering(post), edge: .9, stay: .6, leash: LEASH, guard: post };
}

/** Hold at the covered post so normal idle acquisition cannot restart an uncovered chase. */
export function holdCoveredPost(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory,
  line: Unit[], defense: ArmyDefense, options: AiPolicyContext): GameCommand[] {
  const point = defense.waitingPoint;
  memory.general = { mode: 'guard', target: { x: point.x, y: point.y } };
  const arriving = line.filter(unit => distance(unit, point) <= POST_RADIUS && unit.order.type !== 'hold');
  const walking = line.filter(unit => distance(unit, point) > POST_RADIUS
    && !(unit.order.type === 'move' && distance(unit.order, point) <= POST_RADIUS / 2));
  return [
    ...(walking.length ? [resolveAiCommandIntent(snapshot, owner,
      { type: 'move', unitIds: walking.map(unit => unit.id), ...point }, options)] : []),
    ...(arriving.length ? [{ type: 'holdPosition' as const, unitIds: arriving.map(unit => unit.id) }] : []),
  ];
}
