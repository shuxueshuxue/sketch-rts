import type { AiPlanNode, AiPlanTrace } from '../ai/plan-trace';
import type { AllocationEvent, AllocationReason, ObjectiveAllocation } from '../ai/strategy/allocation-types';
import type { Objective, ResourceDemand } from '../ai/strategy/types';
import type { GoalPlan } from '../ai/strategy/goal-planner-types';
import { goalFactLabel, recordedGoalAssignments, recordedGoalExecution } from './ai-goal-plan';

export type PlanViewNode = Omit<AiPlanNode, 'status'> & {
  status: string;
  strategy?: { objectiveId: string; quote?: Objective; allocation?: ObjectiveAllocation };
  goalPlan?: GoalPlan;
};
export type PlanAllocationEvent = { owner: string; event: AllocationEvent; observedTick: number; session: number };
export const strategyGoalId = (id: string) => `strategy/${id}`;
export const plannerGoalId = (id: string) => `goalPlanner/${id}`;
export function traceObjectiveNodeId(trace: AiPlanTrace | undefined, objectiveId: string) {
  const plan=trace?.goalPlanner?.plans.find(row=>row.goal.id===objectiveId
    ||row.actions.some(action=>action.allocation?.objectiveId===objectiveId));
  return plan?plannerGoalId(plan.id):strategyGoalId(objectiveId);
}
export const allocationEventId = (entry: PlanAllocationEvent) => `allocation/${entry.owner}/${entry.event.id}`;
const cache = new WeakMap<AiPlanTrace, PlanViewNode[]>();
const families: Record<Objective['kind'], { label: string; kind: AiPlanNode['kind'] }> = {
  DefendSite: { label: '守卫据点', kind: 'defense' }, RecoverSite: { label: '夺回据点', kind: 'defense' },
  ExpandLand: { label: '建立分矿', kind: 'expansion' }, ConquerIsland: { label: '夺取岛屿', kind: 'island' },
  ReinforceFront: { label: '增援前线', kind: 'delivery' }, AttackSite: { label: '进攻据点', kind: 'attack' },
  ContestRoute: { label: '争夺通路', kind: 'pressure' }, CounterHarass: { label: '驱赶骚扰', kind: 'defense' },
  Evacuate: { label: '撤离', kind: 'transport' },
};

/** An observed old task or a proposed quote never becomes a formal troop assignment. */
export function planViewNodes(trace: AiPlanTrace): PlanViewNode[] {
  const cached = cache.get(trace);
  if (cached) return cached;
  const strategy = trace.strategy;
  const quotes = new Map(strategy?.objectives.map(goal => [goal.id, goal]));
  const allocations = new Map(strategy?.allocation?.objectives.map(goal => [goal.objectiveId, goal]));
  const result: PlanViewNode[] = [...new Set([...allocations.keys(), ...quotes.keys()])].map(objectiveId => {
    const quote = quotes.get(objectiveId), allocation = allocations.get(objectiveId);
    const family = quote ? families[quote.kind] : { label: objectiveId, kind: 'task' as const };
    const target = allocation?.target ?? quote!.target;
    const assignments = strategy?.allocation?.assignments.filter(row => row.objectiveId === objectiveId) ?? [];
    return {
      id: strategyGoalId(objectiveId), kind: family.kind, label: family.label,
      source: allocation ? 'strategy.allocation' : 'strategy.quote', status: allocation?.status ?? quote!.status,
      selected: !!allocation, target: { position: target.point, ...(target.entityId ? { entityId: target.entityId } : {}) },
      utility: { score: quote?.utility.score ?? null, source: quote ? 'planner' : 'not-recorded', terms: [] },
      reasons: (quote?.reasons ?? []).map(reason => ({ code: reason.code, detail: reason.detail, source: 'strategy' })),
      requirements: [
        ...(strategy?.blockedObjectives.find(row => row.objectiveId === objectiveId)?.missingPreconditions ?? [])
          .map(condition => ({ code: condition.preconditionId, detail: condition.reason.detail, met: condition.status === 'unmet' ? false : null })),
        ...(strategy?.allocation?.blocked.filter(row => row.objectiveId === objectiveId) ?? [])
          .flatMap(row => row.missingPreconditions.map(condition => ({ code: condition.id,
            detail: allocationReason(condition.reason), met: condition.status === 'met' ? true : condition.status === 'unmet' ? false : null }))),
      ],
      resources: { unitIds: [...new Set(assignments.map(row => row.unitId))], gold: { reserved: null, required: null } },
      children: [], sinceTick: allocation?.sinceTick ?? quote!.sinceTick,
      strategy: { objectiveId, ...(quote ? { quote } : {}), ...(allocation ? { allocation } : {}) },
    };
  });
  for (const plan of trace.goalPlanner?.plans ?? []) {
    const matched = result.find(node => node.strategy?.objectiveId === plan.goal.id);
    const resources = { unitIds: [...new Set(plan.actions.flatMap(action => recordedGoalAssignments(trace, action).map(row => row.unitId)))],
      gold: { reserved: null, required: null } };
    if (matched) { matched.id=plannerGoalId(plan.id);matched.source='goalPlanner';matched.goalPlan = plan; matched.status = plan.status; matched.resources = resources;
      matched.utility={score:plan.valueGold,source:'planner',terms:[]};delete matched.sinceTick; }
    else {
      const effect = plan.goal.effects[0]?.predicate;
      const target = effect && 'at' in effect ? effect.at : effect && 'site' in effect ? effect.site : undefined;
      result.push({ id: plannerGoalId(plan.id), kind: effect?.kind === 'hall-complete' ? 'expansion' : effect?.kind === 'site-safe' ? 'defense' : 'task',
        label: plan.goal.effects.map(fact => goalFactLabel(fact.predicate)).join('、') || plan.goal.id, source: 'goalPlanner', status: plan.status,
        selected: true, target: target ? { position: target.point, ...(target.entityId ? { entityId: target.entityId } : {}) } : {},
        utility: { score: plan.valueGold, source: 'planner', terms: [] },
        reasons: plan.reasons.map(reason => ({ code: reason.code, detail: allocationReason(reason), source: 'goalPlanner' })),
        requirements: plan.facts.filter(row => row.observation.state !== 'met').map(row => ({ code: row.id,
          detail: `${goalFactLabel(row.observation.fact.predicate)} · ${row.observation.state === 'pending' ? '等事实' : '未成立'}`,
          met: row.observation.state === 'pending' ? null : false })), resources, children: [], goalPlan: plan });
    }
  }
  result.push(...trace.roots.flatMap(id => { const node = trace.nodes.find(node => node.id === id); return node ? [node] : []; }));
  cache.set(trace, result);
  return result;
}

export const planStatus: Record<string, string> = {
  candidate: '候选', proposed: '报价', selected: '已选方法', assigned: '已分配', 'en-route': '在途', 'on-station': '已到岗',
  active: '执行中', ready: '就绪', waiting: '等待', paused: '暂停', blocked: '受阻', complete: '完成', done: '完成',
  failed: '失败', abandoned: '放弃', released: '不再保留（结果未记录）',
  'waiting-facts': '等事实', 'waiting-actions': '等前置动作', 'waiting-time': '等可用时刻',
  'search-pending': '搜索待续', 'world-effects-met': '世界效果已观测',
};
export const stageLabel = (stage: string) => planStatus[stage] ?? stage;
export function allocationReason(reason: AllocationReason): string {
  const values = Object.entries(reason.values).map(([key, value]) => `${key}=${value ?? '—'}`).join(' · ');
  return `${reason.code}${values ? ` · ${values}` : ''}${reason.factIds.length ? ` · 依据 ${reason.factIds.join('、')}` : ''}`;
}
export function demandLabel(demand: ResourceDemand): string {
  switch (demand.kind) {
    case 'force': return `${demand.metric === 'camp-force' ? '清营战力' : '野战战力'} ${demand.strength} · ${demand.roles.join('、')}`;
    case 'gold': return `金币 ${demand.amount}`;
    case 'supply': return `人口 ${demand.amount}`;
    case 'workers': return `工人 ${demand.count} 名`;
    case 'transport': return `运输载重 ${demand.payloadMass} · ${demand.seaId}`;
    case 'production': return `${demand.unitKind} × ${demand.count}`;
  }
}
export function allocationEventLabel(event: AllocationEvent): string {
  switch (event.kind) {
    case 'preempted': return `抢占 ${event.quotation.fromObjectiveId} → ${event.quotation.toObjectiveId} · ${event.quotation.resourceKeys.join('、')} · ${event.handoff}`;
    case 'lease-transferred': return `交接 ${event.fromObjectiveId} → ${event.toObjectiveId}`;
    case 'incumbent-adopted': return '接管原有任务';
    case 'valuation-bound-selected': return `采用估值边界 · ${event.basis.kind} · ${event.scoreGold}`;
    case 'candidate-reassigned': return `从旧任务重新分配 · ${event.fromTask.source} / ${event.fromTask.taskId}`;
    case 'interrupted': return `救命中断 · ${event.assignmentId}`;
    case 'resumed': return `恢复原任务 · ${event.assignmentId}`;
    case 'vacancy-filled': return `补齐空缺 · ${event.vacancyId}`;
    case 'assignment-stage': return `${event.assignmentId} · ${stageLabel(event.from)} → ${stageLabel(event.to)}`;
    case 'action-blocked': return `执行受阻 · ${event.quoteId}`;
    case 'parent-invalidated': return '父行动失效，释放兵力与预算';
    case 'voyage-reevaluated': return `航次重估 · ${event.decision}`;
    case 'action-finished': return stageLabel(event.outcome);
    case 'progress': return `实际进展 · ${event.progress}`;
  }
}
export function eventMatchesObjective(event: AllocationEvent, objectiveId: string): boolean {
  if (event.objectiveId === objectiveId) return true;
  if (event.kind === 'preempted') return event.quotation.fromObjectiveId === objectiveId || event.quotation.toObjectiveId === objectiveId;
  return event.kind === 'lease-transferred' && (event.fromObjectiveId === objectiveId || event.toObjectiveId === objectiveId);
}

export function planPhase(trace: AiPlanTrace, node: PlanViewNode): { phase: string; reason: string } {
  if (node.goalPlan) {
    const executions = node.goalPlan.actions.flatMap(action => { const actual = recordedGoalExecution(trace, action); return actual ? [actual] : []; });
    return { phase: executions.map(action => `${action.phase} (${stageLabel(action.status)})`).join(' / ') || stageLabel(node.goalPlan.status),
      reason: node.goalPlan.reasons.map(allocationReason).join('；') };
  }
  if (!node.strategy) return { phase: trace.nodes.find(child => node.children.includes(child.id))?.label ?? node.reasons[0]?.code ?? node.status,
    reason: node.reasons.map(reason => reason.detail).join('；') };
  const allocation = trace.strategy?.allocation, id = node.strategy.objectiveId;
  const actions = allocation?.executions.filter(action => action.objectiveId === id) ?? [];
  const current = actions.filter(action => !['complete', 'failed', 'abandoned'].includes(action.status));
  return { phase: current.map(action => `${action.phase} (${stageLabel(action.status)})`).join(' / ') || stageLabel(node.status),
    reason: allocation?.blocked.filter(quote => quote.objectiveId === id).map(quote => quote.reason.reason).join('；')
      || node.reasons.map(reason => reason.detail).join('；') };
}
