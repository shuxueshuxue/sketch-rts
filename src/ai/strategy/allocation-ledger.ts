import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import type { GameCommand, GameSnapshot, Unit, UnitOrder } from '../../shared/types';
import { purchaseCost } from '../policy/script-runner';
import type { ActionToken, AllocationBudget, AllocationPayment, AllocationUnmetDemand, CommandAdmission,
  ExecutableMethod, ExecutionAction, IssuedActionCommand, StrategyAllocationMemory } from './allocation-types';
import { sameAction } from './control';
import { recordGoalTrainingAdmissions } from './goal-training-ledger';

/** The old runner and formal admission share the catalog prices. Building
 * upgrades also spend capital although the old economy does not track them. */
export function allocationCommandCost(snapshot: GameSnapshot, owner: string, command: GameCommand): number {
  return command.type === 'upgradeBuilding' ? BUILDING_DEFS[command.to].cost : purchaseCost(snapshot, owner, command);
}
const outstanding = (budget: AllocationBudget) => budget.state === 'reserved' ? budget.amountGold - budget.paidGold : 0;
export function reservedAllocationGold(memory: StrategyAllocationMemory, forObjectiveId?: string): number {
  return Object.values(memory.budgets).reduce((sum, budget) => sum + (budget.plannedGold !== undefined
    && budget.objectiveId === forObjectiveId ? 0 : outstanding(budget)), 0);
}

/** An admitted chain saves real incoming cash, including thinks where new
 * geometry is pending. Future income never becomes an actual cash balance. */
export function refreshAllocationCapital(memory: StrategyAllocationMemory, cashGold: number, tick: number): StrategyAllocationMemory {
  if (!Number.isFinite(cashGold) || cashGold < 0) throw Error('Invalid allocation cash');
  const budgets = { ...memory.budgets };
  for (const budget of Object.values(budgets)) if (budget.plannedGold !== undefined && budget.state === 'reserved'
    && ['complete', 'failed', 'abandoned'].includes(memory.objectives[budget.objectiveId]?.status ?? 'abandoned'))
    budgets[budget.id] = { ...budget, state: 'released', releasedTick: tick };
  const adjustable = Object.values(budgets).filter(budget => {
    if (budget.plannedGold === undefined || budget.state !== 'reserved') return false;
    const purchase = memory.methods[budget.methodId]?.actions.find(action => action.id === budget.action.actionId);
    // A future hall can be attached to an earlier training action for saving;
    // that action's unrelated purchase does not issue the hall's own spend.
    const issued = (!purchase || purchase.spendIds.includes(budget.spendId))
      && Object.values(memory.issuedCommands).some(command => sameAction(command.action, budget.action)
        && ['build', 'train'].includes(command.command.type));
    return !issued;
  })
    .sort((a, b) => (a.expectedPaymentTick ?? Infinity) - (b.expectedPaymentTick ?? Infinity) || a.id.localeCompare(b.id));
  const adjustableIds = new Set(adjustable.map(budget => budget.id));
  // An issued native purchase may already have spent the cash before its ACK
  // arrives. Keep that budget intact so its real payment can still be proved.
  const protectedGold = Object.values(budgets).reduce((sum, budget) => sum + (adjustableIds.has(budget.id) ? 0 : outstanding(budget)), 0);
  let free = Math.max(0, cashGold - protectedGold);
  // Preserve existing claims first; cash loss trims the later payment claims
  // before earlier ones. This does not reshuffle saved cash on unchanged input.
  for (const budget of adjustable) {
    const held = Math.min(free, Math.max(0, budget.amountGold - budget.paidGold), Math.max(0, budget.plannedGold! - budget.paidGold));
    budgets[budget.id] = { ...budget, amountGold: budget.paidGold + held }; free -= held;
  }
  for (const original of adjustable) {
    const budget = budgets[original.id]!;
    const added = Math.min(free, Math.max(0, budget.plannedGold! - budget.amountGold));
    budgets[budget.id] = { ...budget, amountGold: budget.amountGold + added }; free -= added;
  }
  return { ...memory, budgets };
}

/** A selected plan that ended cannot retain a saving claim. Real issued
 * purchases keep their receipt lineage until payment acknowledgement. */
export function releaseEndedGoalCapital(memory: StrategyAllocationMemory,
  plans: readonly Readonly<{ goal: { id: string }; status: string }>[], tick: number): StrategyAllocationMemory {
  const ended = new Set(plans.filter(plan => plan.status === 'complete').map(plan => plan.goal.id));
  const budgets = Object.fromEntries(Object.entries(memory.budgets).map(([id, budget]) => [id,
    budget.plannedGold !== undefined && budget.state === 'reserved' && ended.has(budget.objectiveId)
      && !Object.values(memory.issuedCommands).some(command => sameAction(command.action, budget.action)
        && ['build', 'train'].includes(command.command.type))
      ? { ...budget, state: 'released' as const, releasedTick: tick } : budget]));
  return { ...memory, budgets };
}

/** Runnable purchases reserve first. An admitted plan also saves later capital
 * from remaining actual cash without gating affordable earlier actions. */
export function reserveAllocationSpends(input: Readonly<{ memory: StrategyAllocationMemory; method: ExecutableMethod;
  actions: readonly ExecutionAction[]; cashGold: number; tick: number }>) {
  const { memory, method, actions, cashGold, tick } = input;
  if (!Number.isFinite(cashGold) || cashGold < 0) throw new Error('Invalid allocation cash');
  const registry = new Map(method.spends.map(spend => [spend.spendId, spend]));
  if (registry.size !== method.spends.length) throw new Error('Duplicate allocation spend id');
  const budgets = { ...memory.budgets }, unmet: AllocationUnmetDemand[] = [];
  if (method.kind === 'goal-plan') for (const budget of Object.values(budgets))
    if (budget.objectiveId === method.objectiveId && budget.plannedGold !== undefined && budget.state === 'reserved'
      && !registry.has(budget.spendId) && !budget.nativePayments?.length)
      budgets[budget.id] = { ...budget, state: 'released', releasedTick: tick };
  let free = Math.max(0, cashGold - reservedAllocationGold({ ...memory, budgets }));
  const referred = new Set<string>();
  const reserve = (spendId: string, action: ExecutionAction, future: boolean) => {
      const spend = registry.get(spendId)!;
      const id = `budget:${spendId}`, old = budgets[id];
      if (old && old.state !== 'released' && old.objectiveId !== method.objectiveId
        && !(old.plannedGold !== undefined && spend.expectedPaymentTick !== undefined && !future && old.paidGold === 0
          && !Object.values(memory.issuedCommands).some(command => sameAction(command.action, old.action)
            && ['build', 'train'].includes(command.command.type)))) {
        if (!future) unmet.push({ id: `${action.token.actionId}/spend-owner:${spendId}`, objectiveId: method.objectiveId,
          methodId: method.id, action: action.token, demand: { kind: 'gold', amount: spend.amountGold },
          reason: { code: 'capital-already-owned-by-an-alternative', factIds: [id], values: {} } });
        return;
      }
      const paid = old?.paidGold ?? 0;
      if (paid > spend.amountGold) throw new Error('Allocation spend decreased below its real payment');
      const held = old?.state === 'reserved' ? old.amountGold - paid : 0;
      const added = Math.min(free, Math.max(0, spend.amountGold - paid - held)); free -= added;
      const amountGold = paid + held + added;
      budgets[id] = { id, spendId, objectiveId: method.objectiveId, methodId: method.id, action: action.token,
        amountGold, paidGold: paid, state: paid >= spend.amountGold ? 'spent' : 'reserved', sinceTick: old?.sinceTick ?? tick,
        ...(old?.nativePayments ? { nativePayments: old.nativePayments } : {}),
        ...(spend.expectedPaymentTick === undefined ? {} : { plannedGold: spend.amountGold, expectedPaymentTick: spend.expectedPaymentTick }),
        releasedTick: null, includedUtilityTermCodes: [...spend.includedUtilityTermCodes], externalReservationIds: [...spend.externalReservationIds] };
      if (!future && amountGold < spend.amountGold) unmet.push({ id: `${action.token.actionId}/capital:${spendId}`, objectiveId: method.objectiveId,
        methodId: method.id, action: action.token, demand: { kind: 'gold', amount: spend.amountGold - amountGold },
        reason: { code: 'current-stage-awaits-income', factIds: [spendId], values: { heldGold: amountGold, requiredGold: spend.amountGold } } });
  };
  for (const plan of method.actions) {
    const action = actions.find(action => action.token.actionId === plan.id);
    for (const spendId of plan.spendIds) {
      const spend = registry.get(spendId);
      if (!spend) throw new Error(`Unregistered allocation spend ${spendId}`);
      if (!Number.isFinite(spend.amountGold) || spend.amountGold < 0) throw new Error('Invalid allocation spend');
      if (referred.has(spendId)) continue;
      if (!action || !['ready', 'active', 'blocked'].includes(action.status)) continue;
      referred.add(spendId);
      reserve(spendId, action, false);
    }
  }
  if (method.kind === 'goal-plan') {
    const parent = method.actions.map(plan => actions.find(action => action.token.actionId === plan.id))
      .find(action => action && ['ready', 'active', 'blocked', 'complete'].includes(action.status));
    if (parent) for (const spend of method.spends) if (spend.expectedPaymentTick !== undefined && !referred.has(spend.spendId)) {
      if (!Number.isFinite(spend.amountGold) || spend.amountGold < 0 || !Number.isFinite(spend.expectedPaymentTick)) throw Error('Invalid planned capital');
      reserve(spend.spendId, parent, true);
    }
  }
  return { memory: { ...memory, budgets }, unmet };
}

/** Capture a narrow real-world baseline once, when the common gateway admits
 * the command. Neither a predicted queue nor an accepted proposal is a receipt. */
export function issuedCommandBaseline(snapshot: GameSnapshot, command: GameCommand): IssuedActionCommand['worldBefore'] {
  if (command.type === 'train') {
    const yard = snapshot.buildings.find(building => building.id === command.buildingId);
    return { kind: 'production', buildingId: command.buildingId,
      jobs: (yard?.queue ?? []).map(job => ({ id: job.id ?? null, unitKind: 'unitKind' in job ? job.unitKind : null })) };
  }
  if (command.type === 'build') return { kind: 'construction', buildingIds: snapshot.buildings.filter(building =>
    Math.hypot(building.x - command.x, building.y - command.y) <= building.radius + 64).map(building => building.id).sort() };
  return undefined;
}

export function recordAllocationCommands(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  admissions: readonly CommandAdmission[]): StrategyAllocationMemory {
  const issuedCommands = { ...memory.issuedCommands }, issuedOrders = { ...memory.issuedOrders };
  for (const admission of admissions) {
    if (admission.status !== 'accepted' || admission.source !== 'executor' || !admission.action) continue;
    const prior = issuedCommands[admission.commandId];
    if (prior) {
      if (JSON.stringify(prior.command) !== JSON.stringify(admission.command) || !sameAction(prior.action, admission.action))
        throw new Error('Allocation command id reused for different intent');
      continue;
    }
    const baseline = issuedCommandBaseline(snapshot, admission.command);
    const command: IssuedActionCommand = { id: admission.commandId, action: admission.action, executor: admission.executor,
      purpose: admission.purpose, acceptedTick: snapshot.tick, command: structuredClone(admission.command), ...(baseline ? { worldBefore: baseline } : {}) };
    issuedCommands[command.id] = command;
    const unitIds = commandSetsNativeOrder(admission.command)
      ? 'unitIds' in admission.command ? admission.command.unitIds : 'unitId' in admission.command ? [admission.command.unitId] : [] : [];
    for (const unitId of unitIds) issuedOrders[unitId] = { commandId: command.id, action: command.action, executor: command.executor,
      purpose: command.purpose, unitId, acceptedTick: snapshot.tick, observedTick: null, observedOrder: null };
  }
  return recordGoalTrainingAdmissions({ ...memory, issuedCommands, issuedOrders }, snapshot, admissions);
}

/** A receipt is idempotent and tied to the real parent command and native
 * entity. No planned or inferred price can turn into a paid budget entry. */
export function applyAllocationPayments(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  action: ActionToken, payments: readonly AllocationPayment[]): StrategyAllocationMemory {
  const budgets = { ...memory.budgets };
  for (const receipt of payments) {
    const budget = budgets[receipt.budgetId], proof = receipt.proof;
    if (!budget || !sameAction(budget.action, action)) throw new Error('Allocation payment has no admitted parent');
    const declarative = memory.executions[action.actionId]?.intent.kind === 'goal-action';
    const entityId = proof.kind === 'production' ? proof.jobId : proof.buildingId;
    const recorded = declarative && budget.nativePayments?.find(payment => payment.commandId === proof.acceptedCommandId
      && payment.kind === proof.kind && payment.entityId === entityId);
    if (recorded) {
      if (recorded.amountGold !== receipt.amountGold) throw new Error('Allocation payment changed after acknowledgement');
      continue;
    }
    if (!declarative && budget.paidGold > 0) {
      if (budget.paidGold !== receipt.amountGold) throw new Error('Allocation payment changed after acknowledgement');
      continue;
    }
    const command = memory.issuedCommands[proof.acceptedCommandId];
    if (!command || !sameAction(command.action, action)
      || command.executor !== memory.executions[action.actionId]?.executor) throw new Error('Allocation payment has no admitted parent');
    if (declarative && (entityId === null || Object.values(budgets).some(other => other.nativePayments
      ?.some(payment => payment.commandId === command.id)))) throw new Error('Native command payment identity reused');
    let price: number | undefined;
    if (proof.kind === 'production' && command.command.type === 'train' && command.worldBefore?.kind === 'production') {
      const queue = snapshot.buildings.find(building => building.id === proof.buildingId && building.owner === memory.owner)?.queue;
      const job = queue?.[proof.queueIndex], before = command.worldBefore.jobs;
      const identity = proof.jobId === null ? proof.queueIndex >= before.length && (queue?.length ?? 0) > before.length
        : !before.some(job => job.id === proof.jobId);
      if (identity && proof.buildingId === command.command.buildingId && command.worldBefore.buildingId === proof.buildingId
        && proof.unitKind === command.command.unitKind && job && 'unitKind' in job && job.unitKind === proof.unitKind
        && (job.id ?? null) === proof.jobId) price = job.paidGold ?? UNIT_DEFS[job.unitKind].cost;
    } else if (proof.kind === 'foundation' && command.command.type === 'build' && command.worldBefore?.kind === 'construction') {
      const building = snapshot.buildings.find(building => building.id === proof.buildingId && building.owner === memory.owner);
      if (building && building.kind === command.command.buildingKind && !command.worldBefore.buildingIds.includes(building.id)
        && Math.hypot(building.x - command.command.x, building.y - command.command.y) < 1) price = BUILDING_DEFS[building.kind].cost;
    }
    const paidGold = (declarative ? budget.paidGold : 0) + receipt.amountGold;
    if (price === undefined || !Number.isFinite(receipt.amountGold) || receipt.amountGold !== price
      || paidGold > budget.amountGold) throw new Error('Allocation payment is not proven by the native world');
    budgets[budget.id] = { ...budget, paidGold, state: !declarative || paidGold >= budget.amountGold ? 'spent' : 'reserved',
      ...(declarative ? { nativePayments: [...(budget.nativePayments ?? []), { kind: proof.kind,
        commandId: command.id, entityId: entityId!, amountGold: receipt.amountGold, observedTick: snapshot.tick }] } : {}) };
  }
  return { ...memory, budgets };
}

/** Actual native orders are copied only when their semantic target matches the
 * admitted command. A changed/player order cannot inherit an executor's issuer. */
export function matchesAllocationOrder(command: GameCommand, order: UnitOrder): boolean {
  if (command.type === 'move' || command.type === 'attackMove' || command.type === 'unload' || command.type === 'aim')
    return order.type === command.type && order.x === command.x && order.y === command.y;
  if (command.type === 'attack' || command.type === 'follow') return order.type === command.type && order.targetId === command.targetId;
  if (command.type === 'repairShip' || command.type === 'repairUnit' || command.type === 'boardShip')
    return order.type === command.type && order.targetId === command.targetId;
  if (command.type === 'board') return order.type === 'board' && order.transportId === command.transportId;
  if (command.type === 'mine') return order.type === 'mine' && order.resourceId === command.resourceId;
  if (command.type === 'build') return order.type === 'build' && order.buildingKind === command.buildingKind && order.x === command.x && order.y === command.y;
  if (command.type === 'repair' || command.type === 'garrison') return order.type === command.type && order.buildingId === command.buildingId;
  if (command.type === 'holdPosition') return order.type === 'hold';
  if (command.type === 'stop') return order.type === 'idle';
  if (command.type === 'pickupItem') return order.type === 'pickupItem' && order.itemId === command.itemId;
  if (command.type === 'cast') return (order.type === 'cast' || order.type === 'charge')
    && order.targetId === command.targetId && (order.type === 'charge' || order.ability === command.ability
      && order.x === command.x && order.y === command.y);
  return false;
}

/** Native transitions may replace board by a deck relation and build by repair
 * of the new foundation. These are observed task progress, not a new issuer. */
export function advancesAllocationCommand(snapshot: GameSnapshot, unit: Unit, command: GameCommand): boolean {
  if (matchesAllocationOrder(command, unit.order) && unit.order.type !== 'idle') return true;
  if (command.type === 'board') return unit.deck?.shipId === command.transportId || unit.cabin?.shipId === command.transportId;
  if (command.type === 'build' && unit.order.type === 'repair') {
    const id = unit.order.buildingId;
    return snapshot.buildings.some(building => building.id === id && building.owner === unit.owner
      && building.kind === command.buildingKind && Math.hypot(building.x - command.x, building.y - command.y) < 1);
  }
  return false;
}

/** Stance/autocast/equipment and instant skills do not replace a native order.
 * Recording them as its issuer would destroy the actual parent lineage. */
export function commandSetsNativeOrder(command: GameCommand): boolean {
  return ['move', 'attackMove', 'attack', 'follow', 'stop', 'holdPosition', 'aim', 'mine',
    'repair', 'repairUnit', 'repairShip', 'build', 'garrison', 'board', 'boardShip', 'unload', 'pickupItem', 'cast'].includes(command.type);
}
