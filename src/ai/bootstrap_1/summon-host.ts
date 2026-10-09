import type { Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';

/** Four or more summoners form a host; home recruits do not move its staging point. */
export function summonHost(casters: Unit[], target: Point | undefined) {
  const anchor = target ? [...casters].sort((a, b) => distance(a, target) - distance(b, target))[0]!
    : casters.map(caster => ({ caster, size: casters.filter(other => distance(caster, other) <= 350).length }))
      .sort((a, b) => b.size - a.size)[0]!.caster;
  return casters.filter(caster => distance(caster, anchor) <= 350);
}
