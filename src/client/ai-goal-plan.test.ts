import { expect, it } from 'vitest';
import { goalPlanDetail, goalPlanGraph, recordedGoalAssignments, recordedGoalExecution } from './ai-goal-plan';
import { goalDependencyFixture } from './ai-goal-plan.test-fixture';
import { planViewNodes } from './ai-plan-strategy';
import { AiPlanHistory } from './ai-plan-history';
import { applyAiPlanDelta, diffAiPlan, filterAiPlanPacket } from '../ai/plan-stream';
import type { GoalPlan } from '../ai/strategy/goal-planner-types';
import { goalFact } from '../ai/strategy/goal-facts';

it('shows every recorded dependency layer, pending requests, rejected alternatives and unknown estimates without inventing execution', () => {
  const { plan, trace, action, safe } = goalDependencyFixture(), before = JSON.stringify(trace);
  const graph = goalPlanGraph(plan, trace), fact = goalPlanDetail(plan, trace, safe.id), detail = goalPlanDetail(plan, trace, action.id);
  for (const word of ['目标', '条件', '动作', '等路线算完', '还差 6 战力', '执行甘特']) expect(graph).toContain(word);
  for (const internal of ['fixture-await-route','required=6','planned-defense','route-request']) expect(graph).not.toContain(internal);
  for (const word of ['选中', '落选', 'recall-distant', '成本 —', '&lt;img']) expect(fact).toContain(word);
  expect(fact).not.toContain('<img');
  expect(detail).toContain('<h4>谁在执行</h4><p>—</p>');
  expect(detail).toContain('实际完成 —');
  expect(recordedGoalExecution(trace, action)).toBeUndefined(); expect(recordedGoalAssignments(trace, action)).toEqual([]);
  const node = planViewNodes(trace).find(row => row.goalPlan)!;
  expect(node.resources.unitIds).toEqual([]); expect(node.status).toBe('waiting-facts');
  expect(node.utility.score).toBeNull();
  expect(JSON.stringify(trace)).toBe(before);
});

it('uses an alternative declaration before selected actions, and labels missing old declarations instead of parsing IDs', () => {
  const { plan, trace, safe, action } = goalDependencyFixture();
  const fact = goalPlanDetail(plan, trace, safe.id);
  expect(fact).toContain('选中 · 回防');
  expect(fact).toContain('落选 · 集结');
  expect(fact).toContain('distant-assembly');
  const explicit: GoalPlan = { ...plan, alternatives: [{ ...plan.alternatives[0]!,
    declaration: { ...action.declaration, kind: 'build' } }] };
  expect(goalPlanDetail(explicit, trace, safe.id)).toContain('选中 · 建造');
  const { declaration: _removed, ...old } = plan.alternatives[1]!;
  const missing: GoalPlan = { ...plan, alternatives: [old] };
  expect(goalPlanDetail(missing, trace, safe.id)).toContain('落选 · —');
});

it('joins only the recorded objective, method, action and generation, and labels predicted balances separately', () => {
  const { plan, trace, action, first } = goalDependencyFixture();
  const current = { ...action, allocation: { ...action.allocation!, generation: 1 } };
  expect(recordedGoalExecution(trace, current)?.phase).toBe('gather');
  expect(recordedGoalAssignments(trace, current).map(row => row.unitId)).toEqual([first.id]);
  expect(recordedGoalAssignments(trace, { ...current, allocation: { ...current.allocation, methodId: 'another' } })).toEqual([]);
  const text = goalPlanDetail({ ...plan, actions: [current] }, trace, current.id);
  expect(text).toContain('当前进度'); expect(text).toContain('集结 · 受阻');
  expect(text).not.toContain('命令接纳与排队不证明已生效');
  expect(text).toContain('额度 200 金 · 已支付 50 金');
  const goal = goalPlanDetail(plan, trace);
  expect(goal).toContain('查看结构化字段'); expect(goal).toContain('resourceTimeline');
  expect(goal).not.toContain('目标效果于');
});

it('keeps future availability explicit and does not make a future met condition ready at the current tick', () => {
  const { plan, trace, route } = goalDependencyFixture();
  const next = { ...plan, facts: plan.facts.map(row => row.id !== route.id ? row : { ...row,
    observation: { ...row.observation, state: 'met' as const, availableTick: 400,
      route: { distance: 90, ticks: 350, points: [{ x: 0, y: 0 }] } } }) };
  expect(goalPlanGraph(next, trace)).toContain('0:20 才可用');
  const detail = goalPlanDetail(next, trace, route.id);
  expect(detail).toContain('当前尚不可用'); expect(detail).toContain('&quot;distance&quot;: 90');
  expect(next.readyActionIds).toEqual([]);
});

it('preserves cargo output references, native evidence and income source intervals without making them assignees', () => {
  const { plan, trace } = goalDependencyFixture();
  const cargo = goalFact({ kind: 'cargo-aboard', transport: { kind: 'output', actionId: 'train-hull', output: 'hull' },
    units: [{ kind: 'existing', entityId: 'passenger' }] });
  const gold = goalFact({ kind: 'gold', minimum: 200, byTick: 300 });
  const observation = plan.facts[0]!.observation;
  const next: GoalPlan = { ...plan, facts: [
    { id: cargo.id, producerActionIds: [], observation: { ...observation, fact: cargo,
      evidence: [{ source: 'native-cargo', tick: 50, certainty: 'recorded', detail: '<cargo-evidence>' }] } },
    { id: gold.id, producerActionIds: [], observation: { ...observation, fact: gold, goldForecast: {
      epoch: 50, currentFreeGold: 10, goldAtDeadline: 200, earliestTick: 240, incomeGoldPerTick: 1, factIds: [],
      source: { kind: 'income', id: 'mine-income', segments: [{ fromTick: 50, throughTick: 300, ratePerTick: 1 }] },
    } } },
  ] };
  const detail = goalPlanDetail(next, trace, cargo.id);
  expect(detail).toContain('乘员登船');
  for (const value of ['train-hull', 'native-cargo', '&lt;cargo-evidence&gt;']) expect(detail).toContain(value);
  expect(goalPlanDetail(next, trace, gold.id)).toContain('mine-income');
  expect(goalPlanDetail(next, trace, gold.id)).toContain('&quot;throughTick&quot;: 300');
  expect(planViewNodes({ ...trace, goalPlanner: { ...trace.goalPlanner, plans: [next] } })
    .find(row => row.goalPlan)?.resources.unitIds).toEqual([]);
});

it('carries graph deltas through private transport, JSON recording and history without mutating past frames or crossing a gap', () => {
  const { trace, output, plan } = goalDependencyFixture(), previous = JSON.stringify(trace);
  const next = { ...trace, tick: 65, goalPlanner: { ...output, plans: [{ ...plan, observedTick: 65, status: 'ready' as const }] } };
  const baseline = diffAiPlan(undefined, trace, 1), packet = diffAiPlan(trace, next, 1);
  expect(packet.goalPlannerDelta).toBeDefined(); expect(packet.header.goalPlanner).toBeUndefined();
  expect(applyAiPlanDelta(applyAiPlanDelta(undefined, baseline), packet)).toEqual(next);
  expect(applyAiPlanDelta(undefined, packet)).toBeUndefined();
  expect(filterAiPlanPacket(packet, { kind: 'owner', owner: 'enemy' })).toBeUndefined();
  expect(filterAiPlanPacket(packet, { kind: 'none' })).toBeUndefined();
  const history = new AiPlanHistory();
  for (const message of JSON.parse(JSON.stringify([{ type: 'coverage', session: 1, from: 50, to: 70 }, baseline, packet]))) history.receive(message);
  expect(history.nodes(50).find(row => row.node.goalPlan)?.node.goalPlan?.status).toBe('waiting-facts');
  expect(history.nodes(65).find(row => row.node.goalPlan)?.node.goalPlan?.status).toBe('ready');
  expect(history.nodes(90)).toEqual([]); expect(JSON.stringify(trace)).toBe(previous);
  const { goalPlanner: _removed, ...without } = next;
  expect(applyAiPlanDelta(next, diffAiPlan(next, { ...without, tick: 70 }, 1))?.goalPlanner).toBeUndefined();
});

it('patches one fact and its cache entry rather than resending the graph, and reads complete-header recordings', () => {
  const { trace, output, plan } = goalDependencyFixture();
  const rich: GoalPlan = { ...plan, facts: Array.from({length:80},(_,index)=>({ ...plan.facts[0]!,id:`fact-${index}`,
    observation:{...plan.facts[0]!.observation, fact:{...plan.facts[0]!.observation.fact,id:`fact-${index}`},quantity:index,
      reason:{code:'fixture-repeated-evidence',values:{note:'unchanged source evidence '.repeat(8)},factIds:[`fact-${index}`]}} })) };
  const changed: GoalPlan = {...rich,observedTick:65,facts:rich.facts.map((row,index)=>index!==31?row:{...row,
    observation:{...row.observation,quantity:99,revision:'changed'}})};
  const withPlan=(value:GoalPlan)=>({...output,plans:[value],cache:{...output.cache,entries:[{...output.cache.entries[0]!,plan:value}]}});
  const old={...trace,goalPlanner:withPlan(rich)},next={...trace,tick:65,goalPlanner:withPlan(changed)};
  const bytes=JSON.stringify(old),packet=diffAiPlan(old,next,1);
  expect(packet.goalPlannerDelta).toBeDefined();
  expect(JSON.stringify(packet)).toContain('goalKey');
  expect(JSON.stringify(packet).length).toBeLessThan(JSON.stringify(next.goalPlanner).length*.25);
  expect(applyAiPlanDelta(old,packet)).toEqual(next);expect(JSON.stringify(old)).toBe(bytes);
  const {goalPlannerDelta:_patch,...complete}=packet;
  expect(applyAiPlanDelta(old,{...complete,header:{...complete.header,goalPlanner:next.goalPlanner}})).toEqual(next);
  expect(applyAiPlanDelta(old,{...packet,goalPlannerDelta:{kind:'replace',value:{...next.goalPlanner,
    cache:{...next.goalPlanner.cache,owner:'enemy'}}}})).toBeUndefined();
});

it('starts a fresh observed lifetime when the same goal becomes unmet after completion',()=>{
  const {trace,output,plan}=goalDependencyFixture(),history=new AiPlanHistory();
  history.receive({type:'coverage',session:1,from:50,to:100});
  let previous;
  for(const tick of [50,65,80,95]){
    const next={...trace,tick,goalPlanner:{...output,plans:[{...plan,observedTick:tick,
      status:tick===65?'complete' as const:'waiting-facts' as const,completedTick:tick===65?65:null}]}};
    history.receive(diffAiPlan(previous,next,1));previous=next;
  }
  expect(history.bands.filter(row=>row.id==='goalPlanner/defense-plan').map(row=>[row.from,row.to,row.status]))
    .toEqual([[50,65,'complete'],[80,95,'waiting-facts']]);
});
