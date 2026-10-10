import { areaCastPoint } from '../../shared/combat-geometry';
import { STORM_STAFF } from '../../shared/item-rules';
import type { StormPointSelector } from '../policy/item-tactics';
import { hostileUnitsNear } from '../policy/snapshot';
import { distance } from '../policy/spatial';

/** Ground coverage uses unit centers, just like the item's impact and pulses. */
export const stormPoint: StormPointSelector = (snapshot, owner, carrier, options) => {
  const targets = hostileUnitsNear(snapshot, owner, carrier, STORM_STAFF.range + STORM_STAFF.radius, options.teams);
  const points = targets.flatMap(target => {
    const point = areaCastPoint(carrier, target, STORM_STAFF.range, STORM_STAFF.radius);
    if (point === undefined) return [];
    const hits = targets.filter(unit => distance(unit, point) <= STORM_STAFF.radius);
    return [{ point, real: hits.filter(unit => unit.kind !== 'spirit').length, hits: hits.length }];
  });
  return points.sort((a, b) => b.real - a.real || b.hits - a.hits || distance(a.point, carrier) - distance(b.point, carrier))[0]?.point;
};
