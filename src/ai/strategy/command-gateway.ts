import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import type { ActionGrant, ActionToken, CommandAdmission, ExclusiveResourceKey, StrategyAllocationMemory } from './allocation-types';
import { sameAction } from './control';

export type StrategyCommandProposal = Readonly<{
  id: string;
  source: 'script' | 'executor';
  executor: string;
  action: ActionToken | null;
  allocationRevision: number | null;
  purpose: 'task' | 'life-saving';
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

/** A transaction-local gateway. Raw script authority can never command a leased
 * resource. A supported incumbent adapter must explicitly bind its real token,
 * just like every other executor. No simulator legality rule is copied here. */
export function admitStrategyCommands(input: Readonly<{ snapshot: GameSnapshot; owner: PlayerId;
  memory: StrategyAllocationMemory; grants: readonly ActionGrant[]; proposals: readonly StrategyCommandProposal[]; queuedTick: number | null }>) {
  const { snapshot, owner, memory, grants, proposals, queuedTick } = input;
  const units = new Map(snapshot.units.flatMap(unit => [unit, ...(unit.cargo ?? [])]).map(unit => [unit.id, unit]));
  const buildings = new Map(snapshot.buildings.map(building => [building.id, building]));
  const events = new Map(memory.events.map(event => [event.id, event]));
  const grantFor = (proposal: StrategyCommandProposal) => proposal.source === 'executor' && proposal.action
    && proposal.allocationRevision === memory.revision
    ? grants.find(grant => grant.revision === memory.revision && sameAction(grant.action, proposal.action!)) : undefined;
  const allows = (key: ExclusiveResourceKey, proposal: StrategyCommandProposal) => {
    const lease = memory.leases[key];
    if (proposal.source === 'script') return !lease;
    const grant = grantFor(proposal), action = proposal.action && memory.executions[proposal.action.actionId];
    return !!(lease && grant && action && action.executor === proposal.executor
      && grant.objectiveId === action.objectiveId && grant.methodId === action.methodId
      && sameAction(action.token, lease.action) && proposal.action
      && sameAction(lease.action, proposal.action) && (['active', 'ready'].includes(action.status)
        || proposal.purpose === 'life-saving' && action.status === 'blocked')
      && grant.leases.some(given => given.id === lease.id && given.resourceKey === key));
  };
  const interruptions = new Set<string>();
  for (const proposal of proposals) if (proposal.purpose === 'life-saving' && grantFor(proposal)) {
    for (const id of operands(snapshot, proposal.command).units) if (allows(`unit:${id}`, proposal)) interruptions.add(id);
  }
  const admissions: GatewayAdmission[] = [], accepted: StrategyCommandProposal[] = [];
  const record = (proposal: StrategyCommandProposal, command: GameCommand, code?: string) => {
    const header = { commandId: proposal.id, source: proposal.source, executor: proposal.executor,
      action: proposal.action, allocationRevision: proposal.allocationRevision, purpose: proposal.purpose, command };
    if (code) admissions.push({ ...header, status: 'rejected', reason: { executor: proposal.executor,
      outcome: 'candidate-rejected', reason: code, unitIds: operands(snapshot, command).units,
      ...(proposal.action ? { taskId: proposal.action.actionId } : {}) } });
    else { admissions.push({ ...header, status: 'accepted', admittedTick: snapshot.tick, queuedTick }); accepted.push({ ...proposal, command }); }
  };
  for (const proposal of proposals) {
    const command = proposal.command, used = operands(snapshot, command);
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
    if (dependencyDenied || used.queues.some(id => !allows(`queue:${id}`, proposal))) {
      record(proposal, command, 'command-dependent-resource-not-granted'); continue;
    }
    const denied = used.units.filter(id => deniedUnit(id));
    if (denied.length && 'unitIds' in command) {
      const rejectedIds = new Set(denied), permitted = command.unitIds.filter(id => !rejectedIds.has(id));
      record(proposal, { ...command, unitIds: denied }, deniedUnit(denied[0]!)!);
      if (permitted.length) record(proposal, { ...command, unitIds: permitted });
    } else if (denied.length) record(proposal, command, deniedUnit(denied[0]!)!);
    else record(proposal, command);
  }
  return { accepted, admissions };
}
