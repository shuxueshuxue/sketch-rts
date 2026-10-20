import { ABILITY_DEFS } from '../../shared/catalog';
import { unitAbilities } from '../../shared/unit-abilities';
import { isRangedUnit } from '../../shared/unit-weapon-class';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { armedFoes, retreatThreatReach } from '../bootstrap_1/safe-land-route';
import { THINK_TICKS } from '../policy/threat-reach';

type Point = Readonly<{ x: number; y: number }>;
type Threat = Unit | Building;
export type WorkerExposure = { foe: Threat; point: Point; segment: number; distance: number; radius: number };
// Preserve the safety module's original worker clearance and next-think horizon.
const CLEARANCE = 160;

export function workerExposureRadius(snapshot: GameSnapshot, worker: Unit, foe: Threat, point: Point = worker) {
  const reach = retreatThreatReach(snapshot, foe, { ...worker, ...point }, THINK_TICKS);
  return reach > 0 ? reach + CLEARANCE : 0;
}

/** One threat set and one veto for a point and the native steering road.
 * Initial ranged-only evacuation remains unchanged. Retained actions use every
 * armed hostile, including neutral units, enemy soldiers and towers. */
export function workerExposure(snapshot: GameSnapshot, worker: Unit, path: Point | readonly Point[], options: {
  foes?: readonly Threat[]; initial?: boolean; allowDeparture?: boolean;
} = {}): readonly WorkerExposure[] {
  const points = Array.isArray(path) ? path : [path as Point];
  if (!points.length) return [];
  const foes = options.foes ?? armedFoes(snapshot, worker.owner, {});
  const result: WorkerExposure[] = [];
  for (const foe of foes) {
    if (foe.hp <= 0 || foe.attackDamage <= 0 || 'order' in foe && foe.deck
      || options.initial && 'order' in foe && !isRangedUnit(foe)) continue;
    const contacts: WorkerExposure[] = [];
    // Threat reach is constant between charge minimum-range circles. Check the
    // closest point plus both sides of those crossings, not just the closest
    // point: that point can lie in the charge's safe inner circle.
    const boundaries = points.length > 1 && 'order' in foe ? unitAbilities(foe).flatMap(ability => {
      const rules = ABILITY_DEFS[ability]; return rules.behavior === 'charge' ? [rules.minRange] : [];
    }) : [];
    for (let index = 0; index < points.length; index++) {
      const from = points[Math.max(0, index - 1)]!, to = points[index]!;
      const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy;
      const along = length2 ? ((foe.x - from.x) * dx + (foe.y - from.y) * dy) / length2 : 0;
      const candidates = length2 ? [0, 1, Math.max(0, Math.min(1, along))] : [0];
      for (const radius of boundaries) if (length2) {
        const ox = from.x - foe.x, oy = from.y - foe.y;
        const b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - radius * radius;
        const discriminant = b * b - 4 * length2 * c;
        if (discriminant < 0) continue;
        for (const root of [(-b - Math.sqrt(discriminant)) / (2 * length2), (-b + Math.sqrt(discriminant)) / (2 * length2)])
          if (root >= 0 && root <= 1) candidates.push(Math.max(0, root - 1e-7), root, Math.min(1, root + 1e-7));
      }
      for (const t of candidates) {
        const point = { x: from.x + t * dx, y: from.y + t * dy };
        const radius = workerExposureRadius(snapshot, worker, foe, point), distance = Math.hypot(foe.x - point.x, foe.y - point.y);
        if (radius > 0 && distance <= radius) contacts.push({ foe, point, segment: index, distance, radius });
      }
    }
    const start = points[0]!, end = points.at(-1)!;
    const startGap = Math.hypot(foe.x - start.x, foe.y - start.y);
    // Retreats can leave their current exposure, but cannot pass closer to it.
    const leaving = options.allowDeparture && points.length > 1
      && startGap <= workerExposureRadius(snapshot, worker, foe, start)
      && Math.hypot(foe.x - end.x, foe.y - end.y) > workerExposureRadius(snapshot, worker, foe, end)
      && contacts.every(contact => contact.distance >= startGap - 1e-6);
    if (!leaving && contacts.length) result.push(contacts[0]!);
  }
  return result;
}
