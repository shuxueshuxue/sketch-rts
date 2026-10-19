import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory, AiPolicyUnitClaim } from '../memory';
import { activeUnitClaim, clearUnitClaim, isMineRallyClaim, recordUnitTaskClaim } from '../policy/claims';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import type { V6Intel } from '../policy/v6/intel';

// The existing mine-raid perimeter. A 200-deep fighting post still has 450 of fighting room toward the enemy.
export const MINING_PURSUIT_RADIUS = 650;
const RETURN_RADIUS = 240;
const proposals = new WeakMap<AiPolicyMemory, { tick: number; units: Unit[]; state: NonNullable<AiPolicyMemory['miningLeash']> }>();
const defender = (claim: AiPolicyUnitClaim | undefined) => claim?.kind === 'mineGuard' || isMineRallyClaim(claim) || claim?.kind === 'mineLeash';

export function expansionOwnsDefender(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, unit: Unit) {
  const mission = options.memory.landExpansion;
  if (mission && !mission.paused && mission.stage !== 'complete'
    && options.memory.unitClaims[unit.id]?.expansionMineId === mission.mineId) return true;
  const claim = activeUnitClaim(snapshot, owner, unit, options);
  return claim?.kind === 'expansion' || claim?.kind === 'expansionGarrison';
}

export function miningLeashAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const known = options.memory.miningLeash, anchor = options.memory.miningDefense, general = options.memory.v6?.general;
  const returning = snapshot.units.some(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'mineLeash');
  const hallId = (returning ? known?.hallId : undefined) ?? anchor?.hallId ?? known?.hallId ?? (general?.mode === 'defend' ? general.targetHallId : undefined);
  const hall = intel.ownHalls.find(hall => hall.id === hallId);
  if (!hall) return undefined;
  const point = known?.hallId === hall.id ? known.point : anchor?.hallId === hall.id ? anchor.point : hall;
  const units = snapshot.units.filter(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return unit.owner === owner && !unit.deck && unit.kind !== 'worker'
      && !['board', 'cast', 'charge'].includes(unit.order.type) && !expansionOwnsDefender(snapshot, owner, options, unit)
      && distance(unit, point) > RETURN_RADIUS && claim?.targetId === hall.id
      && (claim.kind === 'mineLeash' || (claim.kind === 'mineGuard' || isMineRallyClaim(claim) && claim.arrived)
        && (anchor || general?.mode === 'defend' && general.targetHallId === hall.id)
        && distance(unit, hall) > MINING_PURSUIT_RADIUS && ['attack', 'attackMove'].includes(unit.order.type));
  });
  return units.length ? { hall, point, units, state: { hallId: hall.id, point } } : undefined;
}

export function miningLeashOwns(snapshot: GameSnapshot, memory: AiPolicyMemory, unitId: string) {
  const proposal = proposals.get(memory), unit = snapshot.units.find(unit => unit.id === unitId);
  if (proposal?.tick === snapshot.tick) return proposal.units.some(unit => unit.id === unitId);
  return unit !== undefined && activeUnitClaim(snapshot, unit.owner, unit, { memory })?.kind === 'mineLeash';
}

export function planMiningLeash(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] {
  const assignment = miningLeashAssignment(snapshot, owner, options, intel);
  for (const unit of snapshot.units) {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    if (claim?.kind === 'mineLeash' && !assignment?.units.includes(unit)) claim.kind = claim.resumeKind ?? 'mineGuard';
  }
  if (!assignment) { proposals.delete(options.memory); return []; }
  proposals.set(options.memory, { tick: snapshot.tick, units: assignment.units, state: assignment.state });
  const moving = assignment.units.filter(unit => !(unit.order.type === 'move' && unit.order.avoidCombat
    && distance(unit.order, assignment.point) < 40));
  return moving.length ? [{ type: 'move', unitIds: moving.map(unit => unit.id), ...assignment.point, avoidCombat: true }] : [];
}

export function recordMiningLeashAcceptedCommands(snapshot: GameSnapshot, _owner: PlayerId, options: AiPolicyContext, commands: readonly GameCommand[]) {
  const proposal = proposals.get(options.memory);
  if (!proposal || proposal.tick !== snapshot.tick) return;
  for (const command of commands) if ('unitIds' in command) for (const id of command.unitIds) {
    const previous = options.memory.unitClaims[id];
    recordUnitTaskClaim(snapshot, options.memory, id, { kind: 'mineLeash', targetId: proposal.state.hallId,
      x: proposal.state.point.x, y: proposal.state.point.y, resumeKind: isMineRallyClaim(previous) ? 'mineRally' : 'mineGuard',
      ...(previous?.arrived ? { arrived: true } : {}) });
  }
}

export function recordMiningLeashCommands(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
  const proposal = proposals.get(memory); proposals.delete(memory);
  const claims = snapshot.units.map(unit => activeUnitClaim(snapshot, owner, unit, { memory })).filter(defender);
  if (proposal?.tick === snapshot.tick && claims.some(claim => claim?.kind === 'mineLeash')) memory.miningLeash = proposal.state;
  else if (!claims.length) delete memory.miningLeash;
}

/** A private field sortie is not a mine defender. Only accepted general orders add it to this screen. */
export function recordMiningGeneralCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: readonly GameCommand[]) {
  const general = options.memory.v6?.general, known = options.memory.miningLeash;
  const returning = snapshot.units.some(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'mineLeash');
  const hall = general && ['defend', 'guard'].includes(general.mode)
    ? snapshot.buildings.find(building => building.owner === owner && building.id === general.targetHallId) : undefined;
  if (!hall) {
    if (!returning) {
      for (const command of commands) if ('unitIds' in command) for (const id of command.unitIds) {
        if (options.memory.unitClaims[id]?.kind === 'mineGuard') clearUnitClaim(options.memory, id);
      }
      if (!snapshot.units.some(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'mineGuard')) delete options.memory.miningLeash;
    }
    return;
  }
  if (returning && known?.hallId !== hall.id) return;
  const anchor = options.memory.miningDefense;
  const point = anchor?.hallId === hall.id ? anchor.point : known?.hallId === hall.id ? known.point : general!.target ?? hall;
  for (const command of commands) if ('unitIds' in command) for (const id of command.unitIds) {
    const previous = options.memory.unitClaims[id];
    if (previous?.targetId === hall.id && (isMineRallyClaim(previous) || previous.kind === 'mineLeash')) continue;
    recordUnitTaskClaim(snapshot, options.memory, id, { kind: 'mineGuard', targetId: hall.id, x: point.x, y: point.y });
  }
  if (snapshot.units.some(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return defender(claim) && claim?.targetId === hall.id;
  })) options.memory.miningLeash = { hallId: hall.id, point };
}
