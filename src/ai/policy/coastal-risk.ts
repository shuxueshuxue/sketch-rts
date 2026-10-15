import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { canReach } from '../../shared/naval';
import { isInCabin } from '../../shared/ship-cabin';
import { distanceToHull, shipProfile } from '../../shared/ship-geometry';
import { headingDifference, nearestShipPose } from '../../shared/ship-navigation';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isEnemyOwner } from './ownership';
import { distance, type Point } from './spatial';
import type { AiPolicyContext } from '../policy';
import { attackMargin } from './v6/general';
import { effectiveCombatRating } from './v6/strength';

/** Shore fire threatens the hull edge, not its center. Count only troops that
 * can reach this water, and only nearby allies that can fight those troops.
 * A remote army or a soldier in a cabin is not cover for a coastal battery.
 */
export function outmatchingCoast(snapshot: GameSnapshot, owner: PlayerId, ship: Unit, station: Point, options: AiPolicyContext): Unit[] {
  const posed={...ship,x:station.x,y:station.y};
  const threats=snapshot.units.filter(unit=>unit.hp>0 && unitMover(unit.kind)==='land' && !isInCabin(unit)
    && isEnemyOwner(snapshot,owner,unit.owner,options) && combatCapability(snapshot,unit).armed
    && distanceToHull(posed,unit)<=combatCapability(snapshot,unit).range+160
    && canReach(snapshot.map,unit,posed,snapshot.units));
  if (!threats.length) return [];
  const support=snapshot.units.filter(unit=>unit.hp>0 && unit.owner!=='neutral' && !isInCabin(unit)
    && !isEnemyOwner(snapshot,owner,unit.owner,options)
    && (unit.id===ship.id || distance(unit,ship)<600 || distance(unit,station)<600)
    && threats.some(foe=>canReach(snapshot.map,unit,foe,snapshot.units,combatCapability(snapshot,unit).range)
      && (!shipProfile(unit) || distance(unit,ship)<600 || distance(unit,station)<600)));
  const ours=support.reduce((sum,unit)=>sum+effectiveCombatRating(snapshot,unit),0);
  const theirs=threats.reduce((sum,unit)=>sum+effectiveCombatRating(snapshot,unit),0);
  return theirs*attackMargin(options)>ours ? threats : [];
}

/** A heading-compatible escape, rather than a point directly opposite the
 * enemy that makes the hull describe a large turn through its firing zone.
 * Ordinary movement still plans and executes the actual collision-free road.
 */
export function coastalRefuge(snapshot: GameSnapshot, ship: Unit, threats: Unit[]): Point | undefined {
  const heading=ship.sailing?.heading ?? 0;
  const candidates=[];
  for (let i=0;i<16;i++) {
    const angle=heading+i*Math.PI/8;
    const pose=nearestShipPose(snapshot.map,ship,{x:ship.x+Math.cos(angle)*600,y:ship.y+Math.sin(angle)*600});
    if (!pose || distance(ship,pose)<200) continue;
    const hull={...ship,x:pose.x,y:pose.y,sailing:{...ship.sailing!,heading:pose.heading}};
    if (threats.some(foe=>distanceToHull(hull,foe)<=combatCapability(snapshot,foe).range+200)) continue;
    candidates.push({pose,turn:Math.abs(headingDifference(heading,Math.atan2(pose.y-ship.y,pose.x-ship.x))),distance:distance(ship,pose)});
  }
  candidates.sort((a,b)=>a.turn-b.turn || a.distance-b.distance);
  return candidates[0]?.pose;
}
