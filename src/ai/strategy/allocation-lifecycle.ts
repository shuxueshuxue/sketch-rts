import type { GameSnapshot } from '../../shared/types';
import type { ActionGrant, ActionToken, AllocationEvent, AllocationReason, ExecutionAction,
  ExecutorFeedback, StrategyAllocationMemory } from './allocation-types';
import { advancesAllocationCommand, applyAllocationPayments } from './allocation-ledger';
import { assertStrategyAllocationBounds, sameAction, STRATEGY_ALLOCATION_LIMITS } from './control';
import { copyNativeOrder, INCUMBENT_RECEIPT_WAIT_TICKS } from './incumbent-evidence';

/** Acceptance is not movement. Refresh lineage from the current native world
 * before safety services or assignment-stage accounting consume it. */
export function observeAllocationOrders(memory: StrategyAllocationMemory, snapshot: GameSnapshot): StrategyAllocationMemory {
  const units = new Map(snapshot.units.filter(unit => unit.owner === memory.owner && unit.hp > 0).map(unit => [unit.id, unit]));
  const issuedOrders: Record<string, StrategyAllocationMemory['issuedOrders'][string]> = {};
  for (const [id, order] of Object.entries(memory.issuedOrders)) {
    const unit = units.get(id), command = memory.issuedCommands[order.commandId], action = memory.executions[order.action.actionId];
    if (!unit || !command || !action || !sameAction(command.action, order.action) || !sameAction(action.token, order.action)) continue;
    if (advancesAllocationCommand(snapshot, unit, command.command)) issuedOrders[id] = { ...order,
      observedTick: snapshot.tick, observedOrder: copyNativeOrder(unit.order) };
    else if (order.observedTick === null && snapshot.tick - order.acceptedTick <= INCUMBENT_RECEIPT_WAIT_TICKS) issuedOrders[id] = order;
  }
  return { ...memory, issuedOrders };
}

const terminal = (status: ExecutionAction['status']) => ['complete', 'failed', 'abandoned'].includes(status);
/** Required unloads are an observed milestone. Optional voyages retain their
 * action and leases while successors may use the cohort already on shore. */
export function actionDependencySatisfied(action: ExecutionAction): boolean {
  return action.status === 'complete' || action.status === 'active'
    && ['deliver-force', 'deliver-workers'].includes(action.intent.kind)
    && action.state.requiredWaveComplete === true;
}
const orderIds = <T extends { id: string }>(items: T[]) => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
type NewEvent<Event = AllocationEvent> = Event extends AllocationEvent ? Omit<Event, 'id' | 'tick' | 'revision'> : never;

/** Recent diagnostics may expire; an unacknowledged resource handoff cannot.
 * All retained entries are standalone values, never a previous-memory chain. */
export function retainAllocationEvents(events: readonly AllocationEvent[]): AllocationEvent[] {
  const recent = new Set(events.slice(-STRATEGY_ALLOCATION_LIMITS.recentEvents).map(event => event.id));
  return events.filter(event => recent.has(event.id) || event.kind === 'preempted' && event.handoff === 'pending');
}

export function appendAllocationEvent(memory: StrategyAllocationMemory,
  event: NewEvent, tick: number): StrategyAllocationMemory {
  const complete = { ...event, id: `${memory.owner}:allocation:${memory.nextEventSequence}`,
    tick, revision: memory.revision } as AllocationEvent;
  return { ...memory, nextEventSequence: memory.nextEventSequence + 1,
    events: retainAllocationEvents([...memory.events, complete]) };
}

/** Promote dependencies together, with cycle/missing-parent faults instead of
 * making a permanently waiting action appear to be a viable plan. */
export function advanceAllocationGraph(memory: StrategyAllocationMemory): StrategyAllocationMemory {
  const executions = { ...memory.executions }, active = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    const action = executions[id];
    if (!action) throw new Error(`Missing allocation action ${id}`);
    if (active.has(id)) throw new Error(`Cyclic allocation action ${id}`);
    active.add(id);
    for (const parentId of action.dependsOn) visit(parentId);
    active.delete(id); done.add(id);
    if (action.status !== 'waiting') return;
    const parents = action.dependsOn.map(id => executions[id]!);
    const invalid = parents.some(parent => parent.status === 'failed' || parent.status === 'abandoned');
    if (invalid || parents.every(actionDependencySatisfied)) executions[id] = {
      ...action, status: invalid ? 'abandoned' : 'ready', phase: invalid ? 'dependency-invalidated' : action.phase,
    };
  };
  for (const id of Object.keys(executions).sort()) visit(id);
  return { ...memory, executions };
}

/** Reconstruct grants solely from the serializable authority. No provider or
 * explanation cache participates, so restored workers see identical grants. */
export function allocationGrants(memory: StrategyAllocationMemory): ActionGrant[] {
  return Object.values(memory.executions).filter(action => ['ready', 'active', 'blocked'].includes(action.status))
    .sort((a, b) => a.token.actionId < b.token.actionId ? -1 : a.token.actionId > b.token.actionId ? 1 : 0)
    .map(execution => {
      const token = execution.token;
      const preemptions = memory.events.filter(event => event.kind === 'preempted' && event.handoff !== 'pending'
        && event.quotation.toObjectiveId === execution.objectiveId);
      const leases = orderIds(Object.values(memory.leases).filter(lease => sameAction(lease.action, token)));
      return { revision: memory.revision, action: token, objectiveId: execution.objectiveId, methodId: execution.methodId,
        leases, assignments: orderIds(Object.values(memory.assignments).filter(assignment => sameAction(assignment.action, token))),
        budgets: orderIds(Object.values(memory.budgets).filter(budget => sameAction(budget.action, token) && budget.state !== 'released')),
        voyages: orderIds(Object.values(memory.voyages).filter(voyage => sameAction(voyage.action, token))),
        orders: Object.values(memory.issuedOrders).filter(order => sameAction(order.action, token)).sort((a, b) => a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0),
        commands: orderIds(Object.values(memory.issuedCommands).filter(command => sameAction(command.action, token))),
        orderOverrides: leases.flatMap(lease => lease.resourceKey.startsWith('unit:') ? preemptions.flatMap(event =>
          event.kind === 'preempted' && event.quotation.resourceKeys.includes(lease.resourceKey) ? [{ unitId: lease.resourceKey.slice(5),
            preemptionEventId: event.id, previousCommandId: memory.incumbentOrders[lease.resourceKey.slice(5)]?.commandId ?? null }] : []) : []),
      };
    });
}

/** Apply observations, not promises. Admission and actual world payments remain
 * separate transactions. Lifesaving quotes preserve the parent lease. */
export function applyExecutorFeedback(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  feedback: ExecutorFeedback): StrategyAllocationMemory {
  const execution = memory.executions[feedback.action.actionId];
  if (!execution || !sameAction(execution.token, feedback.action) || feedback.allocationRevision !== memory.revision)
    throw new Error('Stale allocation executor feedback');
  if (terminal(execution.status)) throw new Error('Feedback attempted to restart a terminal allocation action');
  const pending = Array.isArray(feedback.state.pendingVoyageIds) ? feedback.state.pendingVoyageIds : [];
  const continuing = feedback.status === 'complete' && pending.length > 0;
  if (continuing && (!['deliver-force', 'deliver-workers'].includes(execution.intent.kind)
    || pending.some(id => typeof id !== 'string' || !memory.voyages[id] || !sameAction(memory.voyages[id]!.action, execution.token))))
    throw new Error('Allocation continuation has an ungranted voyage');
  const nextStatus = continuing ? 'active' as const : feedback.status;
  const state = continuing ? { ...feedback.state, requiredWaveComplete: true } : feedback.state;
  let next = applyAllocationPayments(memory, snapshot, execution.token, feedback.payments ?? []);
  const previousProgress = feedback.progress.length ? snapshot.tick : execution.lastProgressTick;
  next = { ...next, executions: { ...next.executions, [execution.token.actionId]: { ...execution,
    status: nextStatus, phase: continuing ? 'continuing-voyages' : feedback.phase, state: structuredClone(state), lastProgressTick: previousProgress } } };
  for (const progress of feedback.progress) {
    if (progress.basis !== 'observed-world') throw new Error('Unobserved allocation progress');
    next = appendAllocationEvent(next, { objectiveId: execution.objectiveId, methodId: execution.methodId, action: execution.token,
      kind: 'progress', progress: progress.kind, unitIds: [...progress.unitIds], entityIds: [...progress.entityIds],
      reason: { code: 'observed-world-progress', factIds: [...progress.unitIds, ...progress.entityIds], values: {} } }, snapshot.tick);
  }
  for (const quote of feedback.blocked) {
    if (!sameAction(quote.parent, execution.token) || quote.objectiveId !== execution.objectiveId || quote.methodId !== execution.methodId)
      throw new Error('Safety quote has a different allocation parent');
    const assignment = Object.values(next.assignments).find(assignment => assignment.unitId === quote.interruptedUnitId
      && sameAction(assignment.action, execution.token));
    const order = next.issuedOrders[quote.interruptedUnitId];
    if (!assignment || !order || order.commandId !== quote.interruptedCommandId || order.executor !== quote.interruptedExecutor
      || !sameAction(order.action, execution.token) || order.observedOrder === null)
      throw new Error('Safety quote has no actual admitted parent order');
    const vacancyId = `vacancy:${assignment.id}:${execution.token.generation}`;
    const method = next.methods[execution.methodId], action = method?.actions.find(action => action.id === execution.token.actionId);
    const demand = action?.demands.find(demand => demand.kind === 'workers' || demand.kind === 'force');
    if (!demand) throw new Error('Safety interruption has no resource demand');
    const missing = demand.kind === 'workers' ? { ...demand, count: 1 } : demand;
    const reason: AllocationReason = { code: 'life-saving-interruption', factIds: [quote.interruptedUnitId, quote.id], values: {} };
    const resumeStage = assignment.interruption?.resumeStage ?? assignment.stage;
    next = { ...next, blocked: { ...next.blocked, [quote.id]: structuredClone(quote) },
      assignments: { ...next.assignments, [assignment.id]: { ...assignment, interruption: {
        kind: 'worker-safety', executor: feedback.reasons[0]?.executor ?? 'worker-safety', sinceTick: snapshot.tick, resumeStage, vacancyId } } },
      vacancies: { ...next.vacancies, [vacancyId]: { id: vacancyId, objectiveId: execution.objectiveId, action: execution.token,
        assignmentId: assignment.id, sinceTick: next.vacancies[vacancyId]?.sinceTick ?? snapshot.tick,
        demand: missing, replacementAssignmentIds: [], reason } } };
    next = appendAllocationEvent(next, { objectiveId: execution.objectiveId, methodId: execution.methodId, action: execution.token,
      kind: 'action-blocked', quoteId: quote.id, reason }, snapshot.tick);
    if (!assignment.interruption) next = appendAllocationEvent(next, {
      objectiveId: execution.objectiveId, methodId: execution.methodId, action: execution.token,
      kind: 'interrupted', assignmentId: assignment.id, vacancyId, reason }, snapshot.tick);
  }
  if (terminal(nextStatus)) next = appendAllocationEvent(next, { objectiveId: execution.objectiveId,
    methodId: execution.methodId, action: execution.token, kind: 'action-finished', outcome: feedback.status as 'complete' | 'failed' | 'abandoned',
    reason: { code: feedback.reasons[0]?.reason ?? `action-${feedback.status}`, factIds: [], values: {} } }, snapshot.tick);
  assertStrategyAllocationBounds(next);
  return next;
}

/** Drop acknowledged provenance only after its last active reference ends.
 * Unacknowledged payments/blocked parents stay reachable; limits fail loudly. */
export function pruneAllocationProvenance(memory: StrategyAllocationMemory): StrategyAllocationMemory {
  const live = (token: ActionToken) => {
    const execution = memory.executions[token.actionId];
    return !!execution && sameAction(execution.token, token) && !terminal(execution.status);
  };
  const blocked = Object.fromEntries(Object.entries(memory.blocked).filter(([, quote]) => live(quote.parent)));
  const protectedCommands = new Set(Object.values(blocked).map(quote => quote.interruptedCommandId));
  const issuedOrders = Object.fromEntries(Object.entries(memory.issuedOrders).filter(([, order]) => live(order.action)
    || protectedCommands.has(order.commandId)));
  for (const order of Object.values(issuedOrders)) protectedCommands.add(order.commandId);
  const protectState = (value: unknown): void => {
    if (typeof value === 'string') { if (memory.issuedCommands[value]) protectedCommands.add(value); return; }
    if (value && typeof value === 'object') for (const child of Object.values(value)) protectState(child);
  };
  for (const execution of Object.values(memory.executions)) if (live(execution.token)) protectState(execution.state);
  const latest = new Map<string, typeof memory.issuedCommands[string]>();
  for (const command of Object.values(memory.issuedCommands)) if (live(command.action)) {
    const key = `${command.action.actionId}:${command.action.generation}:${command.command.type}`;
    const before = latest.get(key);
    if (!before || command.acceptedTick > before.acceptedTick || command.acceptedTick === before.acceptedTick && command.id > before.id)
      latest.set(key, command);
  }
  for (const command of latest.values()) protectedCommands.add(command.id);
  const issuedCommands = Object.fromEntries(Object.entries(memory.issuedCommands).filter(([id, command]) => protectedCommands.has(id)
    ));
  const next = { ...memory, blocked, issuedOrders, issuedCommands, events: retainAllocationEvents(memory.events) };
  assertStrategyAllocationBounds(next);
  return next;
}
