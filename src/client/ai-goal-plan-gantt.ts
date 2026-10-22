import { goalValueKey } from '../ai/strategy/goal-facts';
import type { AiPlanTrace } from '../ai/plan-trace';
import type { GoalActionNode, GoalPlan, GoalPlanFactNode } from '../ai/strategy/goal-planner-types';
import { planHtml as h, planClock as clock } from './ai-plan-strategy-panel';
import { goalDeclarationLabel, goalFactLabel, goalFactSummary, goalStates } from './ai-goal-plan-words';
import { goalEffectTime, goalFactTime, goalTimeAxis, goalTimeTicks, goalTimeX } from './ai-goal-plan-time';
import { goalResourceBand } from './ai-goal-plan-resources';

const actors = [{ id:'worker',label:'工人' },{ id:'ship',label:'船' },{ id:'army',label:'部队' },{ id:'economy',label:'经济（钱 / 生产）' }] as const;
type Actor = typeof actors[number]['id'];
export type GanttBar = { action:GoalActionNode; actor:Actor; x:number; end:number; y:number; track:number };
type Link = { from:string; to:string; facts:GoalPlanFactNode[]; resource:boolean };
const cache = new WeakMap<GoalPlan,ReturnType<typeof layout>>();
const linkCache = new WeakMap<GoalPlan,Link[]>();
export function goalActor(action:GoalActionNode):Actor {
  switch(action.declaration.kind){
    case 'build':return 'worker';
    case 'transport-force':case 'transport-worker':case 'position-transport':return 'ship';
    case 'train':case 'wait-income':return 'economy';
    default:return 'army';
  }
}
function layout(plan:GoalPlan){
  const axis=goalTimeAxis(plan), actions=plan.actions.slice(0,200);
  const unknown=actions.filter(row=>row.startTick==null||row.finishTick==null||row.finishTick<row.startTick);
  const known=actions.filter(row=>!unknown.includes(row)).sort((a,b)=>a.startTick!-b.startTick!);
  let top=42;
  const bars:GanttBar[]=[];
  const lanes=actors.map(actor=>{
    const ends:number[]=[],sizes:number[]=[];
    const rows=known.filter(action=>goalActor(action)===actor.id);
    for(const action of rows){
      let track=ends.findIndex(end=>end<=action.startTick!);if(track<0)track=ends.length;
      ends[track]=action.finishTick!;
      const externalCount=action.prerequisiteFactIds.map(id=>factFor(plan,id)).filter(fact=>fact&&!producers(plan,fact).length).length;
      sizes[track]=Math.max(sizes[track]??76,76+Math.max(0,externalCount-1)*17);
      bars.push({action,actor:actor.id,track,x:goalTimeX(axis,action.startTick!),end:goalTimeX(axis,action.finishTick!),y:top+15+track*76});
    }
    for(const bar of bars)if(bar.actor===actor.id)bar.y=top+15+sizes.slice(0,bar.track).reduce((sum,size)=>sum+size,0);
    const lane={...actor,y:top,height:(sizes.reduce((sum,size)=>sum+size,0)||76)+20};top+=lane.height;return lane;
  });
  const goalTimes=plan.facts.filter(row=>plan.goal.effects.some(effect=>effect.id===row.observation.fact.id)).map(row=>goalFactTime(plan,row));
  const complete=plan.completedTick??(goalTimes.length===plan.goal.effects.length&&goalTimes.length&&goalTimes.every((tick):tick is number=>tick!=null)?Math.max(...goalTimes):null);
  return {axis,bars,lanes,unknown,complete,height:top+12+(unknown.length?28+Math.ceil(unknown.length/4)*32:0),omitted:Math.max(0,plan.actions.length-actions.length)};
}
export function goalGanttLayout(plan:GoalPlan){
  let result=cache.get(plan);if(!result){result=layout(plan);cache.set(plan,result);}return result;
}
function factFor(plan:GoalPlan,id:string){return plan.facts.find(row=>row.id===id||row.observation.fact.id===id);}
function producers(plan:GoalPlan,fact:GoalPlanFactNode){
  return plan.actions.filter(action=>fact.producerActionIds.includes(action.id)||plan.edges.some(edge=>edge.kind==='establishes'&&edge.from===action.id&&edge.to===fact.id));
}
function dependencies(plan:GoalPlan):Link[]{
  const byPair=new Map<string,Link>();
  const add=(from:string,to:string,fact:GoalPlanFactNode|undefined,resource=false)=>{
    if(from===to)return;
    const key=JSON.stringify([from,to]),row=byPair.get(key)??{from,to,facts:[],resource:false};
    if(fact&&!row.facts.some(old=>old.id===fact.id))row.facts.push(fact);
    row.resource ||= resource;byPair.set(key,row);
  };
  for(const action of plan.actions.slice(0,200)){
    for(const id of action.prerequisiteFactIds){const fact=factFor(plan,id);if(fact)for(const producer of producers(plan,fact))add(producer.id,action.id,fact);}
    for(const id of action.dependsOnActionIds)add(id,action.id,undefined);
  }
  for(const edge of plan.edges)if(edge.kind==='resource-before')add(edge.from,edge.to,undefined,true);
  return [...byPair.values()];
}
/** Remove only redundant presentation links. Same-row steps still participate
 * in reachability, but their time order replaces a drawn arrow. */
export function goalGanttLinks(plan:GoalPlan):Link[]{
  const cached=linkCache.get(plan);if(cached)return cached;
  const all=dependencies(plan);
  const result=all.filter(link=>{
    const todo=[link.from],seen=new Set(todo);
    for(let i=0;i<todo.length&&i<201;i++)for(const other of all){
      if(other===link||other.from!==todo[i])continue;
      if(other.to===link.to)return false;
      if(!seen.has(other.to)){seen.add(other.to);todo.push(other.to);}
    }
    return true;
  });
  linkCache.set(plan,result);return result;
}
const available=(fact:GoalPlanFactNode,tick:number)=>fact.observation.state==='met'&&(fact.observation.availableTick==null||fact.observation.availableTick<=tick);
/** The planner also records causal producers as action/resource predecessors.
 * A fact link follows its declared effect; order-only links still leave at finish. */
function departureTick(link:Link,source:GoalActionNode,tick:number):number|null {
  const missing=link.facts.filter(fact=>!available(fact,tick));
  if(!missing.length)return source.finishTick;
  const times=missing.flatMap(fact=>{
    const effects=source.declaration.effects.filter(effect=>effect.operation==='establish'&&effect.fact.id===fact.observation.fact.id);
    return effects.length?effects.map(effect=>goalEffectTime(source,effect)):[source.finishTick];
  });
  return times.every((time):time is number=>time!=null&&Number.isFinite(time))?Math.max(...times):null;
}
function sharesRecordedDemand(source:GoalActionNode,target:GoalActionNode):boolean {
  return source.declaration.demands.some(demand=>target.declaration.demands.some(other=>
    goalValueKey(demand.resource)===goalValueKey(other.resource)));
}
function conditionText(row:GoalPlanFactNode,tick:number):string {
  const observation=row.observation,p=observation.fact.predicate,name=goalFactLabel(p);
  if(observation.availableTick!=null&&observation.availableTick>tick)return `${name} · ${clock(observation.availableTick)} 才可用`;
  if(observation.state==='pending')return goalFactSummary(observation);
  if(p.kind==='force-at'||p.kind==='force-available')return `${name} ${p.minimum}`;
  if(p.kind==='site-safe'&&goalFactSummary(observation).includes('还差'))return `${name}：${goalFactSummary(observation)}`;
  return name;
}
const metText=(fact:GoalPlanFactNode)=>fact.observation.fact.predicate.kind==='gold'?`${fact.observation.fact.predicate.minimum} 金`:goalFactLabel(fact.observation.fact.predicate);

export function goalGanttGraph(plan:GoalPlan,trace:AiPlanTrace,selected:string):string {
  const graph=goalGanttLayout(plan),{axis}=graph,bars=new Map(graph.bars.map(row=>[row.action.id,row]));
  const shown=goalGanttLinks(plan).flatMap(link=>{
    const from=bars.get(link.from),to=bars.get(link.to);
    if(!from||!to||from.actor===to.actor)return [];
    const tick=departureTick(link,from.action,trace.tick);
    if(tick==null)return [];
    const missing=link.facts.some(fact=>!available(fact,trace.tick));
    const needed=missing||link.resource&&to.action.startTick!>trace.tick||!link.facts.length&&!link.resource;
    if(!needed)return [];
    // A causal predecessor can also hold a declared resource. Keep its release
    // as a separate finish constraint rather than replacing the fact's activation.
    const shared=link.resource&&sharesRecordedDemand(from.action,to.action);
    const points=[{tick,release:shared&&!missing}];
    if(shared&&from.action.finishTick!==tick)points.push({tick:from.action.finishTick!,release:true});
    return points.flatMap(point=>{
      const sx=goalTimeX(axis,point.tick);
      return sx<=to.x?[{link,from,to,sx,release:point.release}]:[];
    });
  });
  const wireParts=shown.map(({link,from,to,sx,release},index)=>{
    const interior=sx<from.end;
    const sy=interior?(to.y>from.y?from.y+48:from.y):from.y+23,tx=to.x,ty=to.y+23;
    const equal=tx-sx<12,turn=equal?sx+8:tx-10;
    const endY=equal?(ty>sy?to.y:to.y+46):ty;
    const exit=interior?` V${sy+(to.y>from.y?10:-10)}`:'';
    const path=equal?`M${sx} ${sy}${exit} H${turn} V${endY}`:`M${sx} ${sy}${exit} H${turn} V${ty} H${tx}`;
    const missing=link.facts.filter(fact=>!available(fact,trace.tick));
    const text=release?'资源释放':missing.length?missing.map(fact=>conditionText(fact,trace.tick)).join('、'):link.resource?'收入入账':'前一步完成';
    const id=release?link.to:missing[0]?.id??link.to;
    return {path,from:link.from,to:link.to,label:`<button class="goal-gantt-condition" data-plan-node="${h(id)}" data-plan-condition="${h(id)}" title="${h(text)}" style="left:${turn+5}px;top:${(sy+endY)/2-9+index%2*2}px">${h(text)}</button>`};
  });
  const actionBars=graph.bars.map(bar=>{
    const {action}=bar;
    const met=action.prerequisiteFactIds.map(id=>factFor(plan,id)).filter((row):row is GoalPlanFactNode=>!!row&&available(row,trace.tick));
    const missing=action.prerequisiteFactIds.map(id=>factFor(plan,id)).filter((row):row is GoalPlanFactNode=>!!row&&!available(row,trace.tick));
    const external=missing.filter(fact=>!producers(plan,fact).some(producer=>bars.has(producer.id)));
    const width=Math.max(1,bar.end-bar.x),label=goalDeclarationLabel(action.declaration);
    const tags=met.map(fact=>`<span title="${h(metText(fact))}">✓${h(metText(fact))}</span>`).join('');
    return `<button class="goal-gantt-action ${h(action.state)}" data-plan-node="${h(action.id)}" data-plan-time="${action.startTick}" data-plan-finish="${action.finishTick}" data-actor="${bar.actor}" aria-pressed="${selected===action.id}" title="${h(label)} · ${clock(action.startTick!)} → ${clock(action.finishTick!)} · ${h(goalStates[action.state]??'—')}${met.length?` · ${h(met.map(metText).join('、'))}`:''}" style="left:${bar.x}px;top:${bar.y}px;width:${width}px"><strong>${h(label)}</strong><small>${clock(action.startTick!)} → ${clock(action.finishTick!)}</small><span class="goal-gantt-tags">${tags}</span></button>${external.map((fact,index)=>`<button class="goal-gantt-condition external" data-plan-node="${h(fact.id)}" data-plan-condition="${h(fact.id)}" style="left:${bar.x}px;top:${bar.y+49+index*17}px">↳ ${h(conditionText(fact,trace.tick))}</button>`).join('')}`;
  }).join('');
  const lanes=graph.lanes.map(lane=>`<div class="goal-gantt-lane ${lane.id}" data-executor-lane="${lane.id}" style="top:${lane.y}px;height:${lane.height}px;width:${axis.width}px"><b>${h(lane.label)}</b></div>`).join('');
  const ruler=goalTimeTicks(axis).map(tick=>`<div class="goal-time-guide" style="left:${goalTimeX(axis,tick)}px;height:${graph.height}px"><time>${clock(tick)}</time></div>`).join('');
  const shortfall=plan.facts.filter(row=>plan.goal.effects.some(effect=>effect.id===row.observation.fact.id)&&row.observation.state!=='met')
    .map(row=>goalFactSummary(row.observation)).filter(text=>text!=='未成立').join('、');
  const goal=graph.complete==null?'':`<button class="goal-gantt-goal" data-plan-node="$goal" style="left:${goalTimeX(axis,graph.complete)+5}px" title="${h(plan.goal.effects.map(row=>goalFactLabel(row.predicate)).join('、'))}">◆ 目标<br>${clock(graph.complete)}</button>`;
  const unknown=graph.unknown.length?`<div class="goal-untimed-label" style="top:${graph.lanes.at(-1)!.y+graph.lanes.at(-1)!.height+6}px">时间未记录 · 不放入预计时序 ${graph.unknown.map(action=>`<button data-plan-node="${h(action.id)}">${h(goalDeclarationLabel(action.declaration))} · —</button>`).join('')}</div>`:'';
  return `<section class="plan-dependency-sheet" data-graph-plan="${h(plan.id)}" data-graph-order="time"><header><div><small>按执行者分行 · 动作与金币共用时间刻度${shortfall?` · ${h(shortfall)}`:''}</small><h3>执行甘特 · ${h(plan.goal.effects.map(row=>goalFactLabel(row.predicate)).join('、'))}</h3></div><nav><button data-action="goal-time" aria-pressed="true">按时间</button><button data-action="goal-regression" aria-pressed="false">从目标反推</button><button data-action="goal-wide">展开图</button><button data-action="goal-zoom-out" aria-label="缩小依赖图">−</button><button data-action="goal-fit">全图</button><button data-action="goal-zoom-in" aria-label="放大依赖图">＋</button><button data-action="goal-graph">收起</button></nav></header>
  <div class="goal-graph-viewport" tabindex="0" aria-label="按执行者和时间查看计划"><div class="goal-graph-stage" data-width="${axis.width}" data-height="${graph.height}"><div class="goal-graph-canvas goal-gantt-canvas" style="width:${axis.width}px;height:${graph.height}px">${lanes}${ruler}<svg width="${axis.width}" height="${graph.height}" aria-hidden="true"><defs><marker id="goal-gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6"/></marker></defs>${wireParts.map(wire=>`<path class="goal-gantt-dependency" data-from="${h(wire.from)}" data-to="${h(wire.to)}" marker-end="url(#goal-gantt-arrow)" d="${wire.path}"/>`).join('')}</svg>${actionBars}${wireParts.map(wire=>wire.label).join('')}${goal}${unknown}</div></div></div>
  <footer>横条：预计执行 · 箭头标签：缺少条件 · ✓：已成立 · 同行按时序${graph.omitted?` · 另 ${graph.omitted} 项未展开`:''}</footer>${goalResourceBand(plan,trace,axis)}</section>`;
}
