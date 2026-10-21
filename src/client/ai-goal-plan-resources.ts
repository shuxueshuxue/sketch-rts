import type { AiPlanTrace } from '../ai/plan-trace';
import type { GoalPlan } from '../ai/strategy/goal-planner-types';
import { goalTimeTicks, goalTimeX, type GoalTimeAxis } from './ai-goal-plan-time';
import { recordedGoalBudgets } from './ai-goal-plan-records';
import { goalDeclarationLabel, goalNumber as n } from './ai-goal-plan-words';
import { planHtml as h, planClock as clock } from './ai-plan-strategy-panel';

/** Reads the recorded prefix balances; never recomputes or credits a flow. */
export function goalGoldEvents(plan: GoalPlan) {
  return plan.resourceTimeline.filter(row => row.resource.kind === 'gold').map((row, index) => {
    const action = plan.actions.find(action => action.id === row.actionId || action.declaration.id === row.actionId);
    const label = row.delta > 0 ? action?.declaration.kind === 'clear-camp' ? '清营赏金'
      : action?.declaration.kind === 'wait-income' ? '矿工收入' : '金币入账'
      : action ? goalDeclarationLabel(action.declaration) : '支出';
    return { ...row, label, index };
  }).sort((a, b) => a.tick - b.tick || a.index - b.index);
}
export function goalResourceBand(plan: GoalPlan, trace: AiPlanTrace, axis?: GoalTimeAxis): string {
  const all = goalGoldEvents(plan), events = all.slice(0, 48);
  const seen = new Set<string>();
  const reservations = plan.actions.flatMap(action => recordedGoalBudgets(trace, action)
    .filter(row => row.state === 'reserved' && row.sinceTick <= trace.tick && (row.releasedTick == null || row.releasedTick > trace.tick))
    .flatMap(row => {
      if (seen.has(row.id)) return []; seen.add(row.id);
      return [{ amount: Math.max(0, row.amountGold - row.paidGold), since: row.sinceTick,
        through: row.releasedTick ?? action.startTick, label: goalDeclarationLabel(action.declaration) }];
    }));
  const reserved = reservations.reduce((sum, row) => sum + row.amount, 0);
  const budgetRecorded = trace.strategy?.allocation?.budget !== undefined && plan.actions.some(row=>row.allocation);
  const header = `<header><b>预计金币余额</b><span>当前 ${n(trace.bank.gold)} 金 · 已预留 ${budgetRecorded ? n(reserved) : '—'} 金${budgetRecorded ? ` · 可支配 ${n(trace.bank.gold - reserved)} 金` : ''}</span></header>`;
  if (!events.length) return `<section class="goal-resource-band">${header}<p>—</p></section>`;
  const from = axis?.from ?? Math.min(plan.observedTick, events[0]!.tick, ...reservations.map(row => row.since));
  const through = axis?.through ?? Math.max(from + 1, ...events.map(row => row.tick), ...plan.actions.map(row => row.finishTick ?? from));
  const low = Math.min(0, ...events.map(row => row.after)), high = Math.max(1, events[0]!.before, ...events.map(row => row.after));
  const width = axis?.width ?? 800;
  const x = (tick: number) => axis ? goalTimeX(axis,tick) : 34 + (tick - from) / (through - from) * 730;
  const y = (gold: number) => 58 - (gold - low) / (high - low) * 42;
  let path = `M${x(from)} ${y(events[0]!.before)}`;
  for (const row of events) path += ` H${x(row.tick)} V${y(row.after)}`;
  path += ` H${x(through)}`;
  const reserveBars = reservations.map(row => {
    const start = Math.max(from, row.since), end = Math.max(start, Math.min(through, row.through ?? through));
    return `<rect class="goal-reserve" x="${x(start)}" y="78" width="${x(end)-x(start)}" height="13"/>`;
  }).join('');
  const reserveCaption = reservations.map(row=>`${row.label}预留 ${n(row.amount)} 金${row.through==null?'':` · 预计 ${clock(row.through)} 支付`}`).join('；');
  return `<section class="goal-resource-band" data-reserved-gold="${reserved}">${header}
    <div class="goal-money-scroll${axis?' time-aligned':''}"><div class="goal-money-chart"><svg viewBox="0 0 ${width} 100" preserveAspectRatio="none" role="img" aria-label="预计金币先支出后收入及当前预留"><defs><pattern id="goal-reserve-hatch" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0"/></pattern></defs>
    <path class="goal-money-zero" d="M${x(from)} ${y(0)}H${x(through)}"/><path class="goal-money-line" d="${path}"/>
    ${events.map(row=>`<circle data-gold-tick="${row.tick}" class="${row.delta<0?'spend':'income'}" cx="${x(row.tick)}" cy="${y(row.after)}" r="3"><title>${clock(row.tick)} ${h(row.label)} ${row.delta>0?'+':''}${n(row.delta)} 金 · 余额 ${n(row.after)}</title></circle>`).join('')}
    ${reserveBars}</svg><span class="goal-money-first" style="top:${y(events[0]!.before)*.88-5}px">${n(events[0]!.before)}</span><span class="goal-money-last" style="top:${y(events.at(-1)!.after)*.88-5}px">${n(events.at(-1)!.after)}</span>
    <div class="goal-money-axis" style="left:${x(from)/width*100}%;right:${(width-x(through))/width*100}%">${(axis?goalTimeTicks(axis):[from,(from+through)/2,through]).map(tick=>`<time>${clock(tick)}</time>`).join('')}</div>
    ${reserveCaption?`<span class="goal-reserve-label" title="${h(reserveCaption)}">${h(reserveCaption)}</span>`:''}</div></div>
    <ol>${events.map(row=>`<li class="${row.delta<0?'spend':'income'}"><time>${clock(row.tick)}</time> ${h(row.label)} <b>${row.delta>0?'+':''}${n(row.delta)}</b></li>`).join('')}</ol>${all.length>48?`<small>另 ${all.length-48} 笔见结构化字段</small>`:''}</section>`;
}
