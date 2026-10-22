import { expect, it } from 'vitest';
import { goalNavyFixture } from './ai-goal-navy.test-fixture';
import { goalDependencyFixture } from './ai-goal-plan.test-fixture';
import type { GoalActionNode, GoalPlan } from '../ai/strategy/goal-planner-types';
import { goalGraphLayout } from './ai-goal-plan-layout';
import { goalGoldEvents, goalResourceBand } from './ai-goal-plan-resources';
import { goalPlanGraph } from './ai-goal-plan';
import { goalGanttLayout, goalGanttLinks } from './ai-goal-plan-gantt';
import { goalFactTime, goalTimeAxis, goalTimeX } from './ai-goal-plan-time';

it('reads the branched navy plan left to right, merging shared ship and money prerequisites without changing native edges', () => {
  const {plan,trace}=goalNavyFixture(), before=JSON.stringify(plan), graph=goalGraphLayout(plan);
  const nodes=new Map(graph.nodes.map(row=>[row.id,row]));
  for(const edge of graph.edges) expect(nodes.get(edge.to)!.x).toBeGreaterThan(nodes.get(edge.from)!.x);
  expect(graph.edges.some(edge=>graph.edges.filter(other=>other.from===edge.from).length>=3)).toBe(true);
  expect(graph.edges.some(edge=>graph.edges.filter(other=>other.to===edge.to).length>=2)).toBe(true);
  const establish=graph.edges.find(edge=>edge.kind==='establishes'&&edge.recordFrom==='navy-hull')!;
  expect(establish.to).toBe('navy-hull'); expect(establish.from).toBe(establish.recordTo);
  const text=goalPlanGraph(plan,trace).replace(/<[^>]*>/g,' ');
  for(const label of ['建船厂','造运输船','运兵','清营','运工人','建大厅','预计金币余额'])expect(text).toContain(label);
  for(const id of ['navy-island','sample-sea-route','sample-navy'])expect(text).not.toContain(id);
  expect(JSON.stringify(plan)).toBe(before);
});

it('shows spending before income and the protected hall reserve using recorded balances and same-generation budgets',()=>{
  const {plan,trace,initialGold,hallCost,buildHall,trainHull}=goalNavyFixture(),events=goalGoldEvents(plan);
  expect(events.map(row=>Math.sign(row.delta))).toEqual([-1,-1,1,1,-1]);
  expect(events[1]!.after).toBe(hallCost);
  expect(events.at(-1)!.after).toBe(initialGold+events.reduce((sum,row)=>sum+row.delta,0));
  const band=goalResourceBand(plan,trace);
  for(const word of ['已预留 400 金','可支配 410 金','清营赏金','矿工收入','建大厅预留 400 金'])expect(band).toContain(word);
  const next={...plan,actions:plan.actions.map(row=>row.id!==buildHall.id?row:{...row,allocation:{...row.allocation!,generation:2}})};
  expect(goalResourceBand(next,trace)).not.toContain('建大厅预留 400 金');
  const done=goalNavyFixture(3600);
  expect(goalResourceBand(done.plan,done.trace)).toContain('当前 140 金 · 已预留 0 金 · 可支配 140 金');
  const extra={...trace.strategy.allocation.budget[0]!,id:'transport-reserve',amountGold:100,action:{actionId:trainHull.id,generation:1}};
  const several={...trace,strategy:{...trace.strategy,allocation:{...trace.strategy.allocation,budget:[...trace.strategy.allocation.budget,extra]}}};
  expect(goalResourceBand(plan,several)).toContain('已预留 500 金 · 可支配 310 金');
});

it('keeps cyclic records bounded and inspectable as forward reference leaves',()=>{
  const {plan}=goalNavyFixture(),action=plan.actions[0]!,fact=plan.facts[0]!;
  const graph=goalGraphLayout({...plan,actions:[action],facts:[fact],edges:[
    {from:action.id,to:fact.id,kind:'requires'},{from:action.id,to:fact.id,kind:'establishes'}]});
  expect(graph.nodes.some(row=>row.reference)).toBe(true);
  const nodes=new Map(graph.nodes.map(row=>[row.id,row]));
  for(const edge of graph.edges)expect(nodes.get(edge.to)!.x).toBeGreaterThan(nodes.get(edge.from)!.x);
  expect(graph.nodes.length).toBeLessThanOrEqual(201);
});

it('defaults to executor lanes and duration bars sharing start/end coordinates with the money band',()=>{
  const {plan,trace}=goalNavyFixture(),before=JSON.stringify(plan),graph=goalGanttLayout(plan),axis=goalTimeAxis(plan);
  expect(graph.axis).toEqual(axis);
  expect(graph.lanes.map(row=>row.id)).toEqual(['worker','ship','army','economy']);
  for(const bar of graph.bars){
    expect(bar.x).toBeCloseTo(goalTimeX(axis,bar.action.startTick!));
    expect(bar.end).toBeCloseTo(goalTimeX(axis,bar.action.finishTick!));
  }
  expect(graph.bars.filter(row=>row.actor==='ship').map(row=>row.action.id)).toEqual(['navy-force','navy-worker']);
  expect(graph.complete).toBe(3560);
  for(const event of goalGoldEvents(plan))expect(goalResourceBand(plan,trace,axis))
    .toContain(`data-gold-tick="${event.tick}" class="${event.delta<0?'spend':'income'}" cx="${goalTimeX(axis,event.tick)}"`);
  const html=goalPlanGraph(plan,trace);
  expect(html).toContain('data-graph-order="time"');expect(html).toContain('执行甘特');
  expect(html).not.toContain('goal-graph-node');expect(html).toContain('✓400 金');
  expect(html).toContain('兵力到岗 10');expect(html).toContain('等路线算完');
  expect(goalPlanGraph(plan,trace,'$goal','regression')).toContain('goal-graph-node fact');
  expect(goalTimeAxis(goalNavyFixture(3600).plan)).toEqual(axis);
  expect(JSON.stringify(plan)).toBe(before);
});

it('reduces indirect dependency wires, omits same-lane arrows and never draws a backwards-time wire',()=>{
  const {plan,trace}=goalNavyFixture(),links=goalGanttLinks(plan),html=goalPlanGraph(plan,trace);
  expect(links.some(row=>row.from==='navy-hull'&&row.to==='navy-worker')).toBe(false);
  expect(links.some(row=>row.from==='navy-clear'&&row.to==='navy-hall')).toBe(false);
  expect(html).not.toMatch(/goal-gantt-dependency[^>]+d="[^"]*[CQ]/);
  const sameLane={...plan,actions:plan.actions.map(action=>action.id==='navy-hull'?{...action,declaration:{...action.declaration,kind:'build' as const}}:action)};
  expect(goalPlanGraph(sameLane,trace)).not.toContain('data-from="navy-yard" data-to="navy-hull"');
  const invalid={...plan,actions:plan.actions.map(action=>action.id==='navy-hull'?{...action,startTick:300}:action)};
  expect(goalPlanGraph(invalid,trace)).not.toContain('data-from="navy-yard" data-to="navy-hull"');
});

it('keeps unscheduled actions out of the clock and pending conditions on labels, without creating condition boxes',()=>{
  const {plan,trace}=goalNavyFixture();
  const unknown={...plan,actions:plan.actions.map(row=>row.id==='navy-hall'?{...row,startTick:null,finishTick:null}:row)};
  const layout=goalGanttLayout(unknown);
  expect(layout.bars.some(row=>row.action.id==='navy-hall')).toBe(false);
  expect(layout.unknown.map(row=>row.id)).toEqual(['navy-hall']);
  expect(layout.complete).toBeNull();
  const html=goalPlanGraph(unknown,trace);
  expect(html).toContain('时间未记录 · 不放入预计时序');
  expect(html).not.toContain('goal-graph-node fact');
});

it('places projected effects at start, finish or offset, and waits for every quantitative contributor ETA',()=>{
  const {plan,buildYard}=goalNavyFixture(),fact=plan.facts.find(row=>row.producerActionIds.includes(buildYard.id))!;
  for(const [at,expected] of [['start',200],['finish',440],[{offsetTicks:90},290]] as const){
    const action={...buildYard,declaration:{...buildYard.declaration,effects:buildYard.declaration.effects.map(effect=>({...effect,at}))}};
    expect(goalFactTime({...plan,actions:[action]},fact)).toBe(expected);
  }
  const pending={...buildYard,id:'pending',finishTick:null};
  expect(goalFactTime({...plan,actions:[buildYard,pending]}, {...fact,producerActionIds:[buildYard.id,pending.id]})).toBeNull();
});

it('keeps concurrent actions distinct inside their executor lane without shifting either schedule',()=>{
  const {plan,buildYard}=goalNavyFixture();
  const next={...plan,actions:[...plan.actions,{...buildYard,id:'other-worker'}]};
  const graph=goalGanttLayout(next),first=graph.bars.find(row=>row.action.id===buildYard.id)!,other=graph.bars.find(row=>row.action.id==='other-worker')!;
  expect(graph.lanes).toHaveLength(4);expect(first.actor).toBe('worker');expect(other.actor).toBe('worker');
  expect(first.y).not.toBe(other.y);expect(first.x).toBe(other.x);expect(first.end).toBe(other.end);
});

it('starts sustained-action dependency arrows at effect activation while preserving full actions and order-only dependencies',()=>{
  const fixture=goalDependencyFixture();
  const consumer:GoalActionNode={...fixture.action,id:'build-after-safe',startTick:300,finishTick:400,
    declaration:{...fixture.action.declaration,id:'build-after-safe',kind:'build',preconditions:[fixture.safe],effects:[]},
    prerequisiteFactIds:[fixture.safe.id],dependsOnActionIds:[fixture.action.id]};
  const arrowStart=(plan:GoalPlan)=>{
    const html=goalPlanGraph(plan,fixture.trace);
    const path=html.match(/<path class="goal-gantt-dependency" data-from="defend-node" data-to="build-after-safe"[^>]* d="M([^ ]+) ([^ ]+) /);
    expect(path,'activation precedes the consumer even though the sustained action ends later').not.toBeNull();
    return {x:Number(path![1]),y:Number(path![2]),html};
  };
  for(const [kind,executor] of [['defend','defend'],['hold-position','hold'],['hold-position','garrison']] as const){
    const source:GoalActionNode={...fixture.action,startTick:100,finishTick:1000,prerequisiteFactIds:[],
      declaration:{...fixture.action.declaration,kind,preconditions:[],executor:{executor,parameters:{}},
        effects:[{fact:fixture.safe,operation:'establish',at:{offsetTicks:100}}]}};
    const plan:GoalPlan={...fixture.plan,actions:[source,consumer],facts:[fixture.plan.facts[0]!],completedTick:200,
      edges:[{from:source.id,to:fixture.safe.id,kind:'establishes'},{from:fixture.safe.id,to:consumer.id,kind:'requires'},{from:source.id,to:consumer.id,kind:'resource-before'}],resourceTimeline:[]};
    const before=JSON.stringify(plan),graph=goalGanttLayout(plan),bar=graph.bars.find(row=>row.action.id===source.id)!;
    const wire=arrowStart(plan);
    expect(wire.x).toBeCloseTo(goalTimeX(graph.axis,200));
    expect(wire.x).not.toBeCloseTo(bar.end);
    expect(wire.y).toBe(bar.y); // Exits the top edge toward the worker lane, never hidden inside the bar.
    expect(bar.end).toBeCloseTo(goalTimeX(graph.axis,1000));
    expect(graph.axis.through).toBe(1000);expect(graph.complete).toBe(200);
    expect(wire.html).toContain('data-plan-time="100" data-plan-finish="1000"');
    const orderedConsumer={...consumer,prerequisiteFactIds:[],declaration:{...consumer.declaration,preconditions:[]}};
    const waitsForFinish:GoalPlan={...plan,actions:[source,orderedConsumer],edges:[{from:source.id,to:consumer.id,kind:'resource-before'}]};
    expect(goalPlanGraph(waitsForFinish,fixture.trace)).not.toContain('data-from="defend-node" data-to="build-after-safe"');
    const afterRelease:GoalPlan={...waitsForFinish,actions:[source,{...orderedConsumer,startTick:1100,finishTick:1200}]};
    expect(arrowStart(afterRelease).x).toBeCloseTo(goalTimeX(goalTimeAxis(afterRelease),1000));
    const demand={resource:{kind:'entity-control' as const,entity:{kind:'existing' as const,entityId:'shared-unit'}},quantity:1,from:'start' as const,until:'finish' as const};
    const mixed:GoalPlan={...plan,actions:[{...source,declaration:{...source.declaration,demands:[demand]}},
      {...consumer,startTick:1100,finishTick:1200,declaration:{...consumer.declaration,demands:[demand]}}]};
    const mixedHtml=goalPlanGraph(mixed,fixture.trace),mixedAxis=goalTimeAxis(mixed);
    const starts=[...mixedHtml.matchAll(/<path class="goal-gantt-dependency" data-from="defend-node" data-to="build-after-safe"[^>]* d="M([^ ]+) /g)].map(match=>Number(match[1]));
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBeCloseTo(goalTimeX(mixedAxis,200));
    expect(starts[1]).toBeCloseTo(goalTimeX(mixedAxis,1000));
    expect(mixedHtml).toContain('资源释放');
    expect(JSON.stringify(plan)).toBe(before);
  }
});
