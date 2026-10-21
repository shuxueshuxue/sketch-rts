import type { AiPlanTrace } from '../ai/plan-trace';
import type { AllocationEvent } from '../ai/strategy/allocation-types';
import { allocationEventLabel, allocationReason, demandLabel, eventMatchesObjective, stageLabel,
  type PlanAllocationEvent, type PlanViewNode } from './ai-plan-strategy';

export const planHtml = (value: unknown) => String(value ?? '—').replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export const planClock = (tick: number) => `${Math.floor(tick / 1200)}:${String(Math.floor(tick / 20) % 60).padStart(2, '0')}`;
const n = (value: number | null | undefined) => value == null ? '—' : Number(value.toFixed(2));

/** Display received facts only. In particular, acceptance is not arrival or task completion. */
export function strategyPlanPanel(trace: AiPlanTrace, node: PlanViewNode, recorded: readonly PlanAllocationEvent[]): string {
  const context = node.strategy, strategy = trace.strategy;
  if (!context || !strategy) return '';
  const { objectiveId, quote, allocation } = context, formal = strategy.allocation;
  const assignments = formal?.assignments.filter(row => row.objectiveId === objectiveId) ?? [];
  const actions = formal?.executions.filter(row => row.objectiveId === objectiveId) ?? [];
  const methods = strategy.methods.filter(row => row.objectiveId === objectiveId);
  const events = recorded.filter(entry => entry.owner === trace.owner && entry.event.tick >= (node.sinceTick ?? 0)
    && eventMatchesObjective(entry.event, objectiveId));
  const unmet = formal?.unmet.filter(row => row.objectiveId === objectiveId) ?? [];
  const vacancies = formal?.vacancies.filter(row => row.objectiveId === objectiveId) ?? [];
  const blocked = formal?.blocked.filter(row => row.objectiveId === objectiveId) ?? [];
  const conditional = strategy.blockedObjectives.find(row => row.objectiveId === objectiveId);
  const budget = formal?.budget.filter(row => row.objectiveId === objectiveId) ?? [];
  const utility = quote?.utility;
  const terms = (rows: readonly { code: string; value: number }[] | undefined) =>
    rows?.map(row => `${planHtml(row.code)} ${n(row.value)}`).join('；') || '—';
  const row = (title: string, content: string) => `<p><b>${title}</b><br>${content}</p>`;
  const reason = (value: Parameters<typeof allocationReason>[0]) => planHtml(allocationReason(value));
  const eventHtml = (event: AllocationEvent) => {
    let detail = '';
    if (event.kind === 'preempted') detail = `<br>新增收益 ${n(event.quotation.marginalBenefitGold)} · 原目标损失 ${n(event.quotation.displacedLossGold)} · 切换成本 ${n(event.quotation.switchingCostGold)}`;
    if (event.kind === 'preempted' && event.quotation.displacedLoss) {
      const loss=event.quotation.displacedLoss;
      detail+=`<br><small>损失口径：${loss.kind==='remaining-utility'?'剩余效用':loss.kind==='upper-bound'?'迁移旧任务的潜在值上界':'集结延迟损失上界'}</small>`;
      if('bound' in loss)detail+=`<details><summary>查看上界依据</summary><pre>${planHtml(JSON.stringify(loss.bound,null,2))}</pre></details>`;
    }
    return `<p>${planClock(event.tick)} · ${planHtml(allocationEventLabel(event))}${detail}<br><small>${reason(event.reason)}</small></p>`;
  };
  return `<article class="plan-strategy" data-objective="${planHtml(objectiveId)}">
    <div class="plan-goal-title"><div><small>${planHtml(trace.owner)} · ${allocation ? '正式分配' : '观察报价（未正式分配）'} · ${stageLabel(node.status)}</small><h3>${planHtml(node.label)}</h3></div><b>${n(utility?.score)}</b></div>
    <small class="plan-id">${planHtml(objectiveId)}</small>
    <h4>01　为什么选它</h4>
    ${row('当前报价效用', `收益：${terms(utility?.benefit)}<br>成本：${terms(utility?.cost)}<br>成功概率 ${utility ? `${n(utility.successProbability * 100)}%` : '—'} · 坚持加分 ${n(utility?.persistenceBonus)}<br>报价分 ${n(utility?.score)} · 正式目标剩余效用 ${n(allocation?.committedUtilityGold)}`)}
    ${quote?.reasons.map(item => `<p>${planHtml(item.detail)} <small>${planHtml(item.code)}</small></p>`).join('') || '<p class="plan-muted">选择理由未记录。</p>'}
    ${conditional ? `<p class="plan-muted">受阻后的潜在效用 ${n(conditional.potentialUtility?.score)}（前置满足后才成立，不是正式收益）</p>` : ''}
    <h4>02　怎么做</h4>
    <p>方法：${planHtml(allocation?.methodId ?? (methods.length ? methods.map(method => `${method.kind} (${stageLabel(method.status)})`).join(' / ') : '—'))}</p>
    ${actions.map(action => `<div class="plan-child"><b>${planHtml(action.intent.kind)}</b> · ${stageLabel(action.status)}<br>${planHtml(action.phase)} · ${planHtml(action.executor)}<br><small>${planHtml(action.token.actionId)} #${action.token.generation} · 前置 ${planHtml(action.dependsOn.join('、') || '无')}<br>最近进展 ${planClock(action.lastProgressTick)}</small></div>`).join('') || methods.map(method => `<div class="plan-child">${planHtml(method.kind)} · 报价步骤${method.subgoals.map(goal => `<p>↳ ${planHtml(goal.kind)} · ${stageLabel(goal.status)}</p>`).join('')}</div>`).join('') || '<p class="plan-muted">执行方法待接入。</p>'}
    ${methods.flatMap(method => method.preconditions.filter(item => item.status !== 'met').map(item => `<p class="plan-blocked">! ${planHtml(method.id)} · ${planHtml(item.reason.detail)} (${planHtml(item.status)})</p>`)).join('')}
    ${conditional?.missingPreconditions.map(item => `<p class="plan-blocked">! ${planHtml(item.methodId)} · ${planHtml(item.reason.detail)} (${planHtml(item.status)})</p>`).join('') ?? ''}
    ${blocked.map(item => `<div class="plan-blocked"><b>安全中断 · ${planHtml(item.reason.reason)}</b><p>${planHtml(item.interruptedExecutor)} · ${planHtml(item.interruptedUnitId)} · ${planClock(item.interruptedTick)}<br>实际被打断订单 ${planHtml(item.actualInterruptedOrder.type)} · 父行动 ${planHtml(item.parent.actionId)} #${item.parent.generation}</p>${item.missingPreconditions.map(condition => `<p>! ${planHtml(condition.kind)} · ${reason(condition.reason)} (${planHtml(condition.status)})</p>`).join('')}<small>潜在效用 ${n(item.potentialUtility?.score)} · ${item.obstacles.length} 处障碍</small></div>`).join('')}
    <h4>03　派了谁</h4>
    <p>${assignments.length} 名正式分配${allocation ? '' : ' · 观察中的旧任务不计入派兵'}</p>
    ${assignments.slice(0, 48).map(assignment => {
      const eta = assignment.eta;
      const arrival = events.map(entry => entry.event).filter(event => event.kind === 'assignment-stage'
        && event.assignmentId === assignment.id && event.action.actionId === assignment.action.actionId
        && event.action.generation === assignment.action.generation && event.to === 'on-station').at(-1);
      return `<div class="plan-assignment"><b>${planHtml(assignment.unitId)}</b> · ${planHtml(assignment.role)} · ${stageLabel(assignment.stage)}${assignment.interruption ? `<br><span class="plan-blocked">救命中断：${planHtml(assignment.interruption.kind)}（原分配保留，当前不可用）</span>` : ''}<div class="plan-compare"><span>预计到达<br><b>${eta.arrivalTick == null ? '—' : planClock(eta.arrivalTick)}${eta.status === 'known' ? '' : ` (${planHtml(eta.status)})`}</b><br><small>预测于 ${planClock(eta.forecastTick)}</small></span><span>实际到岗<br><b>${arrival ? planClock(arrival.tick) : assignment.stage === 'on-station' ? '已到岗，时刻未记录' : '—'}</b></span></div>${eta.status !== 'known' ? `<small>${reason(eta.reason)}</small>` : ''}</div>`;
    }).join('')}${assignments.length > 48 ? `<p class="plan-muted">另 ${assignments.length - 48} 名，完整数据保留在录制中。</p>` : ''}
    ${budget.map(item => `<p>预算 ${planHtml(item.spendId)} · ${planHtml(item.state)}<br>金额 ${n(item.amountGold)} · 已支付 ${n(item.paidGold)}</p>`).join('') || '<p class="plan-muted">预算 —</p>'}
    <h4>资源不足</h4>${unmet.map(item => row(planHtml(demandLabel(item.demand)), reason(item.reason))).join('') || '<p class="plan-muted">没有记录到未满足的初始需求。</p>'}
    <h4>救命中断后的空缺</h4>${vacancies.map(item => row(planHtml(demandLabel(item.demand)), `${reason(item.reason)}<br>替补分配 ${planHtml(item.replacementAssignmentIds.join('、') || '尚未记录')}`)).join('') || '<p class="plan-muted">没有记录到替补空缺。</p>'}
    <h4>04　执行得怎样</h4>${events.slice(-12).map(entry => eventHtml(entry.event)).join('') || '<p class="plan-muted">当前记录窗口内尚无执行事件；未记录时段不补建。</p>'}
    <h4>05　结果如何</h4><div class="plan-compare"><span>预期效果<br><b>${planHtml(quote?.effects.map(effect => effect.kind).join('、') || '—')}</b></span><span>正式执行结果<br><b>${allocation ? stageLabel(allocation.status) : '未正式执行'}</b></span></div>
    <p class="plan-muted">实际效果以上方进展和结束事件为准；未知数值保持“—”。</p>
  </article>`;
}
