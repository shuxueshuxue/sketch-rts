import { filterAiPlanPacket, type AiPlanAudience, type AiPlanPacket } from '../ai/plan-stream';
import type { RoomState, PlayerId } from '../shared/types';

/** Join identities are client-declared, so live multiplayer spectators cannot receive private plans. */
export function aiPlanAudience(room: RoomState, viewer?: PlayerId): AiPlanAudience {
  if (room.status === 'ended') return { kind: 'all' };
  const spectator = viewer?.startsWith('spectator-');
  const humans = room.slots.filter(slot => slot.controller === 'human' && slot.userId).length;
  if (spectator && room.status === 'inMatch' && humans >= 2) return { kind: 'none', reason: 'after-match' };
  const seat = room.slots.find(slot => slot.playerId === viewer || !!slot.userId && viewer === `spectator-${slot.userId}`);
  if (seat) return { kind: 'owner', owner: seat.playerId };
  return spectator ? { kind: 'all' } : { kind: 'none' };
}

/** Restricted coverage describes availability, never an observed or reconstructed plan interval. */
export function filterRoomAiPlanPacket(packet: AiPlanPacket, audience: AiPlanAudience): AiPlanPacket | undefined {
  if (audience.kind === 'none' && audience.reason === 'after-match' && packet.type === 'coverage') {
    return { ...packet, availability: 'after-match' };
  }
  return filterAiPlanPacket(packet, audience);
}
