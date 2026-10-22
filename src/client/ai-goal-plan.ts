import { goalGanttGraph } from './ai-goal-plan-gantt';
import type { AiPlanTrace } from '../ai/plan-trace';
import type { GoalActionNode, GoalPlan } from '../ai/strategy/goal-planner-types';
import { planHtml as h, planClock as clock } from './ai-plan-strategy-panel';
import { goalFactLabel, goalFactSummary, goalDeclarationLabel, goalStates as states,
  goalReasonText, goalPhaseText, goalNumber as number } from './ai-goal-plan-words';
import { recordedGoalExecution, recordedGoalAssignments, recordedGoalBudgets } from './ai-goal-plan-records';
import { goalGraphLayout, GOAL_CARD, type GoalGraphOrder } from './ai-goal-plan-layout';
import { goalResourceBand } from './ai-goal-plan-resources';
export { goalFactLabel, recordedGoalExecution, recordedGoalAssignments };
export const goalActionLabel = (action: GoalActionNode) => goalDeclarationLabel(action.declaration);
const raw = (value: unknown) => `<details class="goal-raw"><summary>查看结构化字段</summary><pre>${h(JSON.stringify(value, null, 2))}</pre></details>`;
const reasonList = (rows: GoalPlan['reasons']) => rows.map(reason => `<p>${h(goalReasonText(reason))}</p>`).join('') || '<p>—</p>';
const stage = (value: string) => ({ assigned: '待出发', 'en-route': '在途', 'on-station': '已到岗', active: '执行中',
  blocked: '受阻', complete: '已完成', failed: '失败', abandoned: '已放弃', reserved: '已预留', spent: '已支付', released: '已释放' } as Record<string,string>)[value] ?? '—';

export function goalPlanGraph(plan: GoalPlan, trace: AiPlanTrace, selected = '$goal', order: GoalGraphOrder = 'time'): string {
  if(order==='time')return goalGanttGraph(plan,trace,selected);
  const graph = goalGraphLayout(plan), index = new Map(graph.nodes.map(node => [node.id, node]));
  const facts = new Map(plan.facts.map(row => [row.id, row])), actions = new Map(plan.actions.map(row => [row.id, row]));
  const edges = graph.edges.map(edge => {
    const from = index.get(edge.from)!, to = index.get(edge.to)!;
    const height = GOAL_CARD.height;
    const horizontal = to.x >= from.x + GOAL_CARD.width;
    const sx = horizontal ? from.x + GOAL_CARD.width : from.x + GOAL_CARD.width/2;
    const tx = horizontal ? to.x : to.x + GOAL_CARD.width/2;
    const sy = horizontal ? from.y + height/2 : from.y + (to.y >= from.y ? height : 0);
    const ty = horizontal ? to.y + height/2 : to.y + (to.y >= from.y ? 0 : height);
    const curve = horizontal ? `C${(sx+tx)/2} ${sy} ${(sx+tx)/2} ${ty} ${tx} ${ty}`
      : `C${sx} ${(sy+ty)/2} ${tx} ${(sy+ty)/2} ${tx} ${ty}`;
    return `<path class="goal-edge ${h(edge.kind)}" data-record-from="${h(edge.recordFrom)}" data-record-to="${h(edge.recordTo)}" marker-end="url(#goal-dependency-arrow)" d="M${sx} ${sy} ${curve}"/>`;
  }).join('');
  const cards = graph.nodes.map(node => {
    let title: string, state: string, detail: string;
    if (node.kind === 'goal') {
      title = plan.goal.effects.map(effect => goalFactLabel(effect.predicate)).join('、'); state = plan.status;
      detail = `价值 ${number(plan.valueGold)} 金`;
    } else if (node.kind === 'fact') {
      const fact = facts.get(node.recordId)!.observation;
      title = goalFactLabel(fact.fact.predicate); state = fact.state;
      detail = fact.availableTick != null && fact.availableTick > trace.tick ? `${clock(fact.availableTick)} 才可用` : goalFactSummary(fact);
    } else {
      const action = actions.get(node.recordId)!, execution = recordedGoalExecution(trace, action);
      title = goalActionLabel(action); state = action.state;
      detail = execution ? goalPhaseText(execution.phase) : action.startTick == null ? '—' : `预计 ${clock(action.startTick)} 开始`;
    }
    return `<button class="goal-graph-node ${node.kind} ${h(state)}" data-layout-id="${h(node.id)}" data-plan-node="${h(node.recordId)}"  aria-pressed="${selected === node.recordId}" style="left:${node.x}px;top:${node.y}px"><small>${node.reference?'循环引用':node.kind==='goal'?'目标':node.kind==='fact'?'条件':'动作'} · ${h(states[state] ?? '—')}</small><strong>${h(title)}</strong><span>${h(detail)}</span></button>`;
  }).join('');
  return `<section class="plan-dependency-sheet" data-graph-plan="${h(plan.id)}" data-graph-order="${order}"><header><div><small>目标 → 缺的条件 → 满足它的动作 → 前置条件</small><h3>从目标反推 · ${h(plan.goal.effects.map(row=>goalFactLabel(row.predicate)).join('、'))}</h3></div><nav><button data-action="goal-time" aria-pressed="false">按时间</button><button data-action="goal-regression" aria-pressed="true">从目标反推</button><button data-action="goal-wide">展开图</button><button data-action="goal-zoom-out" aria-label="缩小依赖图">−</button><button data-action="goal-fit">全图</button><button data-action="goal-zoom-in" aria-label="放大依赖图">＋</button><button data-action="goal-graph">收起</button></nav></header>
    <div class="goal-graph-viewport" tabindex="0" aria-label="滚动查看计划依赖图"><div class="goal-graph-stage" data-width="${graph.width}" data-height="${graph.height}"><div class="goal-graph-canvas" style="width:${graph.width}px;height:${graph.height}px"><svg width="${graph.width}" height="${graph.height}" aria-hidden="true"><defs><marker id="goal-dependency-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6"/></marker></defs>${edges}</svg>${cards}</div></div></div>
    <footer>实线：满足条件 · 虚线：需要条件 · 点线：先后约束${graph.omitted>0?` · 另 ${graph.omitted} 项未展开`:''}</footer>${goalResourceBand(plan,trace)}</section>`;

}

export function goalPlanDetail(plan: GoalPlan, trace: AiPlanTrace, selected = '$goal'): string {
  const fact = plan.facts.find(row=>row.id===selected), action = plan.actions.find(row=>row.id===selected);
  const title = plan.goal.effects.map(row=>goalFactLabel(row.predicate)).join('、');
  const head = `<small>计划 · ${clock(plan.observedTick)}</small><h3>${h(title)}</h3><p>${h(states[plan.status]??'—')}</p>`;
  if (fact) {
    const observation = fact.observation;
    const alternatives = plan.alternatives.filter(row=>row.factId===fact.id||row.factId===observation.fact.id);
    return `${head}<h4>${h(goalFactLabel(observation.fact.predicate))}</h4><p>${h(goalFactSummary(observation))}</p>
      ${observation.availableTick!=null?`<p>可用时刻 ${clock(observation.availableTick)}${observation.availableTick>trace.tick?' · 当前尚不可用':''}</p>`:''}
      <h4>满足它的候选方案</h4>${alternatives.map(row=>{
        const declaration=row.declaration??plan.actions.find(action=>action.id===row.actionId||action.declaration.id===row.actionId)?.declaration;
        return `<div class="plan-child plan-alternative"><b>${row.status==='chosen'?'选中':row.status==='rejected'?'落选':'待评估'} · ${h(declaration?goalDeclarationLabel(declaration):'—')}</b><p>成本 ${number(row.costGold)} 金 · 完成时间 ${row.finishTick==null?'—':clock(row.finishTick)}</p>${reasonList([row.reason])}${raw(row)}</div>`;
      }).join('')||'<p>—</p>'}${raw(observation)}`;
  }
  if (action) {
    const execution=recordedGoalExecution(trace,action), assignments=recordedGoalAssignments(trace,action), budgets=recordedGoalBudgets(trace,action);
    const receipts=action.allocation?trace.strategy?.allocation?.commandAdmissions?.filter(row=>row.action?.actionId===action.allocation!.actionId&&row.action.generation===action.allocation!.generation)??[]:[];
    return `${head}<h4>动作 · ${h(goalActionLabel(action))}</h4><p>${h(states[action.state]??'—')}</p>
      <h4>为了让什么成立</h4>${action.declaration.effects.map(row=>`<p>${row.operation==='invalidate'?'解除':'达成'} · ${h(goalFactLabel(row.fact.predicate))}</p>`).join('')||'<p>—</p>'}
      <h4>先要具备什么</h4>${action.prerequisiteFactIds.map(id=>{
        const fact=plan.facts.find(row=>row.id===id||row.observation.fact.id===id);
        return `<button class="plan-list" data-plan-node="${h(fact?.id??id)}">${h(fact?goalFactLabel(fact.observation.fact.predicate):'—')} · ${h(fact?goalFactSummary(fact.observation):'—')}</button>`;
      }).join('')||'<p>—</p>'}
      ${action.dependsOnActionIds.map(id=>`<button class="plan-list" data-plan-node="${h(id)}">${h(plan.actions.find(row=>row.id===id)?goalActionLabel(plan.actions.find(row=>row.id===id)!):'—')}</button>`).join('')}
      <h4>谁在执行</h4>${assignments.length?`<p>${assignments.length} 名单位</p>${assignments.map(row=>`<p>${row.role==='worker'?'工人':'部队'} · ${h(stage(row.stage))}${row.interruption?' · 暂时中断':''}</p>`).join('')}`:'<p>—</p>'}
      <h4>当前进度</h4><p>${execution?`${h(goalPhaseText(execution.phase))} · ${h(stage(execution.status))}`:'—'}</p>
      <h4>预算</h4>${budgets.map(row=>`<p>${h(stage(row.state))} · 额度 ${number(row.amountGold)} 金 · 已支付 ${number(row.paidGold)} 金</p>`).join('')||'<p>—</p>'}
      <h4>本次命令</h4>${receipts.map(row=>`<p>${row.status==='accepted'?`已接收 · ${clock(row.admittedTick)}`:'未执行'}</p>`).join('')||'<p>—</p>'}
      <h4>预计与结果</h4><p>预计 ${action.startTick==null?'—':clock(action.startTick)} → ${action.finishTick==null?'—':clock(action.finishTick)}</p><p>实际完成 ${action.state==='world-effects-met'?'已确认':'—'}</p>
      ${raw({action,execution,assignments,budgets,receipts})}`;
  }
  return `${head}<h4>为什么选它</h4>${reasonList(plan.goal.reasons)}
    <h4>还有哪些条件没成立</h4><p>${plan.facts.filter(row=>row.observation.state==='unmet').length} 项未成立 · ${plan.facts.filter(row=>row.observation.state==='pending').length} 项计算中</p>
    <h4>估值</h4><p>成本 ${number(plan.costGold)} 金 · 成功概率 ${plan.successProbability==null?'—':`${number(plan.successProbability*100)}%`} · 价值 ${number(plan.valueGold)} 金</p>
    <h4>结果</h4><p>${plan.status==='complete'&&plan.completedTick!=null?`${clock(plan.completedTick)} 完成`:'—'}</p>${raw(plan)}`;
}
