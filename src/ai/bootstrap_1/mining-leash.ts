import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { activeUnitClaim } from '../policy/claims';
import { distance } from '../policy/spatial';
import type { AiCommandEntry, AiPolicyContext, AiScript } from '../policy/types';
import type { V6Intel } from '../policy/v6/intel';

// The existing mine-raid perimeter. A 200-deep fighting post still has 450 of fighting room toward the enemy.
export const MINING_PURSUIT_RADIUS = 650;
const RETURN_RADIUS = 240;
const proposals = new WeakMap<AiPolicyMemory, { tick: number; state: NonNullable<AiPolicyMemory['miningLeash']> }>();

export function expansionOwnsDefender(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, unit: GameSnapshot['units'][number]) {
  // The expansion branch owns its screen through construction, after ordinary clearing claims expire.
  const memory: AiPolicyMemory & { landExpansion?: { unitIds: readonly string[]; paused?: boolean; stage: string } } = options.memory;
  const mission = memory.landExpansion;
  if (mission && !mission.paused && mission.stage !== 'complete' && mission.unitIds.includes(unit.id)) return true;
  return activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansion';
}

export function miningLeashAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const known = options.memory.miningLeash, anchor = options.memory.miningDefense;
  const general = options.memory.v6?.general;
  const hallId = (known?.unitIds.length ? known.hallId : undefined) ?? anchor?.hallId ?? known?.hallId ?? (general?.mode === 'defend' ? general.targetHallId : undefined);
  const hall = intel.ownHalls.find(hall => hall.id === hallId);
  if (!hall) return undefined;
  const point = known?.hallId === hall.id ? known.point : anchor?.hallId === hall.id ? anchor.point : hall;
  const oldIds = new Set(known?.unitIds ?? []);
  const defenders = new Set([...(known?.defenderIds ?? []), ...(anchor?.arrivedIds ?? [])]);
  const units = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker'
    && !['board', 'cast', 'charge'].includes(unit.order.type)
    && !expansionOwnsDefender(snapshot, owner, options, unit)
    && distance(unit, point) > RETURN_RADIUS
    && (oldIds.has(unit.id) || defenders.has(unit.id) && (anchor || general?.mode === 'defend' && general.targetHallId === hall.id)
      && distance(unit, hall) > MINING_PURSUIT_RADIUS && ['attack', 'attackMove'].includes(unit.order.type)));
  return units.length ? { hall, point, units, state: { hallId: hall.id, point, unitIds: units.map(unit => unit.id), defenderIds: [...defenders] } } : undefined;
}

export function miningLeashOwns(snapshot: GameSnapshot, memory: AiPolicyMemory, unitId: string) {
  const proposal = proposals.get(memory);
  return (proposal?.tick === snapshot.tick ? proposal.state : memory.miningLeash)?.unitIds.includes(unitId) ?? false;
}

export function planMiningLeash(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] {
  const assignment = miningLeashAssignment(snapshot, owner, options, intel);
  if (!assignment) {
    proposals.delete(options.memory);
    if (options.memory.miningLeash) options.memory.miningLeash.unitIds = [];
    return [];
  }
  proposals.set(options.memory, { tick: snapshot.tick, state: assignment.state });
  const moving = assignment.units.filter(unit => !(unit.order.type === 'move' && unit.order.avoidCombat
    && distance(unit.order, assignment.point) < 40));
  return moving.length ? [{ type: 'move', unitIds: moving.map(unit => unit.id), ...assignment.point, avoidCombat: true }] : [];
}

export function recordMiningLeashCommands(snapshot: GameSnapshot, memory: AiPolicyMemory, entries: readonly AiCommandEntry[], scripts: readonly AiScript[]) {
  const proposal = proposals.get(memory); proposals.delete(memory);
  const roles = new Map(scripts.map(script => [script.id, script.redirects ?? 'strategic']));
  const reassigned = new Set(entries.filter(entry => roles.get(entry.scriptId) !== 'local')
    .flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : 'unitId' in entry.command ? [entry.command.unitId] : []));
  const current = memory.miningLeash;
  if (current) current.defenderIds = current.defenderIds.filter(id => !reassigned.has(id) && snapshot.units.some(unit => unit.id === id));
  if (!proposal || proposal.tick !== snapshot.tick) return;
  const issued = new Set(entries.filter(entry => entry.scriptId === 'miningLeash')
    .flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []));
  const redirected = new Set(entries.filter(entry => entry.scriptId !== 'miningLeash')
    .flatMap(entry => ['move', 'attackMove', 'attack', 'holdPosition', 'board', 'garrison'].includes(entry.command.type)
      && 'unitIds' in entry.command ? entry.command.unitIds : []));
  const unitIds = proposal.state.unitIds.filter(id => issued.has(id) || memory.miningLeash?.unitIds.includes(id)
    && !redirected.has(id) && snapshot.units.some(unit => unit.id === id && unit.order.type === 'move'
      && distance(unit.order, proposal.state.point) < 40));
  if (unitIds.length || current?.defenderIds.length) memory.miningLeash = { ...proposal.state, unitIds, defenderIds: current?.defenderIds ?? proposal.state.defenderIds.filter(id => !reassigned.has(id)) };
  else delete memory.miningLeash;
}


/** A private field sortie is not a mine defender. Only accepted general orders add it to this screen. */
export function recordMiningGeneralCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: readonly GameCommand[]) {
  const general = options.memory.v6?.general, known = options.memory.miningLeash;
  if (!general || !['defend', 'guard'].includes(general.mode)) {
    if (known && known.unitIds.length === 0) delete options.memory.miningLeash;
    return;
  }
  const hall = snapshot.buildings.find(building => building.owner === owner && building.id === general.targetHallId);
  if (!hall) {
    if (known && known.unitIds.length === 0) delete options.memory.miningLeash;
    return;
  }
  if (known?.unitIds.length && known.hallId !== hall.id) return;
  const ordered = commands.flatMap(command => 'unitIds' in command ? command.unitIds : []);
  const defenderIds = [...new Set([...(known?.hallId === hall.id ? known.defenderIds : []), ...ordered])];
  if (defenderIds.length === 0) return;
  const anchor = options.memory.miningDefense;
  const point = anchor?.hallId === hall.id ? anchor.point : known?.hallId === hall.id ? known.point : general.target ?? hall;
  options.memory.miningLeash = { hallId: hall.id, point, defenderIds, unitIds: known?.hallId === hall.id ? known.unitIds : [] };
}
