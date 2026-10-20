import type { PlayerId, Unit } from '../../shared/types';
import { strengthOf } from '../policy/v6/strength';
import { creepForce, forceFor, type Camp } from '../policy/v7/creep';

export type AllocatedForceTarget =
  | Readonly<{ metric: 'field-strength'; requiredForce: number }>
  | Readonly<{ metric: 'camp-force'; camp: Readonly<Camp>; requiredForce?: number }>;

/** Evaluate exactly the supplied cohort. Location, arrival discounts and leases
 * belong to the caller; a passenger is not silently counted as on station here.
 * Camp free volleys depend on the whole group's kill time, so neither marginal
 * force nor an ETA-discounted cohort can be assembled from singleton ratings. */
export function assessAllocatedForce(owner: PlayerId, units: readonly Unit[], target: AllocatedForceTarget) {
  const members = [...new Map(units.filter(unit => unit.owner === owner && unit.hp > 0)
    .map(unit => [unit.id, unit])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const force = target.metric === 'camp-force' ? creepForce(members, target.camp) : strengthOf(members);
  const requiredForce = target.requiredForce ?? (target.metric === 'camp-force' ? forceFor(target.camp) : 0);
  return { metric: target.metric, unitIds: members.map(unit => unit.id), force, requiredForce,
    deficit: Math.max(0, requiredForce - force), sufficient: force >= requiredForce };
}
