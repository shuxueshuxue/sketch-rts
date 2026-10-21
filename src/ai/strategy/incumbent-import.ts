import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { ExecutableMethod, StrategyAllocationMemory } from './allocation-types';
import { appendAllocationEvent } from './allocation-lifecycle';
import { incumbentDisposition, observeIncumbentOrders } from './incumbent-evidence';
import { expansionGarrisonActor, islandConquestActor, landExpansionActor, miningDefenseActor, navalFerryActor } from './incumbent-actors';
import type { IncumbentCommandActor } from './incumbent-command-source';
import type { DecisionFacts } from './decision';
import type { Objective, Situation, Target } from './types';
import { unitArrivalFacts, withDecisionUnitArrivals } from './unit-arrivals';

type Task = { actor: IncumbentCommandActor; targetId: string; unitIds: readonly string[]; kind: ExecutableMethod['kind'] };
const key = (actor: IncumbentCommandActor) => `${actor.source}:${actor.taskId}`;

/** Membership identifies a proposed task; only a real accepted/observed order
 * below can turn one of these members into a committed incumbent. */
export function incumbentTasks(memory: AiPolicyMemory, authority = memory.strategyAllocation): Task[] {
  const tasks: Task[] = [];
  const mining = new Map<string, Set<string>>();
  const member = (hallId: string, unitId: string) => {
    const ids = mining.get(hallId) ?? new Set<string>(); ids.add(unitId); mining.set(hallId, ids);
  };
  for (const [unitId, claim] of Object.entries(memory.unitClaims))
    if (claim.targetId && ['mineGuard', 'mineRally', 'mineLeash'].includes(claim.kind)) member(claim.targetId, unitId);
  // Local detachments need no persistent membership list. Only their actual
  // producer receipt supplies executed members; claims alone remain proposals.
  for (const receipt of Object.values(authority?.incumbentOrders ?? {}))
    if (receipt.task.source === 'miningDefense') member(receipt.task.taskId, receipt.unitId);
  for (const [hallId, unitIds] of mining) tasks.push({ actor: miningDefenseActor(hallId), targetId: hallId,
    kind: 'local-squad', unitIds: [...unitIds].sort() });
  const expansion = memory.landExpansion;
  if (expansion) tasks.push({ actor: landExpansionActor(expansion), targetId: expansion.mineId, kind: 'land-expansion',
    unitIds: [...new Set([...(expansion.combat?.creep?.group ?? []), ...Object.entries(memory.unitClaims)
      .filter(([, claim]) => claim.expansionMineId === expansion.mineId || claim.kind === 'expansion' && claim.targetId === expansion.mineId).map(([id]) => id)])] });
  for (const [hallId] of Object.entries(memory.expansionGarrisons ?? {})) tasks.push({ actor: expansionGarrisonActor(hallId),
    targetId: hallId, kind: 'local-squad', unitIds: Object.entries(memory.unitClaims)
      .filter(([, claim]) => claim.kind === 'expansionGarrison' && claim.targetId === hallId).map(([id]) => id) });
  for (const [shipId, task] of Object.entries(memory.naval?.ferries ?? {})) tasks.push({ actor: navalFerryActor(shipId, task.sinceTick),
    targetId: task.targetId, kind: 'cross-sea-reinforcement', unitIds: [...new Set([shipId, ...task.crewIds, ...(task.payloadIds ?? [])])] });
  for (const task of Object.values(memory.naval?.conquests ?? {})) tasks.push({ actor: islandConquestActor(task),
    targetId: task.mineId, kind: 'direct-conquest', unitIds: task.combat?.creep?.group ?? [] });
  return tasks.sort((a, b) => key(a.actor) < key(b.actor) ? -1 : key(a.actor) > key(b.actor) ? 1 : 0);
}

/** Receipt-backed progress can belong to the new planner's same terminal
 * effect. Target equality alone is insufficient: attacking a mine's defender,
 * guarding its hall and evacuating its workers are different uses. */
export function continuesImportedProgress(snapshot: GameSnapshot, policy: AiPolicyMemory, authority: StrategyAllocationMemory,
  fromObjectiveId: string, objective: Pick<Objective, 'owner' | 'effects'>): boolean {
  if (objective.owner !== authority.owner) return false;
  const leases = Object.values(authority.leases).filter(lease => lease.objectiveId === fromObjectiveId);
  const actor = leases[0]?.incumbentTask;
  if (!actor || leases.some(lease => lease.origin !== 'imported-task' || !lease.incumbentTask
    || key(lease.incumbentTask) !== key(actor))) return false;
  const task = incumbentTasks(policy, authority).find(task => key(task.actor) === key(actor));
  if (!task || leases.some(lease => !lease.resourceKey.startsWith('unit:') || !snapshot.units.some(unit =>
    unit.id === lease.resourceKey.slice(5) && unit.owner === objective.owner && unit.hp > 0
    && incumbentDisposition(snapshot, unit, authority, actor) === 'incumbent'))) return false;
  const mining = (mineId: string) => objective.effects.some(effect => effect.kind === 'mining-established' && effect.mineId === mineId);
  const defense = (siteId: string) => objective.effects.some(effect => effect.kind === 'site-safe' && effect.siteId === siteId);
  if (actor.source === 'landExpansion' || actor.source === 'naval.conquests') return mining(task.targetId);
  if (actor.source === 'miningDefense') return defense(task.targetId);
  if (actor.source === 'expansionGarrison') {
    const post = policy.expansionGarrisons?.[actor.taskId];
    return defense(task.targetId) || !!post && mining(post.mineId);
  }
  if (actor.source !== 'naval.ferries') return false;
  const ferry = Object.entries(policy.naval?.ferries ?? {}).find(([shipId, task]) => key(navalFerryActor(shipId, task.sinceTick)) === key(actor))?.[1];
  if (!ferry) return false;
  if (ferry.purpose === 'assault') return objective.effects.some(effect => effect.kind === 'entity-destroyed' && effect.entityId === task.targetId);
  if (ferry.purpose === 'reinforce' && defense(task.targetId)) return true;
  // The named mining effect, not a shared sea or land, identifies settlement.
  return ['settle', 'rebase', 'advance', 'reinforce', 'creep'].includes(ferry.purpose)
    && snapshot.resources.some(resource => resource.id === task.targetId) && mining(task.targetId);
}

/** Adoption supplies authority and provenance, not a fabricated price. An old
 * task stays unpriced until a provider can re-quote its actual remaining plan.
 * Its original producer continues through the same command gateway adapter. */
export function importExecutedIncumbents(snapshot: GameSnapshot, policy: AiPolicyMemory,
  situation: DecisionFacts<Situation>, previous: StrategyAllocationMemory): StrategyAllocationMemory {
  let memory = observeIncumbentOrders(previous, snapshot);
  const tasks = incumbentTasks(policy, memory), actors = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const facts = new Map(situation.units.map(unit => [unit.id, unit]));
  const leases = { ...memory.leases }, assignments = { ...memory.assignments };
  // An old task's idle/changed order cannot indefinitely hold an executed lease.
  for (const [resource, lease] of Object.entries(leases)) if (lease.origin === 'imported-task' && resource.startsWith('unit:')) {
    const id = resource.slice(5), unit = actors.get(id), task = tasks.find(task => lease.incumbentTask && key(task.actor) === key(lease.incumbentTask));
    if (!unit || !task || incumbentDisposition(snapshot, unit, memory, task.actor) !== 'incumbent') {
      delete leases[lease.resourceKey]; delete assignments[`assignment:${id}`];
    }
  }
  memory = { ...memory, leases, assignments };
  for (const task of tasks) {
    const members = task.unitIds.filter(id => {
      const unit = actors.get(id);
      return !!unit && !memory.leases[`unit:${id}`] && facts.has(id)
        && incumbentDisposition(snapshot, unit, memory, task.actor) === 'incumbent';
    }).sort();
    if (!members.length) continue;
    const id = `imported:${key(task.actor)}`, methodId = `${id}/method`, actionId = `${methodId}/execute`;
    const entity = [...snapshot.resources, ...snapshot.buildings, ...snapshot.units].find(entity => entity.id === task.targetId);
    const target: Target = situation.assets.find(asset => asset.id === task.targetId)?.target
      ?? { ...(entity ? { entityId: entity.id } : {}), point: entity ? { x: entity.x, y: entity.y } : facts.get(members[0]!)!.location.point };
    const token = memory.executions[actionId]?.token ?? { actionId, generation: memory.nextActionGeneration };
    const firstReceipt = memory.incumbentOrders[members[0]!]!;
    const execution = memory.executions[actionId] ?? { token, objectiveId: id, methodId,
      executor: firstReceipt.executor, intent: { kind: 'recover' as const }, target, dependsOn: [], completionEffects: [],
      status: 'active' as const, phase: 'imported-execution', sinceTick: firstReceipt.acceptedTick, lastProgressTick: snapshot.tick,
      state: { source: task.actor.source, taskId: task.actor.taskId } };
    const nextLeases = { ...memory.leases }, nextAssignments = { ...memory.assignments };
    for (const unitId of members) {
      const unit = facts.get(unitId)!, leaseId = `lease:${unitId}`, assignmentId = `assignment:${unitId}`;
      nextLeases[`unit:${unitId}`] = { id: leaseId, resourceKey: `unit:${unitId}`, objectiveId: id, methodId, action: token,
        sinceTick: memory.incumbentOrders[unitId]!.acceptedTick, minimumStayUntilTick: snapshot.tick,
        origin: 'imported-task', incumbentTask: task.actor };
      nextAssignments[assignmentId] = { authority: 'committed', id: assignmentId, leaseId, unitId, role: unit.roles[0] ?? 'frontline',
        objectiveId: id, methodId, action: token, target, stage: unit.location.kind === 'aboard' ? 'en-route' : 'assigned',
        eta: { status: 'unknown', forecastTick: snapshot.tick, arrivalTick: null,
          reason: { code: 'imported-remaining-plan-unquoted', factIds: [unitId, task.targetId], values: {} } },
        lastLocation: unit.location.kind === 'unknown' ? { ...unit.location,
          reason: { code: unit.location.reason.code, factIds: [unitId], values: {} } } : unit.location, interruption: null };
    }
    memory = { ...memory, leases: nextLeases, assignments: nextAssignments,
      nextActionGeneration: memory.nextActionGeneration + Number(!memory.executions[actionId]),
      executions: { ...memory.executions, [actionId]: execution }, objectives: { ...memory.objectives, [id]: {
        objectiveId: id, methodId, target, effectKeys: [], status: 'active', actionIds: [actionId],
        assignmentIds: Object.values(nextAssignments).filter(assignment => assignment.objectiveId === id).map(assignment => assignment.id).sort(),
        budgetIds: [], sinceTick: firstReceipt.acceptedTick, minimumStayUntilTick: snapshot.tick,
        challengerId: null, challengerThinks: 0, committedUtilityGold: null, force: null } } };
    memory = appendAllocationEvent(memory, { objectiveId: id, methodId, action: token, kind: 'incumbent-adopted',
      leaseIds: members.map(id => `lease:${id}`), reason: { code: 'observed-original-producer-order', factIds: members, values: {} } }, snapshot.tick);
  }
  const objectives = { ...memory.objectives }, executions = { ...memory.executions };
  for (const [id, objective] of Object.entries(objectives)) if (id.startsWith('imported:')
    && !Object.values(memory.leases).some(lease => lease.objectiveId === id)) {
    objectives[id] = { ...objective, status: 'abandoned', assignmentIds: [], committedUtilityGold: null };
    for (const actionId of objective.actionIds) if (executions[actionId]) executions[actionId] = {
      ...executions[actionId]!, status: 'abandoned', phase: 'native-order-no-longer-executing', lastProgressTick: snapshot.tick };
  }
  memory = { ...memory, objectives, executions };
  return memory;
}

/** Formal occupancy is a numerical decision fact. Response/candidate queries
 * must not silently count a leased unit as an unrelated free reinforcement. */
export function withFormalCommitments(situation: DecisionFacts<Situation>, memory: StrategyAllocationMemory): DecisionFacts<Situation> {
  return { ...situation, units: situation.units.map(unit => {
    const lease = memory.leases[`unit:${unit.id}`];
    if (!lease || lease.origin === 'imported-task') return unit;
    const commitments = [...unit.commitments, { source: 'strategyAllocation', objectiveId: lease.objectiveId,
      taskId: lease.action.actionId, role: unit.roles[0] ?? 'frontline' }];
    const row = unitArrivalFacts(unit);
    return row ? withDecisionUnitArrivals({ id: unit.id, owner: unit.owner, kind: unit.kind, location: unit.location,
      hp: unit.hp, maxHp: unit.maxHp, strength: unit.strength, roles: unit.roles, expiresTick: unit.expiresTick, commitments }, row)
      : { ...unit, commitments };
  }) };
}
