import type { Unit } from '../../shared/types';
import type { NeutralCampExposure } from '../situation/neutral-camp-exposure';
import type { Point } from './types';

/** A gathering point stays outside the target guards' native acquisition
 * disks, including their authored home while they are displaced. This says
 * nothing about safe travel, pursuit, third parties or winning the battle. */
export function goalCampStagingOutsideAlert(camp: NeutralCampExposure, point: Point, group: readonly Pick<Unit, 'radius'>[]) {
  const radius = Math.max(0, ...group.map(unit => unit.radius));
  return camp.members.every((member, index) => {
    const clearance = member.alertRadius + radius + camp.camp.creeps[index]!.radius;
    return Math.hypot(point.x - member.point.x, point.y - member.point.y) > clearance
      && Math.hypot(point.x - member.home.x, point.y - member.home.y) > clearance;
  });
}
