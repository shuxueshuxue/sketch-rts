import { expect, it } from 'vitest';
import { goalNavyFixture } from './ai-goal-navy.test-fixture';
import { goalGraphLayout } from './ai-goal-plan-layout';
import { goalGoldEvents, goalResourceBand } from './ai-goal-plan-resources';
import { goalPlanGraph } from './ai-goal-plan';
import { goalGanttLayout, goalGanttLinks } from './ai-goal-plan-gantt';
import { goalFactTime, goalTimeAxis, goalTimeX } from './ai-goal-plan-time';

it('reads the branched navy plan left to right, merging shared ship and money prerequisites without changing native edges', () => {
  const {plan,trace}=goalNavyFixture(), before=JSON.stringify(plan), graph=goalGraphLayout(plan,'regression');
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
    {from:action.id,to:fact.id,kind:'requires'},{from:action.id,to:fact.id,kind:'establishes'}]},'regression');
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
