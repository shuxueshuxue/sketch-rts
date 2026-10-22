import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import type { ActionGrant, ActionToken, CommandAdmission, ExclusiveResourceKey, StrategyAllocationMemory } from './allocation-types';
import { sameAction } from './control';
import { incumbentCommandActor, inheritIncumbentCommand } from './incumbent-command-source';
import { allocationCommandCost, reservedAllocationGold } from './allocation-ledger';
import { isLifeSavingScript, safetyCommandReplacesOrder } from './script-safety';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { Target } from './types';

export type StrategyCommandProposal = Readonly<{
  id: string;
  source: 'script' | 'executor';
  executor: string;
  action: ActionToken | null;
  allocationRevision: number | null;
  purpose: 'task' | 'life-saving';
  /** A service may interrupt only the actual order of this same parent. */
  interruptedCommandId?: string;
  command: GameCommand;
}>;
export type GatewayAdmission = CommandAdmission;

type Operands = { units: string[]; queues: string[]; dependencies: ExclusiveResourceKey[] };
function operands(snapshot: GameSnapshot, command: GameCommand): Operands {
  const units = 'unitIds' in command ? [...command.unitIds] : 'unitId' in command ? [command.unitId] : [];
  const queues = 'buildingIds' in command ? command.buildingIds
    : ['train', 'research', 'upgradeBuilding', 'cancelTraining', 'setRally', 'ungarrison', 'buyShipEquipment'].includes(command.type)
      && 'buildingId' in command ? [command.buildingId] : [];
  const dependencies: ExclusiveResourceKey[] = [];
  if (command.type === 'board') dependencies.push(`unit:${command.transportId}`);
  if (command.type === 'unload') for (const ship of snapshot.units.filter(unit => command.unitIds.includes(unit.id)))
    for (const passenger of snapshot.units.filter(unit => unit.deck?.shipId === ship.id || unit.cabin?.shipId === ship.id))
      dependencies.push(`unit:${passenger.id}`);
  if ((command.type === 'buy' || command.type === 'buyShipEquipment') && command.recipientId)
    dependencies.push(`unit:${command.recipientId}`);
  if (command.type === 'giveItem') dependencies.push(`unit:${command.targetId}`);
  if (command.type === 'unloadPassenger') units.push(command.transportId, command.passengerId);
  if (command.type === 'ungarrison') units.push(...snapshot.units.filter(unit => unit.garrison?.buildingId === command.buildingId).map(unit => unit.id));
  if (command.type === 'transferItem') {
    const item = snapshot.items.find(item => item.id === command.itemId);
    if (item?.carrierId) units.push(item.carrierId);
    if (item?.shipId) units.push(item.shipId);
    units.push('unitId' in command.destination ? command.destination.unitId : command.destination.shipId);
    if ('installerId' in command.destination && command.destination.installerId) units.push(command.destination.installerId);
  }
  return { units, queues, dependencies };
}

/** A transaction-local gateway. Formal grants are exclusive; imported tasks
 * retain the original producer's native authority. Local rescue services can
 * interrupt either without changing the parent. Native legality is not copied. */
type StrategyGatewayInput = Readonly<{ snapshot: GameSnapshot; owner: PlayerId;
  memory: StrategyAllocationMemory; grants: readonly ActionGrant[]; queuedTick: number | null;
  managedExpansionSites?: readonly Target[];
  /** Controlled strategic producers may continue their actual task, but may
   * not recruit an unleased unit or start another ungranted mission. */
  incumbentOnlyScripts?: ReadonlySet<string> }>;
export function createStrategyCommandGateway(input: StrategyGatewayInput) {
  const { snapshot, owner, memory, grants, queuedTick } = input;
  const units = new Map(snapshot.units.flatMap(unit => [unit, ...(unit.cargo ?? [])]).map(unit => [unit.id, unit]));
  const buildings = new Map(snapshot.buildings.map(building => [building.id, building]));
  const events = new Map(memory.events.map(event => [event.id, event]));
  const formalTakeover = Object.values(memory.leases).some(lease => lease.origin === 'allocator');
  const grantFor = (proposal: StrategyCommandProposal) => proposal.source === 'executor' && proposal.action
    && proposal.allocationRevision === memory.revision
    ? grants.find(grant => grant.revision === memory.revision && sameAction(grant.action, proposal.action!)) : undefined;
  const allows = (key: ExclusiveResourceKey, proposal: StrategyCommandProposal) => {
    const lease = memory.leases[key];
    if (proposal.source === 'script' && proposal.purpose === 'life-saving' && isLifeSavingScript(proposal.executor)) return true;
    const actor = incumbentCommandActor(proposal.command);
    const importedOwner = lease?.origin === 'imported-task' && (memory.executions[lease.action.actionId]?.executor === proposal.executor
      || actor && lease.incumbentTask?.source === actor.source && lease.incumbentTask.taskId === actor.taskId);
    const continuingOwner = lease?.origin === 'imported-task' && (actor
      ? lease.incumbentTask?.source === actor.source && lease.incumbentTask.taskId === actor.taskId
      : memory.executions[lease.action.actionId]?.executor === proposal.executor);
    if (proposal.source === 'script') return input.incumbentOnlyScripts?.has(proposal.executor) ? !!continuingOwner
      : !lease || !!importedOwner || !formalTakeover && lease.origin === 'imported-task';
    const grant = grantFor(proposal), action = proposal.action && memory.executions[proposal.action.actionId];
    const order = key.startsWith('unit:') ? memory.issuedOrders[key.slice(5)] : undefined;
    const service = proposal.purpose === 'life-saving' && order?.observedTick === snapshot.tick
      && order.observedOrder !== null && order.commandId === proposal.interruptedCommandId
      && proposal.action && sameAction(order.action, proposal.action);
    return !!(lease && grant && action && (action.executor === proposal.executor || service)
      && grant.objectiveId === action.objectiveId && grant.methodId === action.methodId
      && sameAction(action.token, lease.action) && proposal.action
      && sameAction(lease.action, proposal.action) && (['active', 'ready'].includes(action.status)
        || proposal.purpose === 'life-saving' && action.status === 'blocked')
      && grant.leases.some(given => given.id === lease.id && given.resourceKey === key));
  };
  const interruptions = new Set<string>();
  let cashGold = snapshot.players[owner]?.gold ?? 0;
  let reservedGold = reservedAllocationGold(memory);
  const usedBudgetGold = new Map<string, number>();
  return { admit(proposals: readonly StrategyCommandProposal[]) {
  for (const proposal of proposals) if (proposal.purpose === 'life-saving'
    && safetyCommandReplacesOrder(snapshot, proposal.command)
    && (grantFor(proposal) || proposal.source === 'script' && isLifeSavingScript(proposal.executor))) {
    for (const id of operands(snapshot, proposal.command).units) if (allows(`unit:${id}`, proposal)) interruptions.add(id);
  }
  const admissions: GatewayAdmission[] = [], accepted: StrategyCommandProposal[] = [];
  const record = (proposal: StrategyCommandProposal, command: GameCommand, code?: string) => {
    const header = { commandId: proposal.id, source: proposal.source, executor: proposal.executor,
      action: proposal.action, allocationRevision: proposal.allocationRevision, purpose: proposal.purpose, command };
    const price = code ? 0 : allocationCommandCost(snapshot, owner, command);
    const grant = grantFor(proposal), budgetKey = proposal.action ? `${proposal.action.actionId}:${proposal.action.generation}` : '';
    const budgetGold = grant ? [...new Set(grant.budgets.map(given => given.id))].reduce((sum, id) => {
      const budget = memory.budgets[id];
      return sum + (budget && proposal.action && sameAction(budget.action, proposal.action) && budget.state === 'reserved'
        && budget.objectiveId === grant.objectiveId && budget.methodId === grant.methodId ? budget.amountGold - budget.paidGold : 0);
    }, 0) : 0;
    if (!code && price > 0) {
      if (proposal.source === 'executor' && price > budgetGold - (usedBudgetGold.get(budgetKey) ?? 0)) code = 'command-capital-not-granted';
      else if (price > cashGold || proposal.source === 'script' && price > Math.max(0, cashGold - reservedGold)) code = 'command-cash-owned-by-another-action';
    }
    if (code) admissions.push({ ...header, status: 'rejected', reason: { executor: proposal.executor,
      outcome: 'candidate-rejected', reason: code, unitIds: operands(snapshot, command).units,
      ...(proposal.action ? { taskId: proposal.action.actionId } : {}) } });
    else {
      cashGold -= price;
      if (proposal.source === 'executor') {
        reservedGold -= price; usedBudgetGold.set(budgetKey, (usedBudgetGold.get(budgetKey) ?? 0) + price);
      }
      admissions.push({ ...header, status: 'accepted', admittedTick: snapshot.tick, queuedTick }); accepted.push({ ...proposal, command });
    }
  };
  for (const proposal of proposals) {
    const command = proposal.command, used = operands(snapshot, command);
    if (proposal.source === 'script' && command.type === 'build' && command.buildingKind === 'townHall'
      && input.managedExpansionSites?.some(site => Math.hypot(site.point.x - command.x, site.point.y - command.y) <= GOLD_MINE_RULES.baseRange)) {
      const order = units.get(command.unitId)?.order;
      if (!(order?.type === 'build' && order.buildingKind === command.buildingKind && order.x === command.x && order.y === command.y)) {
        record(proposal, command, 'goal-managed-expansion-requires-formal-builder'); continue;
      }
    }
    if (proposal.source === 'executor' && !grantFor(proposal)) { record(proposal, command, 'allocation-grant-stale'); continue; }
    const deniedUnit = (id: string) => {
      if (!allows(`unit:${id}`, proposal)) return 'resource-leased-to-another-action';
      if (proposal.purpose !== 'life-saving' && interruptions.has(id)) return 'life-saving-interruption-replaces-task';
      const unit = units.get(id);
      if (unit?.owner !== owner || unit.hp <= 0)
        return 'command-unit-not-owned-or-present';
      if (proposal.source === 'executor' && unit?.order.type === 'board' && command.type !== 'board'
        && proposal.purpose !== 'life-saving') {
        const lineage = memory.issuedOrders[id];
        if (lineage && proposal.action && sameAction(lineage.action, proposal.action)) return undefined;
        const override = grantFor(proposal)?.orderOverrides.find(item => item.unitId === id);
        const handoff = override && events.get(override.preemptionEventId);
        if (!handoff || handoff.kind !== 'preempted' || handoff.handoff === 'pending'
          || handoff.quotation.toObjectiveId !== grantFor(proposal)?.objectiveId
          || !handoff.quotation.resourceKeys.includes(`unit:${id}`)) return 'board-handoff-unconfirmed';
      }
      return undefined;
    };
    if (used.queues.some(id => buildings.get(id)?.owner !== owner)) {
      record(proposal, command, 'command-building-not-owned-or-present'); continue;
    }
    const dependencyDenied = used.dependencies.some(key => !allows(key, proposal));
    if (dependencyDenied || used.queues.some(id => !allows(command.type === 'research' ? `research:${id}` : `queue:${id}`, proposal))) {
      record(proposal, command, 'command-dependent-resource-not-granted'); continue;
    }
    const denied = used.units.filter(id => deniedUnit(id));
    if (denied.length && 'unitIds' in command) {
      const rejectedIds = new Set(denied), permitted = command.unitIds.filter(id => !rejectedIds.has(id));
      record(proposal, inheritIncumbentCommand(command, { ...command, unitIds: denied }), deniedUnit(denied[0]!)!);
      if (permitted.length) record(proposal, inheritIncumbentCommand(command, { ...command, unitIds: permitted }));
    } else if (denied.length) record(proposal, command, deniedUnit(denied[0]!)!);
    else record(proposal, command);
  }
  return { accepted, admissions };
  } };
}

/** Single-batch convenience. A runner which admits script-by-script uses one
 * createStrategyCommandGateway for the entire think and submits rescue
 * proposals before the corresponding task proposals. */
export function admitStrategyCommands(input: StrategyGatewayInput & Readonly<{ proposals: readonly StrategyCommandProposal[] }>) {
  return createStrategyCommandGateway(input).admit(input.proposals);
}
