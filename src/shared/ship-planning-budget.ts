import { isShipKind } from './ship-geometry';
import type { Unit } from './types';

type PlanningFrame = { units: readonly Unit[]; tick: number; granted?: Unit };
// This only binds the current tick's allowance. Queue age lives in the saved
// sailing fields, so a restored game rebuilds exactly the same ordering.
const frames = new WeakMap<Unit, PlanningFrame>();

/** Movement authorities which can still ask for a complex ship route. */
export function hasShipPlanningWork(ship: Unit, units: readonly Unit[] = []): boolean {
  if (ship.hp <= 0 || !isShipKind(ship.kind)) return false;
  const order = ship.order;
  switch (order.type) {
    case 'move': case 'attack': case 'attackMove': case 'follow': case 'unload': case 'aim': case 'cast':
      return true;
    case 'boardShip':
      return ship.sailing?.gangway?.phase === 'approach'
        && ship.sailing.gangway.targetId === order.targetId
        && units.some(target => target.id === order.targetId && target !== ship
          && target.hp > 0 && isShipKind(target.kind));
    case 'idle': {
      const defense = ship.sailing?.defense;
      if (defense?.returning) return true;
      if (defense?.targetId && units.some(target => target.id === defense.targetId
        && target.hp > 0 && isShipKind(target.kind))) return true;
      return units.some(crew => crew.hp > 0 && crew.owner === ship.owner && !isShipKind(crew.kind)
        && !crew.deck && !crew.cabin && crew.order.type === 'board' && crew.order.transportId === ship.id);
    }
    default:
      return false;
  }
}

function clearRequest(ship: Unit) {
  if (!ship.sailing) return;
  delete ship.sailing.planningRequestedAtTick;
  delete ship.sailing.planningLastRequestedAtTick;
}

function validTick(value: number | undefined, tick: number): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= tick;
}

function pruneRequest(ship: Unit, frame: PlanningFrame): boolean {
  const motion = ship.sailing;
  if (!motion) return false;
  const requested = motion.planningRequestedAtTick;
  if (requested === undefined && motion.planningLastRequestedAtTick === undefined) return false;
  const last = motion.planningLastRequestedAtTick ?? requested;
  if (!validTick(requested, frame.tick) || !validTick(last, frame.tick)
    || last < requested || last < frame.tick - 1 || !hasShipPlanningWork(ship, frame.units)) {
    clearRequest(ship);
    return false;
  }
  return true;
}

/** Start one replay-stable complex-planner allowance for the live unit set. */
export function beginShipPlanningFrame(units: readonly Unit[], tick: number): void {
  const frame: PlanningFrame = { units, tick };
  for (const ship of units) {
    if (!isShipKind(ship.kind)) continue;
    frames.set(ship, frame);
    pruneRequest(ship, frame);
  }
}

/** FIFO admission; a granted hull may make several related plans this tick. */
export function tryAdmitShipPlan(ship: Unit): boolean {
  const frame = frames.get(ship);
  // Pure navigation callers do not run a simulation frame and keep their
  // synchronous contract. Simulation callers bind the frame before steering.
  if (!frame) return true;
  if (!ship.sailing || !hasShipPlanningWork(ship, frame.units)) {
    clearRequest(ship);
    return false;
  }
  if (frame.granted === ship) {
    clearRequest(ship);
    return true;
  }
  pruneRequest(ship, frame);
  ship.sailing.planningRequestedAtTick ??= frame.tick;
  ship.sailing.planningLastRequestedAtTick = frame.tick;
  if (frame.granted) return false;

  let first: Unit | undefined;
  for (const waiting of frame.units) {
    if (!isShipKind(waiting.kind) || !pruneRequest(waiting, frame)) continue;
    const requested = waiting.sailing!.planningRequestedAtTick!;
    const previous = first?.sailing?.planningRequestedAtTick;
    if (!first || requested < previous! || requested === previous && waiting.id < first.id) first = waiting;
  }
  if (first !== ship) return false;
  frame.granted = ship;
  clearRequest(ship);
  return true;
}
