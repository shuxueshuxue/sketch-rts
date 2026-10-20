import { isRangedUnit } from "../shared/unit-weapon-class";
import { unitMover } from '../shared/catalog';
import { isTransportKind } from '../shared/transport-role';
import type { UnitOrder } from '../shared/types';
import type { AiUnitDeathRecord } from './death-ledger-types';
import type { DeathAttributionContext, Evidence, Location, UnitRole } from './strategy/types';

/** Formal IDs come only from a validated assignment; the actual native order's
 * issuer remains distinct from the executor planned for that assignment. */
export function deathAttributionContext(record: Pick<AiUnitDeathRecord,
  'tick' | 'unit' | 'location' | 'assignment' | 'currentOrder' | 'currentOrderIssuer'>): DeathAttributionContext {
  const { unit, assignment, currentOrderIssuer: issuer } = record;
  const formal = assignment.task?.attribution === 'assignment' ? assignment.task.formal : undefined;
  const point = { x: unit.x, y: unit.y }, facts = record.location;
  const evidence: Evidence[] = assignment.evidence.map(source => ({ source, tick: assignment.observedTick,
    certainty: formal && source === 'strategyAllocation.assignments' ? 'recorded' : 'inferred',
    detail: formal && source === 'strategyAllocation.assignments' ? '正式分配、资源租用与当前行动代次已核对；不是实际订单发令证明'
      : '旧 claim/任务记忆推断；没有正式目标、方法或分配记录' }));
  let location: Location;
  if ((facts.space === 'deck' || facts.space === 'cabin') && facts.carrierId && facts.seaId)
    location = { kind: 'aboard', point, shipId: facts.carrierId, seaId: facts.seaId, compartment: facts.space };
  else if (facts.landId) location = { kind: 'land', point, landId: facts.landId };
  else if (facts.seaId) location = { kind: 'sea', point, seaId: facts.seaId };
  else location = { kind: 'unknown', point, reason: { code: 'component-unknown',
    detail: 'groundWholeAt 未返回可用陆块/海域标签；原始位置/船舱/驻守信息仍保留在账本', evidence: [] } };
  const role: UnitRole = unit.kind === 'worker' ? 'worker' : unitMover(unit.kind) === 'sea'
    ? isTransportKind(unit.kind) ? 'transport' : 'warship' : ['priest', 'fieldMedic'].includes(unit.kind)
      ? 'healer' : isRangedUnit(unit) ? 'ranged' : 'frontline';
  const tasks = [assignment.task, ...assignment.otherTaskCandidates].filter(task => task !== null);
  if (!issuer?.executor) evidence.push({ source: 'sim.command', tick: record.tick, certainty: 'unknown',
    detail: '当前订单没有可匹配的实际下令执行器；自动接敌和队列转换未冒充已记录执行器' });
  return { objectiveId: formal?.objectiveId ?? null, methodId: formal ? assignment.task!.methodId : null,
    assignmentId: formal?.assignmentId ?? null,
    ...(formal ? { action: { ...formal.action }, executionPhase: formal.executionPhase,
      plannedExecutor: formal.plannedExecutor, allocationRevision: formal.allocationRevision } : {}),
    task: assignment.task ? { source: assignment.task.source, id: assignment.task.id } : null,
    assignmentStage: assignment.state === 'unassigned' ? null : assignment.state === 'emergency-interruption'
      ? 'life-saving-interruption' : assignment.state,
    executor: issuer?.executor ?? null, provenance: formal ? 'assignment' : assignment.task ? 'inferred' : 'unknown',
    commitments: tasks.map(task => ({ source: task.source, objectiveId: task.formal?.objectiveId ?? null, taskId: task.id, role,
      evidence: { source: task.source, tick: assignment.observedTick,
        certainty: task.attribution === 'assignment' ? 'recorded' : 'inferred',
        detail: task.attribution === 'assignment' ? '已核对正式分配与有效租用' : '旧状态任务候选；不是分配器的正式占用' } })),
    order: structuredClone(record.currentOrder) as UnitOrder, issuedCommand: issuer?.command ?? null,
    orderTick: issuer?.tick ?? null, location, evidence };
}
