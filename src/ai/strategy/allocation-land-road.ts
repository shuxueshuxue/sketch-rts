import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { LandRoadReader } from '../bootstrap_1/safe-land-route';
import { currentAllocationLandRouteReader } from './allocation-arrival-query';
import type { Point } from './types';

/** Adapt published same-think route facts to the existing safety geometry.
 * Undefined preserves the native execution branch outside allocation scope. */
export function allocationLandRoadReader(onPending: (unitId: string, goal: Point, reasonCode: string) => void): LandRoadReader | undefined {
  const read = currentAllocationLandRouteReader();
  return read && ((unit, goal) => {
    const answer = read(unit, goal);
    if (answer.status === 'unknown') onPending(unit.id, goal, answer.reasonCode);
    if (answer.status !== 'known') return undefined;
    const first = { x: unit.x, y: unit.y }, points: [Point, ...Point[]] = [first,
      ...answer.points.filter((point, i) => i > 0 || point.x !== first.x || point.y !== first.y).map(point => ({ ...point }))];
    return { points, ticks: Math.ceil(answer.distance / unit.speed * SIM_TICKS_PER_SECOND) };
  });
}
