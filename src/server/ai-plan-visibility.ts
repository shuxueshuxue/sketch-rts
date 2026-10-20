import type {RoomState,PlayerId} from '../shared/types';
/** Uses the room's existing join identity; subscription messages cannot choose an audience. */
export function aiPlanAudience(room:RoomState,viewer?:PlayerId):PlayerId|undefined{
  if(room.status==='ended')return undefined;
  const seat=room.slots.find(slot=>slot.playerId===viewer || !!slot.userId && viewer===`spectator-${slot.userId}`);
  if(seat)return seat.playerId;
  return viewer?.startsWith('spectator-')?undefined:'__no_plan_access__';
}
