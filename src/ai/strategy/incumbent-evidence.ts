import type { GameCommand, GameSnapshot, Unit, UnitOrder } from '../../shared/types';
import type { ActionToken, AllocationEvent, IncumbentOrderReceipt, StrategyAllocationMemory } from './allocation-types';
import { matchesAllocationOrder } from './allocation-ledger';
import { incumbentCommandActor, type IncumbentCommandActor } from './incumbent-command-source';
import { STRATEGY_ALLOCATION_LIMITS } from './control';

export const CANDIDATE_SWITCH_WINDOW_THINKS = 8;
export const INCUMBENT_RECEIPT_WAIT_TICKS = 200;

/** Optional native order fields may exist with value undefined. Deliberately
 * omit those fields while rejecting nonfinite data, never JSON-coercing it. */
export function copyNativeOrder(order: Readonly<UnitOrder>): UnitOrder {
  const copy = (value: unknown): unknown => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite native order provenance');
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, copy(entry)]));
    return value;
  };
  return copy(order) as UnitOrder;
}
function advancing(snapshot: GameSnapshot, unit: Unit, receipt: IncumbentOrderReceipt): boolean {
  if (matchesAllocationOrder(receipt.command, unit.order) && unit.order.type !== 'idle') return true;
  if (receipt.command.type === 'board') return unit.deck?.shipId === receipt.command.transportId || unit.cabin?.shipId === receipt.command.transportId;
  if (receipt.command.type === 'build' && unit.order.type === 'repair') {
    const command = receipt.command, buildingId = unit.order.buildingId;
    return snapshot.buildings.some(building => building.id === buildingId && building.owner === unit.owner
      && building.kind === command.buildingKind && Math.hypot(building.x - command.x, building.y - command.y) < 1);
  }
  return false;
}

/** Called only with the runner's final accepted subset. The sidecar identity
 * was attached by the actual producer branch, not inferred from a later claim. */
export function recordIncumbentCommands(memory: StrategyAllocationMemory, snapshot: GameSnapshot, executor: string,
  commands: readonly GameCommand[], nextCommandId: () => string): StrategyAllocationMemory {
  const incumbentOrders = { ...memory.incumbentOrders };
  const owned = new Set(snapshot.units.filter(unit => unit.owner === memory.owner && unit.hp > 0).map(unit => unit.id));
  for (const command of commands) {
    const task = incumbentCommandActor(command);
    if (!task) continue;
    const unitIds = 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
    if (!unitIds.length) continue;
    const commandId = nextCommandId();
    for (const unitId of unitIds) {
      if (!owned.has(unitId)) continue;
      const focused = 'unitIds' in command ? { ...command, unitIds: [unitId] } : command;
      incumbentOrders[unitId] = { unitId, commandId, executor, task: { ...task }, acceptedTick: snapshot.tick,
        command: structuredClone(focused), observedTick: null, observedOrder: null };
    }
  }
  return { ...memory, incumbentOrders };
}

export function observeIncumbentOrders(memory: StrategyAllocationMemory, snapshot: GameSnapshot): StrategyAllocationMemory {
  const incumbentOrders: Record<string, IncumbentOrderReceipt> = {}, units = new Map(snapshot.units.map(unit => [unit.id, unit]));
  for (const [id, receipt] of Object.entries(memory.incumbentOrders)) {
    const unit = units.get(id);
    if (!unit || unit.owner !== memory.owner || unit.hp <= 0) continue;
    if (advancing(snapshot, unit, receipt)) incumbentOrders[id] = { ...receipt, observedTick: snapshot.tick,
      observedOrder: copyNativeOrder(unit.order) };
    // An order which was observed and subsequently changed must never revive
    // from an old receipt. An unobserved delayed command remains uncommitted.
    else if (receipt.observedTick === null && snapshot.tick - receipt.acceptedTick <= INCUMBENT_RECEIPT_WAIT_TICKS)
      incumbentOrders[id] = receipt;
  }
  const candidateSwitches = Object.fromEntries(Object.entries(memory.candidateSwitches).filter(([id, entry]) =>
    units.has(id) && memory.revision - entry.revision <= CANDIDATE_SWITCH_WINDOW_THINKS));
  return { ...memory, incumbentOrders, candidateSwitches };
}

export function incumbentDisposition(snapshot: GameSnapshot, unit: Unit, memory: StrategyAllocationMemory,
  candidateTask: IncumbentCommandActor): 'incumbent' | 'proposed' | 'unknown' {
  const receipt = memory.incumbentOrders[unit.id];
  if (receipt && receipt.task.source === candidateTask.source && receipt.task.taskId === candidateTask.taskId
    && receipt.observedTick === snapshot.tick && receipt.observedOrder !== null && advancing(snapshot, unit, receipt)) return 'incumbent';
  return unit.order.type === 'idle' && !unit.deck && !unit.cabin ? 'proposed' : 'unknown';
}

/** Emit after the old task acknowledges candidate cleanup, in the same
 * transaction as the new grant. This contains no invented displacement price. */
export function recordCandidateReassignment(input: Readonly<{ memory: StrategyAllocationMemory; snapshot: GameSnapshot;
  task: IncumbentCommandActor; unitIds: readonly string[]; objectiveId: string; methodId: string; action: ActionToken }>): StrategyAllocationMemory {
  const { memory, snapshot, task, objectiveId, methodId, action } = input;
  const candidateSwitches = { ...memory.candidateSwitches }, unitIds = [...new Set(input.unitIds)].sort(), repeatedUnitIds: string[] = [];
  for (const unitId of unitIds) {
    const unit = snapshot.units.find(unit => unit.id === unitId && unit.owner === memory.owner);
    if (!unit || incumbentDisposition(snapshot, unit, memory, task) !== 'proposed') throw new Error('Candidate reassignment attempted to bypass an executed or unknown incumbent');
    const prior = candidateSwitches[unitId];
    const repeated = prior && memory.revision > prior.revision && memory.revision - prior.revision <= CANDIDATE_SWITCH_WINDOW_THINKS
      && (prior.diagnosedRevision === null || memory.revision - prior.diagnosedRevision > CANDIDATE_SWITCH_WINDOW_THINKS);
    if (repeated) repeatedUnitIds.push(unitId);
    candidateSwitches[unitId] = { revision: memory.revision, tick: snapshot.tick, fromTaskId: task.taskId,
      toObjectiveId: objectiveId, diagnosedRevision: repeated ? memory.revision : prior?.diagnosedRevision ?? null };
  }
  const event: AllocationEvent = { id: `${memory.owner}:allocation:${memory.nextEventSequence}`, tick: snapshot.tick, revision: memory.revision,
    objectiveId, methodId, action, kind: 'candidate-reassigned', fromTask: { ...task }, unitIds, repeatedUnitIds,
    reason: { code: 'candidate-reassigned', factIds: unitIds,
      values: { windowThinks: CANDIDATE_SWITCH_WINDOW_THINKS, repeatedCount: repeatedUnitIds.length } } };
  const recent = [...memory.events, event];
  const retained = new Set(recent.slice(-STRATEGY_ALLOCATION_LIMITS.recentEvents).map(event => event.id));
  return { ...memory, candidateSwitches, nextEventSequence: memory.nextEventSequence + 1,
    events: recent.filter(event => retained.has(event.id) || event.kind === 'preempted' && event.handoff === 'pending') };
}
