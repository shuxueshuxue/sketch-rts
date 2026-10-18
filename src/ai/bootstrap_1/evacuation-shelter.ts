import {armedFoes,safeLandTravelTicks} from './safe-land-route';
import {canEnterCabin,isInCabin,cabinExitPoint} from '../../shared/ship-cabin';
import {shipPassengers} from '../../shared/ship-geometry';
import {landingSpot} from '../../shared/naval';
import {sameGround} from '../../shared/terrain';
import {combatCapability} from '../../shared/combat-capabilities';
import {isEnemyOwner} from '../policy/ownership';
import type {GameSnapshot,PlayerId,GameCommand} from '../../shared/types';
import type {AiPolicyContext} from '../policy/types';
/** Shelter civilian evacuees before boarding threats reach the deck; leave only
 * through a native landing and a checked road to an owned hall. */
export function evacuationShelter(s:GameSnapshot,owner:PlayerId,options:AiPolicyContext){
 const memory=options.memory;
 const tracked=memory.evacuationShelters??{},commands:GameCommand[]=[],claimed=new Set<string>();
 const hostile=[...s.units,...s.buildings].filter(u=>isEnemyOwner(s,owner,u.owner,options)&&combatCapability(s,u).armed);
 const landFoes=armedFoes(s,owner,options);
 for(const [id,shipId] of Object.entries(tracked))if(!s.units.some(u=>u.id===id&&u.owner===owner&&u.deck?.shipId===shipId))delete tracked[id];
 for(const ship of s.units.filter(u=>u.owner===owner&&u.sailing)){
  const mission=memory.naval?.ferries?.[ship.id];
  const endangered=mission?.purpose==='evacuate'&&mission.phase==='sailing'&&hostile.some(u=>Math.hypot(u.x-ship.x,u.y-ship.y)<Math.max(500,combatCapability(s,u).range+100));
  const passengers=shipPassengers(s.units,ship);
  for(const u of passengers.filter(u=>u.owner===owner&&u.kind==='worker')){
   if(!tracked[u.id]&&(!endangered||!canEnterCabin(s,u,ship)))continue;
   const spot=landingSpot(s.map,ship,passengers.indexOf(u),passengers.length,s.units,u);
   const safe=spot&&s.buildings.some(b=>b.owner===owner&&b.kind==='townHall'&&b.complete&&sameGround(s.map,b,spot)&&Math.hypot(b.x-spot.x,b.y-spot.y)<850
    &&safeLandTravelTicks(s,{...u,...spot,deck:undefined,cabin:undefined},b,landFoes)!==undefined);
   tracked[u.id]=ship.id;claimed.add(u.id);
   if(safe){if(isInCabin(u)){if(cabinExitPoint(s,ship,u))commands.push({type:'leaveCabin',unitIds:[u.id]});}else commands.push({type:'unloadPassenger',transportId:ship.id,passengerId:u.id});}
   else if(!isInCabin(u)&&u.order.type!=='enterCabin'&&canEnterCabin(s,u,ship))commands.push({type:'enterCabin',unitIds:[u.id]});
  }
 }
 if(Object.keys(tracked).length)memory.evacuationShelters=tracked;else delete memory.evacuationShelters;
 return {commands,claimed};
}
