import { readFileSync, writeFileSync } from 'node:fs';
import { goalNavyFixture } from '../src/client/ai-goal-navy.test-fixture';
import { goalPlanDetail, goalPlanGraph } from '../src/client/ai-goal-plan';
import { fitGoalPlanView } from '../src/client/ai-goal-plan-view';

// A self-contained, double-clickable copy of the same renderer used by the overlay.
const frames = [50, 2100, 3600].map(tick => {
  const { plan, trace } = goalNavyFixture(tick);
  return { tick, graphs: {time:goalPlanGraph(plan,trace),regression:goalPlanGraph(plan,trace,'$goal','regression')}, details: Object.fromEntries(['$goal', ...plan.facts.map(row=>row.id),
    ...plan.actions.map(row=>row.id)].map(id=>[id,goalPlanDetail(plan,trace,id)])) };
});
const css = readFileSync('src/client/ai-plan-overlay.css','utf8');
const html = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>阵前手记 · 从零造海军（人工样稿）</title>
<style>${css}
body{margin:0;background:#e5dfca;color:#384d56}body:before{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent 0 47px,#6e826418 48px),repeating-linear-gradient(90deg,transparent 0 47px,#6e826418 48px)}
.ai-plan-overlay>header em{color:#97523b}.plan-timeline b{font:600 14px Georgia,serif}.plan-panel{font-family:Georgia,'Songti SC',serif}.goal-sample-empty{position:absolute;left:24px;top:130px;font-size:20px;color:#8a7a61}
</style><body><section class="ai-plan-overlay">
<header><span><small>FIELD NOTES · PUBLIC PUZZLE 3</small><strong>从零造海军</strong></span><em>人工版式样例 · 非真实 AI 决策</em><button data-action="goal-graph">依赖图</button></header>
<aside class="plan-panel"></aside><div id="graph"></div>
<section class="plan-timeline"><div class="plan-time-tools"><b>计划时间轴</b><button data-tick="50">初始计划</button><button data-tick="2100">清营之后</button><button data-tick="3600">大厅完工</button><span id="time"></span></div>
<input id="seek" type="range" min="0" max="4200" step="1" value="50" aria-label="拖动计划时间轴"><div class="plan-key">0:00 — 3:30 · 已记录 0:02 — 3:05 · 金币带显示计划收支</div></section></section>
<script id="frames" type="application/json">${JSON.stringify(frames).replace(/</g,'\\u003c')}</script>
<script>
const frames=JSON.parse(document.querySelector('#frames').textContent),root=document.querySelector('.ai-plan-overlay'),range=document.querySelector('#seek'),panel=document.querySelector('.plan-panel'),graph=document.querySelector('#graph');
let selected='$goal',zoom,opened=true,wide=true,order='time';
const fitGoalPlanView=${fitGoalPlanView.toString()};
function fit(){root.classList.toggle('plan-graph-wide',opened&&wide&&!!graph.querySelector('.plan-dependency-sheet'));const wideButton=graph.querySelector('[data-action=goal-wide]');if(wideButton)wideButton.textContent=wide?'显示详情':'展开图';const line=document.querySelector('.plan-timeline');root.style.setProperty('--plan-bottom',(line.getBoundingClientRect().height+30)+'px');const sheet=graph.querySelector('.plan-dependency-sheet');if(sheet)fitGoalPlanView(sheet,zoom);}
function render(){const tick=Number(range.value),frame=frames.filter(row=>row.tick<=tick).at(-1);document.querySelector('#time').textContent=Math.floor(tick/1200)+':'+String(Math.floor(tick/20)%60).padStart(2,'0');if(!frame||tick>3700){panel.innerHTML='<h2>未记录</h2><p>—</p>';graph.innerHTML='<div class="goal-sample-empty">未记录</div>';return;}panel.innerHTML=frame.details[selected]??frame.details.$goal;graph.innerHTML=opened?frame.graphs[order]:'';for(const node of graph.querySelectorAll('[data-plan-node]'))node.setAttribute('aria-pressed',String(node.dataset.planNode===selected));fit();}
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.planNode){selected=button.dataset.planNode;wide=false;render();panel.scrollTop=0;}else if(button.dataset.tick){range.value=button.dataset.tick;render();}else if(button.dataset.action==='goal-graph'){opened=!opened;render();}else{const action=button.dataset.action;if(action==='goal-time'||action==='goal-regression'){order=action==='goal-time'?'time':'regression';zoom=undefined;render();return;}if(action==='goal-wide'){wide=!wide;fit();return;}if(action==='goal-fit')zoom=undefined;else if(action==='goal-zoom-in'||action==='goal-zoom-out'){const old=Number(graph.querySelector('.goal-graph-stage')?.dataset.zoom??1);zoom=Math.max(.3,Math.min(2,old*(action==='goal-zoom-in'?1.25:.8)));}fit();}});
range.addEventListener('input',render);window.addEventListener('resize',fit);render();
</script></body></html>\n`;
const target = 'docs/ai/plan-viz/goal-navy.html';
if (process.argv.includes('--check')) {
  if (readFileSync(target,'utf8') !== html) throw new Error('Run npx tsx scripts/export-goal-plan-mockup.ts to refresh the mockup');
} else writeFileSync(target,html);
