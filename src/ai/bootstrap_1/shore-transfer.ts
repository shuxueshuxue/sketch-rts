import {connectedSurfacePath,decksCanTransfer} from '../../shared/connected-decks';
import {canBoard,deckWalkPathExists} from '../../shared/decks';
import {boardingBerth,passengerLandingSpot} from '../../shared/naval';
import {worldToLocal} from '../../shared/ship-geometry';
import type {GameCommand,GameSnapshot,PlayerId} from '../../shared/types';
import {clearTransferLanes} from '../policy/transfer-lanes';
import type {AiPolicyContext} from '../policy/types';
import {armedFoes,safeLandTravelTicks} from './safe-land-route';

/** A crowded ship-to-ship transfer may use a real, safe quay instead. */
export function planShoreTransfers(snapshot:GameSnapshot,owner:PlayerId,options:AiPolicyContext):GameCommand[] {
 const commands:GameCommand[]=[];
 for(const passenger of snapshot.units) {
  if(passenger.owner!==owner || !passenger.deck || passenger.cabin || passenger.gangway || passenger.order.type!=='board')continue;
  const source=snapshot.units.find(u=>u.id===passenger.deck!.shipId),target=snapshot.units.find(u=>u.id===(passenger.order.type==='board'?passenger.order.transportId:undefined));
  if(!source || !target || source===target || source.owner!==owner || target.owner!==owner || !decksCanTransfer(source,target,passenger)
    || !canBoard(target,passenger,snapshot.units) || connectedSurfacePath(passenger,target,snapshot.units,snapshot.map)?.complete)continue;
  // Prefer a feasible deck maneuver. A vacant destination alone does not
  // prove that a large engine can walk there past the other crew.
  const yielding=clearTransferLanes(snapshot,owner).some(command=>command.type==='move' && command.unitIds.some(id=>{
   const unit=snapshot.units.find(u=>u.id===id),ship=unit?.deck&&snapshot.units.find(u=>u.id===unit.deck!.shipId);
   if(!unit || !ship || ![source.id,target.id].includes(ship.id))return false;
   const crossing=connectedSurfacePath(unit,command,snapshot.units,snapshot.map);
   return crossing ? crossing.complete : deckWalkPathExists(ship,unit,worldToLocal(ship,command),snapshot.units);
  }));
  if(yielding)continue;
  const shore=passengerLandingSpot(snapshot.map,source,passenger.id,snapshot.units);
  if(!shore)continue;
  const landed={...passenger,...shore,deck:undefined};
  const waiting=snapshot.units.find(u=>u.id!==passenger.id && u.order.type==='board' && u.order.transportId===target.id);
  const berth=(waiting?.order.type==='board'?waiting.order.berth:undefined)??boardingBerth(snapshot.map,landed,target);
  if(!berth || safeLandTravelTicks(snapshot,landed,berth.shore??berth,armedFoes(snapshot,owner,options))===undefined)continue;
  commands.push({type:'unloadPassenger',transportId:source.id,passengerId:passenger.id},
   {type:'board',unitIds:[passenger.id],transportId:target.id});
  // One physical landing is planned against this immutable world. Recompute
  // after it executes, so two walkers never reserve the same shore space.
  break;
 }
 return commands;
}
