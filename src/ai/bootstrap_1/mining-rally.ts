import { GOLD_MINE_RULES } from '../../shared/mining';
import { nearestByRoute } from '../../shared/route-selection';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { averagePoint, distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import type { AiPolicyMemory } from '../memory';
import { availableV6Army, V7_WOUNDED_SHARE } from '../policy/v6/general';
import { isBacklineKind } from '../policy/v6/backline';
import type { V6Intel } from '../policy/v6/intel';
import { isEnemyOwner } from '../policy/ownership';
import { coveredDefenseTarget } from './covered-defense';
import { strengthOf } from '../policy/v6/strength';
import { activeUnitClaim, isMineRallyClaim, recordUnitTaskClaim } from '../policy/claims';
import { strategyLeaseAllows } from '../strategy/control';
import { miningDefenseActor } from '../strategy/incumbent-actors';
import { bindIncumbentCommands } from '../strategy/incumbent-command-source';

export const MINING_RALLY_RADIUS = 240;
const proposals = new WeakMap<AiPolicyMemory, { tick: number; owner: PlayerId;
  assignment: NonNullable<ReturnType<typeof miningRallyAssignment>> }>();

export function miningRallyAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const known = options.memory.miningDefense;
  const intrusion = intel.intrusion;
  const hall = known ? intel.ownHalls.find(hall => hall.id === known.hallId)
    : intrusion && nearestByRoute(snapshot.map, intel.ownHalls.filter(hall => hall.complete), intrusion.building, 'land');
  if (!hall || !known && (!intrusion || distance(intrusion.building, hall) > GOLD_MINE_RULES.baseRange
    || !snapshot.resources.some(mine => mine.amount > 0 && distance(mine, hall) <= GOLD_MINE_RULES.baseRange)
      && !snapshot.units.some(unit => unit.owner === owner && unit.kind === 'worker' && distance(unit, hall) <= GOLD_MINE_RULES.baseRange))) return undefined;
  const actor = miningDefenseActor(hall.id);
  const available = known ? snapshot.units.filter(unit => unit.owner === owner && !unit.deck
      && strategyLeaseAllows(options.memory, unit.id, actor)
      && isMineRallyClaim(activeUnitClaim(snapshot, owner, unit, options))
      && activeUnitClaim(snapshot, owner, unit, options)?.targetId === hall.id)
    : availableV6Army(snapshot, { ...options, strategyActor: actor }, intel).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0
      && activeUnitClaim(snapshot, owner, unit, options)?.kind !== 'expansionGarrison'
      && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE);
  if (available.length === 0) return undefined;
  const field = intrusion ? averagePoint(intrusion.attackers) : hall;
  const gap = distance(hall, field);
  const point = known?.point ?? { x: hall.x + (field.x - hall.x) * Math.min(1, 200 / Math.max(1, gap)),
    y: hall.y + (field.y - hall.y) * Math.min(1, 200 / Math.max(1, gap)) };
  const attackers = snapshot.units.filter(unit => unit.attackDamage > 0 && isEnemyOwner(snapshot, owner, unit.owner, options)
    && (distance(unit, hall) <= 1000 || known?.attackerIds.includes(unit.id) && distance(unit, hall) <= 1400));
  const arrived = available.filter(unit => distance(unit, point) <= MINING_RALLY_RADIUS);
  const arrivedIds = [...new Set([...available.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.arrived)
    .map(unit => unit.id), ...arrived.map(unit => unit.id)])];
  const protectedUnits = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && distance(unit, hall) <= 650);
  const protectedEntities = [hall, ...protectedUnits];
  const protectedHp = Object.fromEntries(protectedEntities.map(entity => [entity.id, entity.hp]));
  const underAttack = protectedEntities.some(entity => entity.hp < (known?.protectedHp?.[entity.id] ?? entity.hp)
    || snapshot.projectiles.some(shot => shot.targetId === entity.id && isEnemyOwner(snapshot, owner, shot.owner, options))
    || attackers.some(foe => (foe.order.type === 'attack' || foe.order.type === 'attackMove') && foe.order.targetId === entity.id
      && distance(foe, entity) <= foe.attackRange + foe.radius + entity.radius));
  const enough = arrived.length > 0 && attackers.length > 0 && strengthOf(arrived) >= strengthOf(attackers) * 1.25;
  const gathered = available.every(unit => arrivedIds.includes(unit.id));
  if (known && gathered && attackers.length === 0) return undefined;
  return { hall, units: available, arrivedIds, state: { hallId: hall.id, point,
    attackerIds: [...new Set([...(known?.attackerIds ?? intrusion!.attackers.map(unit => unit.id)), ...attackers.map(unit => unit.id)])],
    protectedHp,
    phase: known?.phase === 'fight' || enough || underAttack || gathered ? 'fight' as const : 'gather' as const } };
}

/** Only the still-rallying units leave the general's live army view. */
export function miningRallyOwns(snapshot: GameSnapshot, memory: AiPolicyMemory, unitId: string) {
  const proposal = proposals.get(memory), unit = snapshot.units.find(unit => unit.id === unitId);
  if (!unit) return false;
  if (proposal?.tick === snapshot.tick) return proposal.assignment.units.some(unit => unit.id === unitId)
    && (proposal.assignment.state.phase === 'gather' || !proposal.assignment.arrivedIds.includes(unitId));
  const claim = activeUnitClaim(snapshot, unit.owner, unit, { memory });
  const state = memory.miningDefense;
  return !!state && !!claim && isMineRallyClaim(claim) && state.hallId === claim.targetId
    && (state.phase === 'gather' || !claim.arrived);
}

export function planMiningRally(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] {
  const assignment = miningRallyAssignment(snapshot, owner, options, intel);
  if (!assignment) {
    delete options.memory.miningDefense; proposals.delete(options.memory);
    for (const claim of Object.values(options.memory.unitClaims)) {
      if (claim.kind === 'mineRally') claim.kind = 'mineGuard';
      if (claim.kind === 'mineLeash' && claim.resumeKind === 'mineRally') claim.resumeKind = 'mineGuard';
    }
    return [];
  }
  const { state, units, arrivedIds } = assignment;
  const owns = (id: string) => {
    const unit = units.find(unit => unit.id === id)!;
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return isMineRallyClaim(claim) && claim?.targetId === state.hallId;
  };
  proposals.set(options.memory, { tick: snapshot.tick, owner, assignment });
  const arriving = units.filter(unit => !arrivedIds.includes(unit.id)
    && !['cast', 'charge'].includes(unit.order.type));
  const foes = snapshot.units.filter(unit => unit.attackDamage > 0 && !unit.deck
    && isEnemyOwner(snapshot, owner, unit.owner, options));
  const firing: GameCommand[] = [];
  const walking = arriving.filter(unit => {
    const target = unit.cooldown <= 0 && foes.filter(foe => distance(unit, foe) <= unit.attackRange + unit.radius + foe.radius)
      .sort((a, b) => distance(unit, a) - distance(unit, b))[0];
    if (!target) return !owns(unit.id) || !(unit.order.type === 'move' && distance(unit.order, state.point) < 40);
    if (!owns(unit.id) || unit.order.type !== 'attack' || unit.order.targetId !== target.id) firing.push({ type: 'attack', unitIds: [unit.id], targetId: target.id });
    return false;
  });
  const waiting = units.filter(unit => distance(unit, state.point) <= MINING_RALLY_RADIUS
    && (!owns(unit.id) || state.phase === 'gather' && unit.order.type !== 'hold'));
  return bindIncumbentCommands([
    ...firing,
    ...(walking.length ? [{ type: 'move' as const, unitIds: walking.map(unit => unit.id), ...state.point, avoidCombat: true }] : []),
    ...(waiting.length ? [{ type: 'holdPosition' as const, unitIds: waiting.map(unit => unit.id) }] : []),
  ], miningDefenseActor(state.hallId));
}

/** The runner supplies accepted orders, so rejected rally proposals never acquire ownership. */
export function recordMiningRallyAcceptedCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: readonly GameCommand[]) {
  const proposal = proposals.get(options.memory);
  if (!proposal || proposal.tick !== snapshot.tick || proposal.owner !== owner) return;
  const { state, arrivedIds } = proposal.assignment;
  for (const command of commands) if ('unitIds' in command) for (const id of command.unitIds) {
    const previous = options.memory.unitClaims[id];
    recordUnitTaskClaim(snapshot, options.memory, id, { kind: previous?.kind === 'mineLeash' ? 'mineLeash' : 'mineRally',
      ...(previous?.kind === 'mineLeash' ? { resumeKind: 'mineRally' } : {}), targetId: state.hallId,
      x: state.point.x, y: state.point.y, arrived: arrivedIds.includes(id) });
  }
}

export function recordMiningRallyCommands(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
  const proposal = proposals.get(memory); proposals.delete(memory);
  if (!proposal || proposal.tick !== snapshot.tick || proposal.owner !== owner) return;
  const confirmed = proposal.assignment.units.filter(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, { memory });
    return isMineRallyClaim(claim) && claim?.targetId === proposal.assignment.state.hallId;
  });
  if (confirmed.length === 0) { delete memory.miningDefense; return; }
  for (const unit of confirmed) if (proposal.assignment.arrivedIds.includes(unit.id)) memory.unitClaims[unit.id]!.arrived = true;
  memory.miningDefense = proposal.assignment.state;
}

/** The defended hall stays fixed even while raiders cross the line between two mines. */
export function anchoredMiningDefense(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const known = options.memory.miningDefense;
  if (!known) return undefined;
  const assignment = miningRallyAssignment(snapshot, owner, options, intel);
  if (!assignment) return undefined;
  const attackers = snapshot.units.filter(unit => assignment.state.attackerIds.includes(unit.id));
  if (attackers.length === 0) return undefined;
  const defended = coveredDefenseTarget(snapshot, { ...intel, ownHalls: [assignment.hall],
    intrusion: { building: assignment.hall, attackers, threat: intel.intrusion?.threat ?? 0 } });
  return defended && { ...defended, point: known.point };
}
