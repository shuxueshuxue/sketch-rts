import { readCacheMap, retainCacheMap } from './bounded-cache';
import { unitMover } from '../../shared/catalog';
import { isTransportKind } from '../../shared/transport-role';
import { walkableGoal } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { isDefenseTaskClaim } from '../policy/claims';
import { landIdAt } from './regions';
import type { Commitment, ObjectiveKind, UnitRole } from './types';
import { capturesExplanations, explanationRecipe, projectedProperty } from './explanations';

const lastMemberships = new WeakMap<AiPolicyMemory, Map<string, readonly Commitment[]>>();
const EMPTY_COMMITMENTS: readonly Commitment[] = Object.freeze([]);

const membershipEvidence = ({ source, tick, unitId }: { source: string; tick: number; unitId: string }) =>
  ({ source, tick, certainty: 'inferred' as const, detail: `Retained membership of ${unitId}; not a new strategic assignment` });
const healingEvidence = ({ source, tick }: { source: string; tick: number }) =>
  ({ source, tick, certainty: 'recorded' as const, detail: 'Healing order accepted in this plan; delivery is separate from the unit current order' });

export const objectiveId = (kind: ObjectiveKind, owner: PlayerId, targetId: string) => `${kind}:${owner}:${targetId}`;
const roleSets = {
  worker: ['worker'], transport: ['transport'], warship: ['warship'],
  healer: ['healer', 'ranged'], caster: ['caster', 'ranged'], ranged: ['ranged'], frontline: ['frontline'],
} as const;
for (const roles of Object.values(roleSets)) Object.freeze(roles);
export function unitRoles(unit: Unit): readonly UnitRole[] {
  if (unit.kind === 'worker') return roleSets.worker;
  if (unitMover(unit.kind) === 'sea') return isTransportKind(unit.kind) ? roleSets.transport : roleSets.warship;
  if (unit.kind === 'priest' || unit.kind === 'fieldMedic') return roleSets.healer;
  if (unit.kind === 'summoner' || unit.kind === 'witch' || unit.kind === 'ashHexer') return roleSets.caster;
  return unit.attackRange > 100 ? roleSets.ranged : roleSets.frontline;
}

/** Project every retained ownership source, including overlaps. No expiring,
 * releasing, refreshing claims or assigning troops in this observation pass. */
export function createUnitCommitmentQuery(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
  const ferries = Object.entries(memory.naval?.ferries ?? {}), conquests = Object.values(memory.naval?.conquests ?? {});
  const shopping = [memory.shopping, memory.loot, memory.mercenaryCourier, memory.v6?.shop];
  const shoppingSources = ['shopping', 'loot', 'mercenaryCourier', 'v6.shop'];
  let previous = capturesExplanations() ? undefined : lastMemberships.get(memory);
  if (!capturesExplanations() && !previous) lastMemberships.set(memory, previous = new Map());
  return function unitCommitments(unit: Unit, recovery?: { postId: string; walk: boolean }, mobileHealing = false,
    acceptedHealingExecutor?: string): readonly Commitment[] {
    if (unit.owner !== owner) return EMPTY_COMMITMENTS;
    const tick = snapshot.tick, unitId = unit.id;
    let results: Commitment[] | undefined, count = 0;
    const old = (previous ? readCacheMap(previous, unitId) : undefined) ?? EMPTY_COMMITMENTS, role = unitRoles(unit)[0]!;
    const append = (source: string, taskId: string, target: string | null, accepted = false) => {
      const prior = old[count];
      if (previous && !results && prior && prior.source === source && prior.taskId === taskId && prior.objectiveId === target && prior.role === role) { count++; return; }
      results ??= old.slice(0, count); count++;
      const row = { source, taskId, objectiveId: target, role };
      const read: () => Commitment['evidence'] = accepted ? explanationRecipe(healingEvidence, { source, tick })
        : explanationRecipe(membershipEvidence, { source, tick, unitId });
      results.push(projectedProperty(row, 'evidence', read));
    };
    const add = (source: string, taskId: string, kind?: ObjectiveKind, targetId?: string) =>
      append(source, taskId, kind && targetId ? objectiveId(kind, owner, targetId) : null);
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
    for (let index = 0; index < (memory.mounted?.length ?? 0); index++) {
      const mounted = memory.mounted![index]!;
      if (mounted.unitIds.includes(unit.id)) add('mounted', `mounted:${index}`,
        mounted.objective.kind === 'raid' ? 'AttackSite' : undefined, mounted.objective.kind === 'raid' ? mounted.objective.hallId : undefined);
    }
    for (let index = 0; index < shopping.length; index++) if (shopping[index]?.unitId === unit.id) {
      const source = shoppingSources[index]!; add(source, source);
    }
    if (recovery) add('frontRecovery.postRecoveryAssignments', `healing:${recovery.postId}:${recovery.walk ? 'walking' : 'recovering'}`);
    if (mobileHealing) add('mobileCare.claimsUnits', `mobileCare:${unit.id}`);
    if (acceptedHealingExecutor) append(`${acceptedHealingExecutor}.accepted-plan`, `healing:${unit.id}`, null, true);
    if (unit.order.type === 'follow' && unit.hp < unit.maxHp) {
      const targetId = unit.order.targetId;
      if (snapshot.units.some(healer => healer.id === targetId && ['priest', 'fieldMedic'].includes(healer.kind)))
        add('mobileCare.inferred-order', `healing:${targetId}`);
    }
    if (unit.order.type === 'move' && unit.order.avoidCombat && (claim?.kind === 'retreat' || unit.hp < unit.maxHp * .5))
      add('retreat.inferred-order', `retreat:${unit.id}`);
    for (const [shipId, task] of ferries) {
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
      for (const task of conquests) {
        if (task.abandonedTick !== undefined || task.stage === 'complete' || task.stage === 'build') continue;
        const mine = snapshot.resources.find(mine => mine.id === task.mineId);
        if (mine && landIdAt(snapshot.map, unit) && landIdAt(snapshot.map, unit) === landIdAt(snapshot.map, mine))
          add('naval.conquests', `conquest:${task.mineId}:${task.sinceTick}`, 'ConquerIsland', task.mineId);
      }
    }
    const answer = results ?? (count === old.length ? old : count ? old.slice(0, count) : EMPTY_COMMITMENTS);
    if (previous) {
      if (!answer.length) previous.delete(unitId);
      else retainCacheMap(previous, unitId, answer, 2048);
    }
    return answer;
  };
}
