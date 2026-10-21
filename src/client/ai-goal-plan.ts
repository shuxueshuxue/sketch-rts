import type { AiPlanTrace } from '../ai/plan-trace';
import type { GoalActionNode, GoalFactPredicate, GoalPlan } from '../ai/strategy/goal-planner-types';
import { allocationReason, stageLabel } from './ai-plan-strategy';
import { planHtml as h, planClock as clock } from './ai-plan-strategy-panel';

const number = (value: number | null | undefined) => value == null ? '—' : String(Number(value.toFixed(2)));
const states: Record<string, string> = { met: '已成立', unmet: '未成立', pending: '等事实',
  ready: '就绪（不代表已执行）', 'waiting-facts': '等事实', 'waiting-actions': '等前置动作',
  'waiting-time': '等可用时刻', blocked: '受阻', 'world-effects-met': '效果已观测',
  complete: '目标效果已成立', 'search-pending': '搜索待续' };
const actionNames: Record<string, string> = { assemble: '集结', 'transport-force': '运兵', 'transport-worker': '运工人',
  'position-transport': '调船', 'clear-camp': '清营', 'clear-shore': '清滩头',
  defend: '回防', evacuate: '撤离', train: '训练', build: '建造', 'wait-income': '等待收入',
  'destroy-target': '摧毁目标', 'hold-position': '驻守', 'engage-units': '交战' };
const factNames: Record<GoalFactPredicate['kind'], string> = {
  'force-at': '兵力到岗', 'force-available': '可调用兵力', 'transport-in': '海域运力', 'transport-at': '运输船到位',
  'shipyard-for': '可下水船厂', production: '生产条件', gold: '可用金币', 'worker-at': '工人到岗',
  'shore-safe': '滩头安全', 'camp-cleared': '营地清空', 'hall-complete': '矿厅完工', 'site-safe': '据点安全',
  'supply-cap': '人口档位', 'population-room': '空余人口', 'build-site': '可建位置', 'spawn-exit': '生产出口',
  route: '可达路线', 'unit-available': '同陆块可调用单位', 'building-complete': '建筑完工',
  'enemy-site-destroyed': '敌方据点摧毁', 'route-controlled': '通路控制', 'harassment-ended': '骚扰结束',
  'interception-capability': '拦截能力', 'assets-safe': '资产安全',
};
export const goalFactLabel = (predicate: GoalFactPredicate) => factNames[predicate.kind];
export const goalActionLabel = (action: GoalActionNode) => actionNames[action.declaration.kind] ?? action.declaration.kind;
const reasonList = (rows: GoalPlan['reasons']) => rows.map(reason => `<p>${h(allocationReason({...reason,factIds:[]}))}</p>${reason.factIds.length?`<details><summary>${reason.factIds.length} 项事实依据</summary><pre>${h(reason.factIds.join('\n'))}</pre></details>`:''}`).join('') || '<p class="plan-muted">原因未记录。</p>';

/** Only a recorded binding to this exact generation grants execution authority. */
export function recordedGoalExecution(trace: AiPlanTrace, action: GoalActionNode) {
  const binding = action.allocation;
  return binding && trace.strategy?.allocation?.executions.find(row => row.objectiveId === binding.objectiveId
    && row.methodId === binding.methodId && row.token.actionId === binding.actionId && row.token.generation === binding.generation);
}
export function recordedGoalAssignments(trace: AiPlanTrace, action: GoalActionNode) {
  const binding = action.allocation;
  return binding ? trace.strategy?.allocation?.assignments.filter(row => row.objectiveId === binding.objectiveId
    && row.methodId === binding.methodId && row.action.actionId === binding.actionId && row.action.generation === binding.generation) ?? [] : [];
}

type LayoutNode = { id: string; kind: 'goal' | 'fact' | 'action'; x: number; y: number };
type Layout = { nodes: LayoutNode[]; edges: { from: string; to: string; kind: string }[]; width: number; height: number; omitted: number };
const layouts = new WeakMap<GoalPlan, Layout>();
/** Layout uses connectivity only. Arrow direction and dependency meaning stay exactly as recorded. */
function layout(plan: GoalPlan): Layout {
  const old = layouts.get(plan); if (old) return old;
  const root = '$goal', facts = plan.facts.map(row => ({ id: row.id, kind: 'fact' as const }));
  const actions = plan.actions.map(row => ({ id: row.id, kind: 'action' as const }));
  const rows = [{ id: root, kind: 'goal' as const }, ...facts, ...actions].slice(0, 201);
  const ids = new Set(rows.map(row => row.id));
  const effects = new Set(plan.goal.effects.map(effect => effect.id));
  const edges = [...plan.edges, ...plan.facts.filter(row => effects.has(row.observation.fact.id))
    .map(row => ({ from: root, to: row.id, kind: 'goal-effect' }))].filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const adjacency = new Map(rows.map(row => [row.id, [] as string[]]));
  for (const edge of edges) { adjacency.get(edge.from)!.push(edge.to); adjacency.get(edge.to)!.push(edge.from); }
  const depth = new Map([[root, 0]]), queue = [root];
  for (let i = 0; i < queue.length; i++) for (const id of adjacency.get(queue[i]!) ?? []) {
    if (!depth.has(id)) { depth.set(id, depth.get(queue[i]!)! + 1); queue.push(id); }
  }
  const last = Math.max(...depth.values()) + 1, counts = new Map<number, number>();
  const nodes = rows.map(row => {
    const column = depth.get(row.id) ?? last, index = counts.get(column) ?? 0;
    counts.set(column, index + 1);
    return { ...row, x: 18 + column * 238, y: 18 + index * 150 };
  });
  const value = { nodes, edges, width: Math.max(500, ...nodes.map(node => node.x + 220)),
    height: Math.max(220, ...nodes.map(node => node.y + 140)), omitted: facts.length + actions.length + 1 - rows.length };
  layouts.set(plan, value); return value;
}

export function goalPlanGraph(plan: GoalPlan, trace: AiPlanTrace, selected = '$goal'): string {
  const graph = layout(plan), index = new Map(graph.nodes.map(node => [node.id, node]));
  const facts = new Map(plan.facts.map(row => [row.id, row]));
  const actions = new Map(plan.actions.map(row => [row.id, row]));
  const edges = graph.edges.map(edge => {
    const from = index.get(edge.from)!, to = index.get(edge.to)!;
    const dx = to.x - from.x, dy = to.y - from.y;
    const inset = Math.min(dx ? 108 / Math.abs(dx) : Infinity, dy ? 64 / Math.abs(dy) : Infinity, .49);
    return `<path class="goal-edge ${h(edge.kind)}" marker-end="url(#goal-dependency-arrow)" d="M${from.x + 106 + dx * inset} ${from.y + 62 + dy * inset} L${to.x + 106 - dx * inset} ${to.y + 62 - dy * inset}"><title>${h(edge.kind)} · ${h(edge.from)} → ${h(edge.to)}</title></path>`;
  }).join('');
  const cards = graph.nodes.map(node => {
    let title: string, state: string, detail: string;
    if (node.kind === 'goal') {
      title = plan.goal.effects.map(effect => goalFactLabel(effect.predicate)).join('、'); state = plan.status;
      detail = `目标 ${plan.goal.id} · 价值 ${number(plan.valueGold)} 金`;
    } else if (node.kind === 'fact') {
      const fact = facts.get(node.id)!.observation;
      title = goalFactLabel(fact.fact.predicate); state = fact.state;
      detail = fact.state === 'pending' ? `请求 ${fact.requestId}` : fact.availableTick != null && fact.availableTick > trace.tick
        ? `${clock(fact.availableTick)} 才可用（当前未到时刻）` : allocationReason({...fact.reason,factIds:[]});
    } else {
      const action = actions.get(node.id)!;
      const execution = recordedGoalExecution(trace, action);
      title = goalActionLabel(action); state = action.state;
      detail = execution ? `执行记录 ${execution.executor} · ${execution.phase} · ${stageLabel(execution.status)}`
        : `计划 ${action.declaration.executor.executor} · 执行未记录`;
    }
    return `<button class="goal-graph-node ${node.kind} ${h(state)}" data-plan-node="${h(node.id)}" aria-pressed="${selected === node.id}" style="left:${node.x}px;top:${node.y}px"><small>${node.kind === 'goal' ? '目标' : node.kind === 'fact' ? '世界条件' : '推导动作'} · ${h(states[state] ?? state)}</small><strong>${h(title)}</strong><span>${h(detail)}</span></button>`;
  }).join('');
  return `<section class="plan-dependency-sheet" data-graph-plan="${h(plan.id)}"><header><div><small>目标 → 条件 → 动作 → 执行 → 结果</small><h3>计划依赖图 · ${h(plan.goal.id)}</h3></div><button data-action="goal-graph">收起依赖图</button></header><div class="goal-graph-viewport" tabindex="0" aria-label="滚动查看计划依赖图"><div class="goal-graph-canvas" style="width:${graph.width}px;height:${graph.height}px"><svg width="${graph.width}" height="${graph.height}" aria-hidden="true"><defs><marker id="goal-dependency-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7"/></marker></defs>${edges}</svg>${cards}</div></div><footer>箭头依照记录的 requires / establishes / resource-before；点击节点核对详情。${graph.omitted > 0 ? `当前展开前 200 个节点，另 ${graph.omitted} 个未展开。` : ''}</footer></section>`;
}

export function goalPlanDetail(plan: GoalPlan, trace: AiPlanTrace, selected = '$goal'): string {
  const fact = plan.facts.find(row => row.id === selected), action = plan.actions.find(row => row.id === selected);
  const head = `<small>规划器记录 · ${clock(plan.observedTick)}</small><h3>${h(plan.goal.effects.map(effect=>goalFactLabel(effect.predicate)).join('、')||plan.goal.id)}</h3><small>${h(plan.goal.id)}</small><p>${h(states[plan.status] ?? plan.status)}</p>`;
  if (fact) {
    const observation = fact.observation;
    const alternatives = plan.alternatives.filter(row => row.factId === fact.id || row.factId === observation.fact.id);
    return `${head}<h4>条件：${h(goalFactLabel(observation.fact.predicate))}</h4><p>${h(states[observation.state])}</p>
      ${observation.state === 'pending' ? `<p class="plan-blocked">等事实 · ${h(observation.requestId)}<br>请求于 ${clock(observation.requestedTick)}，不视作失败。</p>` : ''}
      ${observation.availableTick != null ? `<p>可用时刻 ${clock(observation.availableTick)}${observation.availableTick > trace.tick ? ' · 当前尚不可用' : ''}</p>` : ''}
      ${reasonList([observation.reason])}<h4>满足它的候选方案</h4>${alternatives.map(row => `<div class="plan-child"><b>${row.status === 'chosen' ? '选中' : row.status === 'rejected' ? '落选' : '等待评估'} · ${h(row.actionId)}</b><br>成本 ${number(row.costGold)} 金 · 预计完成 ${row.finishTick == null ? '—' : clock(row.finishTick)}${reasonList([row.reason])}</div>`).join('') || '<p>候选未记录，不补推方案。</p>'}
      <h4>世界事实与证据</h4><details><summary>查看结构化字段</summary><pre>${h(JSON.stringify({ predicate: observation.fact.predicate,
        quantity: observation.quantity, entityIds: observation.entityIds, route: observation.route,
        goldForecast: observation.goldForecast, site: observation.site, interception: observation.interception }, null, 2))}</pre></details>`;
  }
  if (action) {
    const execution = recordedGoalExecution(trace, action), assignments = recordedGoalAssignments(trace, action);
    const budgets=action.allocation?trace.strategy?.allocation?.budget.filter(row=>row.objectiveId===action.allocation!.objectiveId
      &&row.methodId===action.allocation!.methodId&&row.action.actionId===action.allocation!.actionId
      &&row.action.generation===action.allocation!.generation)??[]:[];
    const receipts = action.allocation ? trace.strategy?.allocation?.commandAdmissions?.filter(row =>
      row.action?.actionId === action.allocation!.actionId && row.action.generation === action.allocation!.generation) ?? [] : [];
    return `${head}<h4>动作：${h(goalActionLabel(action))}</h4><p>${h(states[action.state])}</p>
      <h4>为了让什么成立</h4>${action.declaration.effects.map(effect => `<p>${h(effect.operation)} · ${h(goalFactLabel(effect.fact.predicate))}</p>`).join('')}
      <h4>依赖的事实与动作</h4>${action.prerequisiteFactIds.map(id=>{const fact=plan.facts.find(row=>row.id===id||row.observation.fact.id===id);return `<button class="plan-list" data-plan-node="${h(fact?.id??id)}">${h(fact?goalFactLabel(fact.observation.fact.predicate):id)} · ${fact?h(states[fact.observation.state]):'未记录条件节点'}</button>`;}).join('')||'<p>无前置事实。</p>'}
      ${action.dependsOnActionIds.map(id=>{const previous=plan.actions.find(row=>row.id===id);return `<button class="plan-list" data-plan-node="${h(id)}">${h(previous?goalActionLabel(previous):id)} · 前置动作</button>`;}).join('')}${reasonList(action.reasons)}
      <h4>计划执行器</h4><p>${h(action.declaration.executor.executor)}</p>
      <details><summary>声明参数与未来产物（非当前实体）</summary><pre>${h(JSON.stringify({parameters:action.declaration.executor.parameters,outputs:action.declaration.outputs},null,2))}</pre></details>
      <details><summary>动作的计划资源需求与收支</summary><pre>${h(JSON.stringify({demands:action.declaration.demands,flows:action.declaration.flows,cost:action.declaration.cost},null,2))}</pre></details>
      <h4>正式执行记录</h4>
      ${execution ? `<p>${h(execution.executor)} · ${h(execution.phase)} · ${h(stageLabel(execution.status))}<br>${h(execution.token.actionId)} #${execution.token.generation}</p>` : '<p class="plan-muted">未记录执行回执。就绪或计划绑定不等于已经执行。</p>'}
      <p>${assignments.length} 名正式分配</p>${assignments.map(row => `<p class="plan-unit-ids">${h(row.unitId)} · ${h(stageLabel(row.stage))}${row.interruption ? ' · 救命中断，当前不可用' : ''}</p>`).join('')}
      <h4>同代次正式预算</h4>${budgets.map(row=>`<p>${h(row.spendId)} · ${h(row.state)}<br>额度 ${number(row.amountGold)} 金 · 已支付 ${number(row.paidGold)} 金</p>`).join('')||'<p class="plan-muted">未记录正式预算。</p>'}
      <h4>本次命令接纳记录</h4>${receipts.map(row=>`<p>${h(row.source)} · ${h(row.executor)} · ${h(row.commandId)}<br>${row.status==='accepted'?`已接纳于 ${clock(row.admittedTick)} · 排队时刻 ${row.queuedTick==null?'—':clock(row.queuedTick)}`:`拒绝 · ${h(row.reason.reason)}`}</p>`).join('')||'<p class="plan-muted">本次未记录同代次接纳回执。</p>'}<p class="plan-muted">命令接纳与排队不证明已生效，效果仍看世界事实。</p>
      <h4>预计与结果</h4><p>预计 ${action.startTick == null ? '—' : clock(action.startTick)} → ${action.finishTick == null ? '—' : clock(action.finishTick)}</p>
      <p>${action.state === 'world-effects-met' ? '世界效果已观测；证据见相应事实节点。' : '效果尚未证实，不从命令接受推断完成。'}</p>`;
  }
  return `${head}<h4>想得到什么</h4>${plan.goal.effects.map(effect => `<p>${h(goalFactLabel(effect.predicate))}<br><small>${h(effect.id)}</small></p>`).join('')}${reasonList(plan.goal.reasons)}
    <h4>条件、方案、执行与结果</h4><p>左侧点击事实可比较落选方案，点击动作可核对实际执行。</p>
    <p>${plan.facts.filter(row => row.observation.state === 'unmet').length} 个未成立 · ${plan.facts.filter(row => row.observation.state === 'pending').length} 个等事实</p>
    <p>${plan.readyActionIds.length} 个规划就绪动作 · 本次向分配器提供 ${trace.goalPlanner?.readyActions.filter(row=>row.planId===plan.id&&row.goalId===plan.goal.id).length??0} 个<br>不代表已经分配或执行。</p>
    <h4>计划估值</h4><p>成本 ${number(plan.costGold)} · 成功概率 ${plan.successProbability == null ? '—' : `${number(plan.successProbability * 100)}%`} · 价值 ${number(plan.valueGold)}</p>
    <h4>规划数量与时间账本</h4><p class="plan-muted">此表是计划推算；实际支出由原生回执证明。</p>${plan.resourceTimeline.slice(0,96).map(row => `<p>${clock(row.tick)} · ${h(row.resource.kind)}<br>${number(row.before)} ${row.delta >= 0 ? '+' : ''}${number(row.delta)} = ${number(row.after)}<br><small>${h(row.actionId)}</small></p>`).join('') || '<p>未记录数量账本。</p>'}${plan.resourceTimeline.length>96?`<p>另 ${plan.resourceTimeline.length-96} 项保留在录制中。</p>`:''}
    <h4>结果</h4><p>${plan.status === 'complete' && plan.completedTick != null ? `目标效果于 ${clock(plan.completedTick)} 成立。` : '目标效果未证实，实际完成时刻 —'}</p>
    <h4>搜索状态</h4><p>${plan.search.expansions} 次展开 · 深度 ${plan.search.depth} · 工作量 ${plan.search.work}<br>${h(plan.search.limitReason ?? '未触及已记录上限')}</p>${reasonList(plan.reasons)}`;
}
