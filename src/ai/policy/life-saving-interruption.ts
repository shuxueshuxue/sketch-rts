import { isBuildPlacementClear } from '../../shared/build-placement';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { GameCommand, GameSnapshot, PlayerId, UnitOrder } from '../../shared/types';
import type { AiPolicyMemory, LifeSavingInterruption } from '../memory';

export function commandActors(command: GameCommand): readonly string[] {
  return 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
}
export function changesUnitAction(command: GameCommand) {
  return ['move', 'attackMove', 'attack', 'holdPosition', 'stop', 'follow', 'build', 'board', 'mine', 'repair', 'repairUnit', 'repairShip', 'garrison', 'cast', 'pickupItem'].includes(command.type);
}
export function interruptionEvent(snapshot: Pick<GameSnapshot, 'tick'>, memory: AiPolicyMemory, unitId: string,
  state: LifeSavingInterruption, kind: NonNullable<AiPolicyMemory['navigationEvents']>[number]['kind'], reason: string, waypointCount = 0) {
  if (memory.navigationEvents?.some(event => event.tick !== snapshot.tick)) memory.navigationEvents = [];
  (memory.navigationEvents ??= []).push({ tick: snapshot.tick, unitId, kind, reason, interruptedBy: state.interruptedBy,
    parent: state.parent, threatIds: [...state.threatIds], waypointCount });
}
export function endLifeSavingInterruption(snapshot: Pick<GameSnapshot, 'tick'>, memory: AiPolicyMemory, unitId: string, reason: string) {
  const claim = memory.unitClaims[unitId], state = claim?.interruption;
  if (!state) return;
  interruptionEvent(snapshot, memory, unitId, state, 'avoidance-end', reason);
  delete claim.interruption;
  delete claim.campTravel;
}

function bound(order: UnitOrder, command: GameCommand) {
  if ((order.type === 'move' || order.type === 'attackMove' || order.type === 'build') && order.type === command.type
    && 'x' in command && Math.hypot(order.x - command.x, order.y - command.y) <= 1)
    return order.type !== 'build' || command.type === 'build' && order.buildingKind === command.buildingKind;
  if (order.type === 'mine' && command.type === 'mine') return order.resourceId === command.resourceId;
  return order.type === 'hold' && command.type === 'holdPosition';
}

/** Before any executor plans: invalidate against the actual order and parent
 * validity. No elapsed-time limit; a rescue remains a vacancy until it can resume. */
export function prepareLifeSavingInterruptions(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
  if (memory.navigationEvents?.some(event => event.tick !== snapshot.tick)) memory.navigationEvents = [];
  for (const [id, claim] of Object.entries(memory.unitClaims)) {
    const state = claim.interruption;
    if (!state) continue;
    const unit = snapshot.units.find(unit => unit.id === id && unit.owner === owner && unit.hp > 0);
    const parent = state.parent;
    const orders = unit ? [unit.order, ...(unit.orderQueue ?? [])].filter(order => order.type !== 'idle') : [];
    if (state.pendingBinding && orders.length && orders.every(order => state.pendingBinding!.some(command => bound(order, command)))) {
      state.binding = [state.parent, ...state.pendingBinding]; delete state.pendingBinding;
      if (state.phase === 'life-saving-interruption' && claim.evacuation) {
        const shelter = state.binding.filter(command => command.type === 'move').at(-1);
        if (shelter?.type === 'move') {
          const { safeResourceId: _oldMine, ...evacuation } = claim.evacuation;
          claim.evacuation = { ...evacuation, shelter: { x: shelter.x, y: shelter.y } };
        }
      }
      interruptionEvent(snapshot, memory, id, state, state.phase === 'resuming' ? 'avoidance-resume' : 'avoidance-stage',
        state.phase === 'resuming' ? 'native-continuation-observed' : 'native-staging-observed',
        state.binding.filter(command => command.type === 'move').length);
    }
    const foundation = snapshot.buildings.find(building => building.owner === owner && building.kind === parent.buildingKind && building.hp > 0
      && Math.hypot(building.x - parent.x, building.y - parent.y) < 40);
    const reason = !unit ? 'unit-unavailable' : foundation ? 'construction-started'
      : state.resourceId && !snapshot.resources.some(mine => mine.id === state.resourceId && mine.amount > 0) ? 'resource-gone'
      : !isBuildPlacementClear(snapshot, parent.buildingKind, parent) ? 'site-occupied'
      : orders.some(order => ![...state.binding, ...(state.pendingBinding ?? [])].some(command => bound(order, command))) ? 'order-replaced' : undefined;
    if (reason) endLifeSavingInterruption(snapshot, memory, id, reason);
  }
}

export function interruptedBuildResource(snapshot: GameSnapshot, parent: LifeSavingInterruption['parent']) {
  if (parent.buildingKind !== 'townHall') return undefined;
  return snapshot.resources.filter(mine => mine.amount > 0 && Math.hypot(mine.x - parent.x, mine.y - parent.y) <= GOLD_MINE_RULES.baseRange)
    .sort((a, b) => Math.hypot(a.x - parent.x, a.y - parent.y) - Math.hypot(b.x - parent.x, b.y - parent.y))[0]?.id;
}

/** Call at an accepted outside-order boundary, including orders identical to
 * the current rescue. Snapshot comparison alone cannot distinguish those. */
export function recordNavigationOverrides(snapshot: Pick<GameSnapshot, 'tick'>, memory: AiPolicyMemory, commands: readonly GameCommand[]) {
  for (const command of commands) if (changesUnitAction(command)) for (const id of commandActors(command)) {
    endLifeSavingInterruption(snapshot, memory, id, 'external-order');
    const claim = memory.unitClaims[id];
    if (claim?.kind === 'campTravel' && !claim.expansionMineId) delete memory.unitClaims[id];
    else if (claim) {
      delete claim.campTravel;
      if (claim.kind === 'campTravel' && claim.expansionMineId) { claim.kind = 'expansionMission'; claim.targetId = claim.expansionMineId; }
    }
  }
}
