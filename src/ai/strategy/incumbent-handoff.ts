import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { ExecutorReason } from '../executor-reasons';
import { clearUnitClaim, forgetExpansionMember } from '../policy/claims';
import { sameGround } from '../../shared/terrain';
import { strategyLeaseAllows } from './control';
import { expansionGarrisonActor, islandConquestActor, landExpansionActor, navalFerryActor } from './incumbent-actors';

type Actor = { source: string; taskId: string };
const sameActor = (a: Actor, b: Actor) => a.source === b.source && a.taskId === b.taskId;
export type IncumbentHandoff = { eventId: string; disposition: 'shrink' | 'pause' | 'fail'; reason: ExecutorReason };

/** Called after the allocator has verified the kind of resource transfer,
 * before old prepare. Candidate reservations are not interrupted executions. */
export function handoffIncumbent(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  actor: Actor, unitIds: readonly string[], eventId: string,
  transfer: 'preempted' | 'candidate-reassigned' = 'preempted'): IncumbentHandoff | null {
  const removed = new Set(unitIds), alive = new Set(snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0).map(unit => unit.id));
  const reason = transfer === 'candidate-reassigned' ? transfer : 'higher-priority-preemption';
  let remaining: string[] = [], targets: string[] = [];
  const expansion = memory.landExpansion;
  if (actor.source === 'miningDefense') {
    const belongs = (id: string) => {
      const claim = memory.unitClaims[id];
      return claim?.targetId === actor.taskId && ['mineGuard', 'mineRally', 'mineLeash'].includes(claim.kind);
    };
    const members = new Set(Object.keys(memory.unitClaims).filter(belongs));
    for (const lease of Object.values(memory.strategyAllocation?.leases ?? {}))
      if (lease.resourceKey.startsWith('unit:') && lease.incumbentTask && sameActor(lease.incumbentTask, actor))
        members.add(lease.resourceKey.slice(5));
    for (const id of unitIds) if (belongs(id)) clearUnitClaim(memory, id);
    remaining = [...members].filter(id => !removed.has(id) && alive.has(id) && strategyLeaseAllows(memory, id, actor));
    // The post and everyone else remain intact; selectors consult the new lease.
    targets = [actor.taskId];
  } else if (expansion && sameActor(actor, landExpansionActor(expansion))) {
    const members = new Set(Object.entries(memory.unitClaims).filter(([, claim]) => claim.expansionMineId === expansion.mineId
      || claim.kind === 'expansion' && claim.targetId === expansion.mineId).map(([id]) => id));
    for (const id of expansion.combat?.creep?.group ?? []) members.add(id);
    for (const id of unitIds) {
      const claim = memory.unitClaims[id];
      if (claim?.kind === 'expansion' && claim.targetId === expansion.mineId) clearUnitClaim(memory, id);
      if (memory.unitClaims[id]?.expansionMineId === expansion.mineId) forgetExpansionMember(memory, id);
    }
    if (expansion.combat?.creep) expansion.combat.creep.group = expansion.combat.creep.group.filter(id => !removed.has(id));
    remaining = [...members].filter(id => !removed.has(id) && alive.has(id) && strategyLeaseAllows(memory, id, actor));
    expansion.reason = reason;
    if (!remaining.length) { expansion.paused = true; expansion.pausedAt ??= snapshot.tick; }
    targets = [expansion.mineId];
  } else if (actor.source === 'expansionGarrison' && memory.expansionGarrisons?.[actor.taskId]
    && sameActor(actor, expansionGarrisonActor(actor.taskId))) {
    const post = memory.expansionGarrisons[actor.taskId]!;
    for (const id of unitIds) {
      const claim = memory.unitClaims[id];
      if (claim?.kind === 'expansionGarrison' && claim.targetId === actor.taskId) {
        clearUnitClaim(memory, id);
        if (memory.unitClaims[id]?.expansionMineId === post.mineId) forgetExpansionMember(memory, id);
      }
    }
    remaining = Object.entries(memory.unitClaims).filter(([id, claim]) => alive.has(id) && claim.kind === 'expansionGarrison'
      && claim.targetId === actor.taskId && strategyLeaseAllows(memory, id, actor)).map(([id]) => id);
    targets = [actor.taskId];
  } else {
    const ferry = Object.entries(memory.naval?.ferries ?? {}).find(([shipId, task]) => sameActor(actor, navalFerryActor(shipId, task.sinceTick)));
    if (ferry) {
      const [shipId, task] = ferry;
      task.crewIds = task.crewIds.filter(id => !removed.has(id));
      if (task.payloadIds) task.payloadIds = task.payloadIds.filter(id => !removed.has(id));
      remaining = [shipId, ...task.crewIds, ...(task.payloadIds ?? [])].filter(id => !removed.has(id) && alive.has(id)
        && strategyLeaseAllows(memory, id, actor));
      if (removed.has(shipId) || !remaining.length) delete memory.naval!.ferries![shipId];
      targets = [task.targetId];
    } else {
      const conquest = Object.values(memory.naval?.conquests ?? {}).find(task => sameActor(actor, islandConquestActor(task)));
      if (!conquest) return null;
      if (conquest.combat?.creep) conquest.combat.creep.group = conquest.combat.creep.group.filter(id => !removed.has(id));
      const mine = snapshot.resources.find(mine => mine.id === conquest.mineId);
      remaining = mine ? snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && !unit.deck && !unit.cabin
        && !removed.has(unit.id) && sameGround(snapshot.map, unit, mine) && strategyLeaseAllows(memory, unit.id, actor)).map(unit => unit.id) : [];
      conquest.reason = reason;
      if (!remaining.length) { conquest.paused = true; conquest.pausedAt ??= snapshot.tick; }
      targets = [conquest.mineId];
    }
  }
  return { eventId, disposition: remaining.length ? 'shrink' : 'pause', reason: { executor: actor.source,
    outcome: remaining.length ? 'candidate-rejected' : 'paused', reason,
    taskId: actor.taskId, targetIds: targets, unitIds: [...unitIds] } };
}
