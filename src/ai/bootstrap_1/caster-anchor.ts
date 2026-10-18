import { detCos, detSin } from '../../shared/det-math';
import { isOpenGround, openGroundNear } from '../../shared/terrain';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import type { CasterAnchor } from '../policy/v6/backline';
import { armedFoes, retreatLandRoad } from './safe-land-route';

/** A post is an executable destination, including the native road to its side of a cliff. */
export function casterAnchorPlanner(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, home: Point): CasterAnchor {
  const foes = armedFoes(snapshot, owner, options);
  const open = (point: Point) => point.x >= 0 && point.y >= 0 && point.x < snapshot.map.width && point.y < snapshot.map.height
    ? isOpenGround(snapshot.map, point.x, point.y) ? point : openGroundNear(snapshot.map, point) : undefined;
  return (caster, preferred, retreat) => {
    // Deck movement belongs to the ferry, rather than the land's steering field.
    if (caster.deck) return preferred;
    const admitted = (candidate: Point | undefined) => {
      if (!candidate) return undefined;
      // Close healers deliberately follow their fighting screen into firing range.
      const road = retreatLandRoad(snapshot, caster, candidate, retreat ? foes : []);
      const end = road?.points[road.points.length - 1];
      return end && isOpenGround(snapshot.map, end.x, end.y) && distance(end, candidate) <= MOVE_ORDER_ARRIVAL_RANGE ? end : undefined;
    };
    const original = admitted(open(preferred));
    if (original || !retreat) return original;
    // Keep as near the intended screen as a safe road permits. A blocked homeward
    // ray can require stepping along the bank before turning toward home.
    const angle = Math.atan2(home.y - caster.y, home.x - caster.x);
    const choices = [home, ...[160, 320, 640].flatMap(range => Array.from({ length: 16 }, (_, index) => ({
      x: caster.x + detCos(angle + index * Math.PI / 8) * range,
      y: caster.y + detSin(angle + index * Math.PI / 8) * range,
    })))].map(open).filter((point): point is Point => point !== undefined)
      .sort((a, b) => distance(a, preferred) - distance(b, preferred) || distance(a, home) - distance(b, home));
    for (const point of choices) {
      const safe = admitted(point);
      if (safe) return safe;
    }
    return undefined;
  };
}
