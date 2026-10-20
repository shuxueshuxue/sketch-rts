import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { retreatThreatReach, THINK_TICKS } from '../policy/threat-reach';
import type { NeutralCampExposureFacts } from './neutral-camp-exposure';
import { armedFoes } from '../policy/armed-foes';

type Point = Readonly<{ x: number; y: number }>;
type Threat = Unit | Building;
type Options = { facts?: NeutralCampExposureFacts; foes?: readonly Threat[]; starting?: boolean; allowDeparture?: boolean };
export type WorkerExposure = Readonly<{ foe: Threat; point: Point; segment: number; distance: number; radius: number }>;
// The worker role starts leaving before a volley. Route prices, site checks and
// evacuation vetoes all use this same margin and next-think threat horizon.
const WORKER_MARGIN = 160;

export function workerExposureRadius(snapshot: GameSnapshot, worker: Unit, foe: Threat, point: Point = worker) {
  const reach = retreatThreatReach(snapshot, foe, { ...worker, ...point }, THINK_TICKS);
  return reach > 0 ? reach + WORKER_MARGIN : 0;
}

/** Read-only exposure to a point or the actual native steering polyline. The
 * Planning and evacuation default to the same complete hostile fact set. */
export function workerExposure(snapshot: GameSnapshot, worker: Unit, path: Point | readonly Point[], options: Options = {}): readonly WorkerExposure[] {
  const points = Array.isArray(path) ? path : [path as Point];
  if (!points.length) return [];
  const foes = options.foes ?? armedFoes(snapshot, worker.owner, snapshot.teams ? { teams: snapshot.teams } : {});
  const result: WorkerExposure[] = [];
  const bounds = points.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y) }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  for (const foe of foes) {
    if (foe.hp <= 0 || foe.attackDamage <= 0 || 'order' in foe && foe.deck || options.starting && foe.attackRange <= 80) continue;
    // Outside a charge's minimum range the threat envelope is maximal. Use
    // that only for coarse rejection, then evaluate the actual closest point.
    const maximum = workerExposureRadius(snapshot, worker, foe, { x: foe.x + snapshot.map.width + snapshot.map.height, y: foe.y });
    if (foe.x + maximum < bounds.minX || foe.x - maximum > bounds.maxX
      || foe.y + maximum < bounds.minY || foe.y - maximum > bounds.maxY) continue;
    const exposures: WorkerExposure[] = [];
    for (let index = 0; index < points.length; index++) {
      const to = points[index]!, from = points[Math.max(0, index - 1)]!;
      const dx = to.x - from.x, dy = to.y - from.y;
      const along = Math.max(0, Math.min(1, ((foe.x - from.x) * dx + (foe.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
      const point = { x: from.x + dx * along, y: from.y + dy * along };
      const radius = workerExposureRadius(snapshot, worker, foe, point), distance = Math.hypot(foe.x - point.x, foe.y - point.y);
      if (radius > 0 && distance <= radius) exposures.push({ foe, point, segment: index, distance, radius });
    }
    const start = points[0]!, end = points.at(-1)!;
    const startGap = Math.hypot(foe.x - start.x, foe.y - start.y);
    // A unit already exposed may leave monotonically. Admission and the veto
    // both permit that same explicit avoid-combat road, never a closer pass.
    const leaving = options.allowDeparture && points.length > 1
      && startGap <= workerExposureRadius(snapshot, worker, foe, start)
      && Math.hypot(foe.x - end.x, foe.y - end.y) > workerExposureRadius(snapshot, worker, foe, end)
      && exposures.every(exposure => exposure.distance >= startGap - 1e-6);
    if (!leaving) result.push(...exposures);
  }
  return result;
}
