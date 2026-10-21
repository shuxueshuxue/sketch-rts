import { expect, it } from 'vitest';
import { goalNavyFixture } from './ai-goal-navy.test-fixture';
import { GOAL_CARD, goalGraphLayout } from './ai-goal-plan-layout';
import { goalGoldEvents, goalResourceBand } from './ai-goal-plan-resources';
import { goalPlanGraph } from './ai-goal-plan';
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

it('defaults to execution time, anchors action centers and gold events to the same clock, and keeps the goal at completion',()=>{
  const {plan,trace}=goalNavyFixture(),before=JSON.stringify(plan),graph=goalGraphLayout(plan),axis=goalTimeAxis(plan);
  expect(graph.axis).toEqual(axis);
  const nodes=new Map(graph.nodes.map(row=>[row.id,row]));
  for(const action of plan.actions)expect(nodes.get(action.id)!.x+GOAL_CARD.width/2).toBeCloseTo(goalTimeX(axis,action.startTick!));
  expect(nodes.get('navy-yard')!.x).toBeLessThan(nodes.get('navy-hall')!.x);
  expect(nodes.get('$goal')!.x).toBeGreaterThan(nodes.get('navy-hall')!.x);
  for(const event of goalGoldEvents(plan))expect(goalResourceBand(plan,trace,axis))
    .toContain(`data-gold-tick="${event.tick}" class="${event.delta<0?'spend':'income'}" cx="${goalTimeX(axis,event.tick)}"`);
  const html=goalPlanGraph(plan,trace);
  expect(html).toContain('data-graph-order="time"');expect(html).toContain('横线为预计耗时');
  expect(goalPlanGraph(plan,trace,'$goal','regression')).toContain('data-graph-order="regression"');
  expect(goalTimeAxis(goalNavyFixture(3600).plan)).toEqual(axis);
  expect(JSON.stringify(plan)).toBe(before);
});

it('separates unscheduled actions and pending facts instead of assigning a zero or deadline ETA',()=>{
  const {plan,trace,route}=goalNavyFixture();
  const unknown={...plan,actions:plan.actions.map(row=>row.id==='navy-hall'?{...row,startTick:null,finishTick:null}:row)};
  const layout=goalGraphLayout(unknown),action=layout.nodes.find(row=>row.id==='navy-hall')!,fact=layout.nodes.find(row=>row.id===route.id)!;
  for(const node of [action,fact]){expect(node.time).toBeNull();expect(node.y).toBeGreaterThan(layout.untimedY!);}
  expect(goalPlanGraph(unknown,trace)).toContain('时间未记录 · 不放入预计时序');
  expect(layout.nodes.find(row=>row.id==='$goal')!.time).toBeNull();
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
