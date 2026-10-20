import { unitMover } from '../../shared/catalog';
import { isTransportKind } from '../../shared/transport-role';
import { walkableGoal } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { isDefenseTaskClaim } from '../policy/claims';
import { landIdAt } from './regions';
import type { Commitment, ObjectiveKind, UnitRole } from './types';

export const objectiveId = (kind: ObjectiveKind, owner: PlayerId, targetId: string) => `${kind}:${owner}:${targetId}`;
export function unitRoles(unit: Unit): UnitRole[] {
  if (unit.kind === 'worker') return ['worker'];
  if (unitMover(unit.kind) === 'sea') return isTransportKind(unit.kind) ? ['transport'] : ['warship'];
  if (unit.kind === 'priest' || unit.kind === 'fieldMedic') return ['healer', 'ranged'];
  if (unit.kind === 'summoner' || unit.kind === 'witch' || unit.kind === 'ashHexer') return ['caster', 'ranged'];
  return unit.attackRange > 100 ? ['ranged'] : ['frontline'];
}

/** Project every retained ownership source, including overlaps. No expiring,
 * releasing, refreshing claims or assigning troops in this observation pass. */
export function unitCommitments(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory, unit: Unit,
  recovery?: { postId: string; walk: boolean }, mobileHealing = false, acceptedHealingExecutor?: string): Commitment[] {
  if (unit.owner !== owner) return [];
  const results: Commitment[] = [], role = unitRoles(unit)[0]!;
  const add = (source: string, taskId: string, kind?: ObjectiveKind, targetId?: string) => results.push({
    source, taskId, objectiveId: kind && targetId ? objectiveId(kind, owner, targetId) : null, role,
    evidence: { source, tick: snapshot.tick, certainty: 'inferred', detail: `Retained membership of ${unit.id}; not a new strategic assignment` },
  });
  const claim = memory.unitClaims[unit.id];
  if (claim && (claim.kind === 'expansionMission' || claim.expiresTick >= snapshot.tick)) {
    const kind: ObjectiveKind | undefined = claim.kind === 'expansion' || claim.kind === 'expansionMission' ? 'ExpandLand'
      : ['mineRally', 'mineGuard', 'mineLeash', 'expansionGarrison'].includes(claim.kind) ? 'DefendSite'
      : claim.kind === 'attack' ? 'AttackSite' : claim.kind === 'harassSquad' ? 'CounterHarass' : undefined;
    add(`unitClaims.${claim.kind}`, `${claim.kind}:${claim.targetId}`, kind, claim.targetId);
  }
  if (claim?.expansionMineId && (claim.expiresTick < snapshot.tick || !['expansion', 'expansionMission'].includes(claim.kind)))
    add('unitClaims.expansionMineId', `expansion:${claim.expansionMineId}`, 'ExpandLand', claim.expansionMineId);
  if (memory.landAttack?.general.group?.includes(unit.id)) add('landAttack', `attack:${memory.landAttack.sinceTick}`, 'AttackSite', memory.landAttack.targetId);
  if (memory.landExpansion?.combat?.creep?.group.includes(unit.id)) add('landExpansion.combat',
    `expansion:${memory.landExpansion.sinceTick}`, 'ExpandLand', memory.landExpansion.mineId);
  if (memory.v6?.creep?.group.includes(unit.id)) add('v6.creep', `creep:${memory.v6.creep.since}`);
  if (memory.v6?.raid?.unitIds.includes(unit.id)) add('v6.raid', `raid:${memory.v6.raid.sinceTick}`, 'AttackSite', memory.v6.raid.targetHallId);
  if (memory.v6?.closeout?.unitIds.includes(unit.id)) add('v6.closeout', `closeout:${memory.v6.closeout.sinceTick}`, 'AttackSite', memory.v6.closeout.targetId);
  if (memory.support?.unitIds.includes(unit.id)) add('support', `support:${memory.support.sinceTick}`, 'DefendSite', memory.support.baseId);
  for (const [index, mounted] of (memory.mounted ?? []).entries()) if (mounted.unitIds.includes(unit.id)) add('mounted', `mounted:${index}`,
    mounted.objective.kind === 'raid' ? 'AttackSite' : undefined, mounted.objective.kind === 'raid' ? mounted.objective.hallId : undefined);
  for (const [source, task] of [['shopping', memory.shopping], ['loot', memory.loot], ['mercenaryCourier', memory.mercenaryCourier], ['v6.shop', memory.v6?.shop]] as const)
    if (task?.unitId === unit.id) add(source, source);
  if (recovery) add('frontRecovery.postRecoveryAssignments', `healing:${recovery.postId}:${recovery.walk ? 'walking' : 'recovering'}`);
  if (mobileHealing) add('mobileCare.claimsUnits', `mobileCare:${unit.id}`);
  if (acceptedHealingExecutor) results.push({ source: `${acceptedHealingExecutor}.accepted-plan`, taskId: `healing:${unit.id}`,
    objectiveId: null, role, evidence: { source: `${acceptedHealingExecutor}.accepted-plan`, tick: snapshot.tick, certainty: 'recorded',
      detail: 'Healing order accepted in this plan; delivery is separate from the unit current order' } });
  if (unit.order.type === 'follow' && unit.hp < unit.maxHp) {
    const targetId = unit.order.targetId;
    if (snapshot.units.some(healer => healer.id === targetId && ['priest', 'fieldMedic'].includes(healer.kind)))
      add('mobileCare.inferred-order', `healing:${targetId}`);
  }
  if (unit.order.type === 'move' && unit.order.avoidCombat && (claim?.kind === 'retreat' || unit.hp < unit.maxHp * .5))
    add('retreat.inferred-order', `retreat:${unit.id}`);
  for (const [shipId, task] of Object.entries(memory.naval?.ferries ?? {})) {
    if (unit.id !== shipId && !task.crewIds.includes(unit.id) && !task.payloadIds?.includes(unit.id)
      && unit.deck?.shipId !== shipId && unit.cabin?.shipId !== shipId
      && !(unit.order.type === 'board' && unit.order.transportId === shipId)) continue;
    const target = snapshot.resources.find(mine => mine.id === task.targetId)
      ?? snapshot.buildings.find(building => building.id === task.targetId) ?? walkableGoal(snapshot.map, task.to.x, task.to.y);
    const land = landIdAt(snapshot.map, target);
    const conquest = task.reinforcementTaskId ?? (['advance', 'settle'].includes(task.purpose) ? task.targetId : undefined);
    add('naval.ferries', `ferry:${shipId}:${task.sinceTick}`, conquest ? 'ConquerIsland'
      : task.purpose === 'reinforce' ? 'ReinforceFront' : task.purpose === 'evacuate' ? 'Evacuate' : undefined, conquest ?? land ?? task.targetId);
  }
  if (!unit.deck && !unit.cabin && unitMover(unit.kind) === 'land' && unit.expiresTick === undefined
    && !isDefenseTaskClaim(claim && claim.expiresTick >= snapshot.tick ? claim : undefined)
    && !memory.mounted?.some(task => task.unitIds.includes(unit.id))) {
    for (const task of Object.values(memory.naval?.conquests ?? {})) {
      if (task.abandonedTick !== undefined || task.stage === 'complete' || task.stage === 'build') continue;
      const mine = snapshot.resources.find(mine => mine.id === task.mineId);
      if (mine && landIdAt(snapshot.map, unit) && landIdAt(snapshot.map, unit) === landIdAt(snapshot.map, mine))
        add('naval.conquests', `conquest:${task.mineId}:${task.sinceTick}`, 'ConquerIsland', task.mineId);
    }
  }
  return results;
}
