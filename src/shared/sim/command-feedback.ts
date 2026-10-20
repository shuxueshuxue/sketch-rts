import type { CommandRefusal } from '../command-refusal';
import type { Game } from '../sim';
import type { GameCommand, PlayerId, Unit, UnitOrder } from '../types';
import { seconds } from '../time';

/** Seat identity is deterministic on every peer; AI's stale plans do not need player-facing receipts. */
export function receivesCommandFeedback(game: Pick<Game, 'aiPlayers'>, owner: PlayerId): boolean {
  return !game.aiPlayers.includes(owner);
}

/** A receipt never changes an order, a resource or the entity counter. All peers derive it from the same frame. */
export function emitCommandRefusal(game: Game, owner: PlayerId, command: GameCommand, refusal: CommandRefusal,
  unit?: Unit, status: 'rejected' | 'waiting' = 'rejected') {
  if (!receivesCommandFeedback(game, owner)) return;
  const target = 'buildingId' in command ? command.buildingId : 'targetId' in command ? command.targetId
    : 'itemId' in command ? command.itemId : 'resourceId' in command ? command.resourceId : undefined;
  const source = unit ?? ('buildingId' in command ? game.buildings.find(building => building.id === command.buildingId) : undefined);
  const identity = `${owner}-${command.type}-${unit?.id ?? (refusal.reason === 'issuer-gone' ? refusal.detail.entityId : target) ?? 'command'}-${target ?? ''}-${refusal.reason}`;
  const id = status === 'waiting' ? `waiting-${identity}` : `refused-${identity}-${game.tick}`;
  if (game.effects.some(effect => effect.id === id)) return;
  game.effects.push({ id, type: 'orderEnded', owner, x: source?.x ?? 0, y: source?.y ?? 0,
    remaining: seconds(.8), duration: seconds(.8), ...(unit ? { unitId: unit.id, sourceKind: unit.kind } : {}),
    commandType: command.type, ...(command.type === "garrison" ? { orderType: "garrison" as const } : {}), feedbackStatus: status, refusal,
    reason: refusal.reason === 'unreachable' ? 'unreachable' : refusal.reason === 'target-gone' || refusal.reason === 'garrison-ownership' ? 'target-gone'
      : refusal.reason === 'tower-full' ? 'no-room' : 'refused',
  });
}

/** Rebuilt each tick from current blockers, including after checkpoint restoration; no unsaved latch or clock. */
export function clearWaitingReceipts(game: Game) {
  if (game.effects.some(effect => effect.feedbackStatus === 'waiting')) game.effects = game.effects.filter(effect => effect.feedbackStatus !== 'waiting');
}

export function commandForOrder(unit: Unit): GameCommand | undefined {
  const order: UnitOrder = unit.order;
  switch (order.type) {
    case 'mine': return { type: 'mine', unitIds: [unit.id], resourceId: order.resourceId };
    case 'repair': return { type: 'repair', unitIds: [unit.id], buildingId: order.buildingId };
    case 'repairUnit': case 'repairShip': return { type: order.type, unitIds: [unit.id], targetId: order.targetId };
    case 'garrison': return { type: 'garrison', unitIds: [unit.id], buildingId: order.buildingId };
    case 'board': return { type: 'board', unitIds: [unit.id], transportId: order.transportId };
    case 'boardShip': return { type: 'boardShip', unitIds: [unit.id], targetId: order.targetId };
    case 'build': return { type: 'build', unitId: unit.id, buildingKind: order.buildingKind, x: order.x, y: order.y };
    case 'cast': return { type: 'cast', unitId: unit.id, ability: order.ability, ...(order.targetId ? { targetId: order.targetId } : {}), ...(order.x !== undefined && order.y !== undefined ? { x: order.x, y: order.y } : {}) };
    case 'pickupItem': return { type: 'pickupItem', unitId: unit.id, itemId: order.itemId };
    case 'itemErrand':
      if (order.action === 'give') return { type: 'giveItem', unitId: unit.id, itemId: order.itemId, targetId: order.targetId! };
      if (order.action === 'drop') return { type: 'dropItem', unitId: unit.id, itemId: order.itemId, x: order.x!, y: order.y! };
      return { type: 'useItem', unitId: unit.id, itemId: order.itemId, ...(order.targetId ? { targetId: order.targetId } : {}), ...(order.x !== undefined && order.y !== undefined ? { x: order.x, y: order.y } : {}) };
    default: return undefined;
  }
}
