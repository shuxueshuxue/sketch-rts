import type { GameSnapshot, PlayerId } from '../shared/types';
import type { AiPolicyMemory } from './memory';
import type { AiDeathTask } from './death-ledger-types';
import { sameAction } from './strategy/control';
import { GOLD_MINE_RULES } from '../shared/mining';
import { sameGround } from '../shared/terrain';

/** Copy formal facts only. An old claim, a proposed plan or a stale action
 * generation is never promoted to a committed assignment by observation. */
export function formalDeathTasks(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory): [string, AiDeathTask][] {
  const allocation = memory.strategyAllocation;
  if (!allocation || allocation.owner !== owner) return [];
  const result: [string, AiDeathTask][] = [];
  const ownIds = new Set(snapshot.units.filter(unit => unit.owner === owner).map(unit => unit.id));
  for (const assignment of Object.values(allocation.assignments)) {
    const lease = allocation.leases[`unit:${assignment.unitId}`], objective = allocation.objectives[assignment.objectiveId];
    const execution = allocation.executions[assignment.action.actionId];
    if (assignment.authority !== 'committed' || !ownIds.has(assignment.unitId) || !lease || !objective || !execution
      || lease.id !== assignment.leaseId || lease.resourceKey !== `unit:${assignment.unitId}`
      || lease.objectiveId !== assignment.objectiveId || lease.methodId !== assignment.methodId
      || objective.methodId !== assignment.methodId || execution.objectiveId !== assignment.objectiveId
      || execution.methodId !== assignment.methodId || !sameAction(lease.action, assignment.action)
      || !sameAction(execution.token, assignment.action) || ['complete', 'failed', 'abandoned'].includes(objective.status)
      || ['complete', 'failed', 'abandoned'].includes(execution.status)) continue;
    const intent = execution.intent.kind;
    const clearing = intent === 'clear-camp' && execution.status === 'active' && assignment.interruption === null;
    const defense = ['defend-site', 'recall', 'wait-in-cover', 'establish-garrison'].includes(intent);
    const hallId = objective.target.entityId;
    const hall = defense && snapshot.buildings.find(building => building.owner === owner && building.hp > 0
      && building.kind === 'townHall' && (building.id === hallId || intent === 'establish-garrison'
        && sameGround(snapshot.map, building, objective.target.point)
        && Math.hypot(building.x - objective.target.point.x, building.y - objective.target.point.y) <= GOLD_MINE_RULES.baseRange));
    const interruption = assignment.interruption;
    const kind = ['deliver-force', 'deliver-workers', 'load', 'sail', 'unload'].includes(intent) ? 'transport' : intent;
    result.push([assignment.unitId, { id: assignment.objectiveId, kind, targetId: execution.target.entityId ?? null,
      stage: execution.phase, source: 'strategyAllocation.assignments', attribution: 'assignment',
      methodId: assignment.methodId, utility: objective.committedUtilityGold,
      combat: defense || ['clear-camp', 'attack-site', 'contest-route', 'counter-harass', 'establish-force'].includes(intent),
      clearing, ...(execution.intent.kind === 'clear-camp' ? { clearingTargetIds: [...execution.intent.memberIds] } : {}),
      perimeter: hall ? { x: hall.x, y: hall.y, radius: 650 } : null,
      formal: { objectiveId: assignment.objectiveId, assignmentId: assignment.id, action: { ...assignment.action },
        allocationRevision: allocation.revision, executionPhase: execution.phase, plannedExecutor: execution.executor,
        assignmentStage: assignment.stage, interruption: interruption ? { kind: interruption.kind,
          executor: interruption.executor, sinceTick: interruption.sinceTick } : null } }]);
  }
  return result;
}
