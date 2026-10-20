import { UNIT_DEFS } from '../../shared/catalog';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { Building, GameCommand, GameSnapshot, Unit, UnitOrder } from '../../shared/types';
import type { AiPolicyMemory, WorkerContinuation, WorkerContinuationEvent } from '../memory';
import { nativeLandRoad } from './land-road';
import { workerExposure, workerExposureRadius } from '../situation/worker-exposure';
import { landDiskRouter, threatRoadCommands } from '../bootstrap_1/threat-roads';

type Point = { x: number; y: number };
export const commandActors = (command: GameCommand): readonly string[] =>
  'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
export function changesWorkerAction(command: GameCommand) {
  return ['move', 'attackMove', 'attack', 'holdPosition', 'stop', 'follow', 'build', 'board', 'mine', 'repair', 'repairUnit', 'repairShip', 'garrison', 'cast', 'pickupItem'].includes(command.type);
}
export function continuationEvent(snapshot: Pick<GameSnapshot, 'tick'>, memory: AiPolicyMemory, unitId: string,
  state: WorkerContinuation, kind: WorkerContinuationEvent['kind'], reason: string, threatIds: string[] = state.threatIds) {
  if (memory.workerContinuationEvents?.some(event => event.tick !== snapshot.tick)) memory.workerContinuationEvents = [];
  (memory.workerContinuationEvents ??= []).push({ tick: snapshot.tick, unitId, parent: { ...state.parent }, kind, reason, threatIds });
}
export function endWorkerContinuation(snapshot: Pick<GameSnapshot, 'tick'>, memory: AiPolicyMemory, unitId: string, reason: string) {
  const claim = memory.unitClaims[unitId], state = claim?.evacuation?.continuation;
  if (!state) return;
  continuationEvent(snapshot, memory, unitId, state, 'end', reason);
  // The shelter belongs to this rescue, not to a future unrelated build order.
  delete memory.unitClaims[unitId];
}
function matches(order: UnitOrder, command: GameCommand) {
  if ((order.type === 'move' || order.type === 'build') && command.type === order.type && 'x' in command
    && Math.hypot(order.x - command.x, order.y - command.y) < 1e-6)
    return order.type === 'build' ? command.type === 'build' && order.buildingKind === command.buildingKind
      : command.type === 'move' && !!order.avoidCombat === !!command.avoidCombat;
  if (order.type === 'mine' && command.type === 'mine') return order.resourceId === command.resourceId;
  return order.type === 'hold' && command.type === 'holdPosition';
}

export function workerContinuationEndReason(snapshot: GameSnapshot, unit: Unit, state: WorkerContinuation) {
  const parent = state.parent, orders = [unit.order, ...(unit.orderQueue ?? [])].filter(order => order.type !== 'idle');
  const foundation = snapshot.buildings.some(building => building.hp > 0 && building.kind === parent.buildingKind
    && Math.hypot(building.x - parent.x, building.y - parent.y) < 1e-6);
  const reason = foundation ? 'construction-started'
    : state.resourceId && !snapshot.resources.some(mine => mine.id === state.resourceId && mine.amount > 0) ? 'resource-gone'
    : !isBuildPlacementClear(snapshot, parent.buildingKind, parent) ? 'site-occupied'
    : orders.some(order => ![parent, ...state.binding, ...(state.pending ?? [])].some(command => matches(order, command))) ? 'order-replaced'
    : state.phase === 'resuming' && unit.order.type === 'build' && matches(unit.order, parent) ? 'native-parent-observed' : undefined;
  return reason;
}

/** Called before claim pruning. A real rescue is a vacancy, not a timed lease. */
export function prepareWorkerContinuation(snapshot: GameSnapshot, unit: Unit, memory: AiPolicyMemory) {
  const claim = memory.unitClaims[unit.id], state = claim?.evacuation?.continuation;
  if (!state) return;
  const orders = [unit.order, ...(unit.orderQueue ?? [])].filter(order => order.type !== 'idle');
  const reason = workerContinuationEndReason(snapshot, unit, state);
  if (reason) { endWorkerContinuation(snapshot, memory, unit.id, reason); return; }
  if (state.pending && orders.length && orders.every(order => state.pending!.some(command => matches(order, command)))) {
    state.binding = state.pending; delete state.pending;
    if (state.phase === 'resuming') continuationEvent(snapshot, memory, unit.id, state, 'resume', 'native-continuation-observed');
  }
}

export function newWorkerContinuation(snapshot: GameSnapshot, worker: Unit, binding: readonly GameCommand[]): WorkerContinuation | undefined {
  // No idle stance, queued future order, or newly proposed economic order is a parent.
  if (worker.order.type !== 'build') return undefined;
  const parent: WorkerContinuation['parent'] = { type: 'build', unitId: worker.id,
    buildingKind: worker.order.buildingKind, x: worker.order.x, y: worker.order.y };
  if (!isBuildPlacementClear(snapshot, parent.buildingKind, parent)) return undefined;
  const resource = parent.buildingKind === 'townHall' ? snapshot.resources.filter(mine => mine.amount > 0
    && Math.hypot(mine.x - parent.x, mine.y - parent.y) <= GOLD_MINE_RULES.baseRange)
    .sort((a, b) => Math.hypot(a.x - parent.x, a.y - parent.y) - Math.hypot(b.x - parent.x, b.y - parent.y))[0] : undefined;
  return { parent, sinceTick: snapshot.tick, phase: 'life-saving-interruption', binding: [parent],
    threatIds: workerExposure(snapshot, worker, worker).map(contact => contact.foe.id),
    pending: structuredClone([...binding]), ...(resource ? { resourceId: resource.id } : {}) };
}

/** The entire executed road, not a straight line to the remembered parent. */
export function workerOrderRoad(snapshot: GameSnapshot, worker: Unit) {
  const points: Point[] = [{ x: worker.x, y: worker.y }];
  let from = worker;
  for (const order of [worker.order, ...(worker.orderQueue ?? [])]) {
    if (order.type !== 'move' && order.type !== 'build') continue;
    const road = nativeLandRoad(snapshot, from, order);
    if (!road) return undefined;
    points.push(...road.points.slice(1));
    from = { ...worker, ...points.at(-1)! };
  }
  return points;
}

/** Only an already interrupted parent's route is planned here. Each native
 * waypoint leg is checked with exactly the safety veto used next think. */
export function workerContinuationCommands(snapshot: GameSnapshot, worker: Unit, state: WorkerContinuation, foes: readonly (Unit | Building)[]): GameCommand[] | undefined {
  if (state.phase === 'resuming' && (worker.order.type === 'move' || worker.orderQueue?.some(order => order.type === 'move'))) {
    const road = workerOrderRoad(snapshot, worker);
    if (road && !workerExposure(snapshot, worker, road, { foes, allowDeparture: true, firstOnly: true }).length) return [];
  }
  const goal = { x: state.parent.x, y: state.parent.y };
  const direct = nativeLandRoad(snapshot, worker, goal);
  if (!direct || Math.hypot(direct.points.at(-1)!.x - state.parent.x, direct.points.at(-1)!.y - state.parent.y) > 1) return undefined;
  const clear = (points: readonly Point[]) => !workerExposure(snapshot, worker, points, { foes, allowDeparture: true, firstOnly: true }).length;
  if (clear(direct.points)) {
    // A native build does not have avoidCombat. Leave the firing lane with
    // admitted retreat waypoints first; issue build when outside exposure.
    if (!workerExposure(snapshot, worker, worker, { foes, firstOnly: true }).length) return [{ ...state.parent }];
    return threatRoadCommands(worker, direct);
  }
  const disks = foes.flatMap(foe => {
    // Conservative envelope for routing; exact charge/ability geometry is
    // checked again on the actual native road before admission.
    const radius = workerExposureRadius(snapshot, worker, foe, { x: foe.x + snapshot.map.width + snapshot.map.height, y: foe.y });
    return radius > 0 && !('order' in foe && foe.deck) ? [{ x: foe.x, y: foe.y, radius }] : [];
  });
  const detour = landDiskRouter(snapshot, worker, disks)(goal);
  if (!detour) return undefined;
  // A safe road is not free: excess travel costs mining income. Do not spend
  // more than replacing this worker just to avoid its loss. This is a route
  // admission price, not a timer: the parent stays a vacancy and safe mining
  // continues until the route, threat or valid parent changes.
  const extraGold = Math.max(0, detour.ticks - direct.ticks) / SIM_TICKS_PER_SECOND
    * GOLD_MINE_RULES.goldPerTrip / GOLD_MINE_RULES.gatherSeconds;
  if (extraGold > UNIT_DEFS.worker.cost) return undefined;
  const points: Point[] = [{ x: worker.x, y: worker.y }];
  let from = worker;
  for (const waypoint of detour.points.slice(1)) {
    const leg = nativeLandRoad(snapshot, from, waypoint);
    if (!leg) return undefined;
    points.push(...leg.points.slice(1)); from = { ...worker, ...leg.points.at(-1)! };
  }
  return clear(points) ? threatRoadCommands(worker, detour) : undefined;
}

/** An accepted outside order ends the parent even if it equals a rescue move. */
export function recordWorkerCommandOverrides(snapshot: Pick<GameSnapshot, 'tick'>, memory: AiPolicyMemory, commands: readonly GameCommand[]) {
  for (const command of commands) if (changesWorkerAction(command))
    for (const id of commandActors(command)) endWorkerContinuation(snapshot, memory, id, 'external-order');
}
