import type { GoalActionKind, GoalActionNode, GoalFact, GoalPlan, GoalPlannerOutput } from '../ai/strategy/goal-planner-types';
import { goalFact } from '../ai/strategy/goal-facts';
import { BUILDING_DEFS, UNIT_DEFS } from '../shared/catalog';
import { createGame } from '../shared/sim';
import { strategyFixture } from './ai-plan-strategy.test-fixture';
type SampleAction = Omit<GoalActionNode, 'declaration'> & { declaration: GoalActionNode['declaration'] };

/** Artificial public-puzzle-3 illustration. Never passed to a planner or simulator as facts. */
export function goalNavyFixture(tick = 50) {
  const base = strategyFixture(), game = createGame('twoShores', { aiPlayers: [], players:['player','ally','enemy','rival'],
    teams:{player:'blue',ally:'blue',enemy:'red',rival:'red'} });
  const yardCost = BUILDING_DEFS.shipyard.cost, hullCost = UNIT_DEFS.transport.cost, hallCost = BUILDING_DEFS.townHall.cost;
  const initialGold = yardCost + hullCost + hallCost;
  game.players.player!.gold = initialGold;
  const home = { point: { x: 1200, y: 1500 }, landId: 'land:1' as const };
  const island = { point: { x: 2700, y: 1900 }, landId: 'land:2' as const };
  const hull = { kind: 'output' as const, actionId: 'navy-hull', output: 'hull' };
  const hall = goalFact({ kind: 'hall-complete', mineId: 'sample-island-mine', at: island });
  const camp = goalFact({ kind: 'camp-cleared', campId: 'sample-island-camp' });
  const worker = goalFact({ kind: 'worker-at', at: island, count: 1, byTick: 3000 });
  const force = goalFact({ kind: 'force-at', at: island, minimum: 10, byTick: 1600, metric: 'combat-rating' });
  const ship = goalFact({ kind: 'transport-in', seaId: 'sea:1', capacity: 6, byTick: 800, transport: hull });
  const yard = goalFact({ kind: 'shipyard-for', seaId: 'sea:1' });
  const goldYard = goalFact({ kind: 'gold', minimum: yardCost, byTick: 200 });
  const goldHull = goalFact({ kind: 'gold', minimum: hullCost, byTick: 500 });
  const goldHall = goalFact({ kind: 'gold', minimum: hallCost, byTick: 3000 });
  const route = goalFact({ kind: 'route', mover: 'sea', from: home, to: island, actor: hull });
  const reason = (code: string) => ({ code, factIds: [] as string[], values: {} });
  const action = (id: string, kind: GoalActionKind, pre: GoalFact[], effect: GoalFact[], start: number, finish: number, cost = 0): SampleAction => ({
    id, declaration: { id, kind, preconditions: pre, effects: effect.map(fact=>({fact,operation:'establish',at:'finish'})),
      demands: cost ? [{ resource:{kind:'gold'},quantity:cost,from:'start',until:'start' }] : [],
      flows: cost ? [{ resource:{kind:'gold'},delta:-cost,at:'start',factIds:[] }] : [],
      duration:{state:'met',value:finish-start,factIds:[]},cost:{state:'met',value:cost?[{code:'native-price',gold:cost,factIds:[]}]:[],factIds:[]},
      successProbability:{state:'met',value:.9,factIds:[]},executor:{executor:`sample-${id}`,parameters:{}},outputs:[],reasons:[] },
    prerequisiteFactIds:pre.map(row=>row.id),dependsOnActionIds:[],startTick:start,finishTick:finish,
    state:tick>=finish?'world-effects-met':tick>=start?'waiting-facts':'waiting-actions',
    allocation:{objectiveId:'navy-island',methodId:'sea-route',actionId:id,generation:1},reasons:[],
  });
  const buildYard = action('navy-yard','build',[goldYard],[yard],200,440,yardCost);
  const trainHull = action('navy-hull','train',[yard,goldHull],[ship],500,740,hullCost);
  trainHull.declaration = { ...trainHull.declaration, outputs:['hull'] };
  const transportForce = action('navy-force','transport-force',[ship,route],[force],800,1600);
  transportForce.declaration = { ...transportForce.declaration,reasons:[reason('safe-landing-selected')] };
  const clear = action('navy-clear','clear-camp',[force],[camp],1600,2000);
  clear.declaration = { ...clear.declaration,flows:[{resource:{kind:'gold'},delta:80,at:'finish',factIds:[],source:{kind:'event',id:'sample-bounty'}}],reasons:[reason('camp-bounty')] };
  const transportWorker = action('navy-worker','transport-worker',[ship,camp],[worker],2200,2800);
  transportWorker.declaration = { ...transportWorker.declaration,reasons:[reason('camp-blocks-worker')] };
  const buildHall = action('navy-hall','build',[goldHall,camp,worker],[hall],3000,3560,hallCost);
  buildHall.declaration = { ...buildHall.declaration,reasons:[reason('hall-money-protected')] };
  const income = action('navy-income','wait-income',[],[],2000,2400);
  income.declaration = { ...income.declaration,flows:[{resource:{kind:'gold'},delta:60,at:'finish',factIds:[],source:{kind:'income',id:'sample-mine-income',segments:[{fromTick:2000,throughTick:2400,ratePerTick:.15}]}}],reasons:[reason('income-from-mines')] };
  // 80 bounty and 60 income are illustration amounts; prices above are native catalog values.
  const actions = [buildHall,transportWorker,clear,transportForce,trainHull,buildYard,income];
  const observed = (fact:GoalFact,readyTick:number) => ({ id:fact.id,producerActionIds:actions.filter(row=>row.declaration.effects.some(effect=>effect.fact.id===fact.id)).map(row=>row.id),
    observation:{fact,state:tick>=readyTick?'met' as const:'unmet' as const,observedTick:tick,...(tick>=readyTick?{availableTick:readyTick}:{}),revision:`sample-${Math.min(tick,readyTick)}`,reason:reason('navy-build-from-zero'),evidence:[]} });
  const facts = [observed(hall,3560),observed(goldHall,0),observed(camp,2000),observed(worker,2800),observed(force,1600),observed(ship,740),observed(yard,440),observed(goldHull,0),observed(goldYard,0),
    { ...observed(route,300),observation:{...observed(route,300).observation,state:tick<300?'pending' as const:'met' as const,requestId:'sample-sea-route',requestedTick:40} }];
  const plan:GoalPlan = { id:'navy-from-zero',goal:{id:'navy-island',owner:'player',effects:[hall],rewardGold:1800,deadlineTick:4000,reasons:[reason('navy-build-from-zero')]},
    observedTick:tick,status:tick>=3560?'complete':'waiting-facts',facts: facts.map(row=>row.observation.fact.predicate.kind==='gold'?{...row,observation:{...row.observation,quantity:initialGold}}:row),actions,
    edges:[...actions.flatMap(row=>[...row.prerequisiteFactIds.map(id=>({from:row.id,to:id,kind:'requires' as const})),...row.declaration.effects.map(effect=>({from:row.id,to:effect.fact.id,kind:'establishes' as const}))]),
      {from:income.id,to:buildHall.id,kind:'resource-before'}],
    subgoals:[],alternatives:[{id:'navy-safe',factId:force.id,actionId:transportForce.id,declaration:transportForce.declaration,status:'chosen',costGold:20,finishTick:1600,reason:reason('safe-landing-selected')},
      {id:'navy-near',factId:force.id,actionId:'navy-near-landing',declaration:{...transportForce.declaration,id:'navy-near-landing',reasons:[reason('landing-needs-extra-fight')]},status:'rejected',costGold:65,finishTick:2100,reason:reason('landing-needs-extra-fight')}],readyActionIds:[],
    resourceTimeline:[
      {actionId:buildYard.id,tick:200,resource:{kind:'gold'},before:initialGold,delta:-yardCost,after:initialGold-yardCost},
      {actionId:trainHull.id,tick:500,resource:{kind:'gold'},before:initialGold-yardCost,delta:-hullCost,after:hallCost},
      {actionId:clear.id,tick:2000,resource:{kind:'gold'},before:hallCost,delta:80,after:hallCost+80},
      {actionId:income.id,tick:2400,resource:{kind:'gold'},before:hallCost+80,delta:60,after:hallCost+140},
      {actionId:buildHall.id,tick:3000,resource:{kind:'gold'},before:hallCost+140,delta:-hallCost,after:140}],
    costGold:initialGold,successProbability:.9,valueGold:810,completedTick:tick>=3560?3560:null,search:{expansions:14,depth:6,work:24,limitReason:null},reasons:[] };
  const paid = tick>=3000;
  const allocation = { ...base.allocation,objectives:[{...base.allocation.objectives[0]!,objectiveId:'navy-island',methodId:'sea-route',target:island,actionIds:actions.map(row=>row.id),assignmentIds:[],budgetIds:['sample-hall-reserve']}],
    assignments:[],executions:[],voyages:[],vacancies:[],blocked:[],unmet:[],events:[],budget:[{...base.allocation.budget[0]!,id:'sample-hall-reserve',spendId:'sample-hall',objectiveId:'navy-island',methodId:'sea-route',action:{actionId:buildHall.id,generation:1},amountGold:hallCost,paidGold:paid?hallCost:0,state:paid?'spent' as const:'reserved' as const,sinceTick:0}] };
  const output:GoalPlannerOutput={plans:[plan],readyActions:[],cache:{version:1,owner:'player',entries:[]}};
  const trace = { ...base.trace,tick,bank:{...base.trace.bank,gold:plan.resourceTimeline.filter(row=>row.tick<=tick).at(-1)?.after??initialGold},roots:[],nodes:[],
    strategy:{...base.strategy,tick,allocation,objectives:[{...base.strategy.objectives[0]!,id:'navy-island',kind:'ConquerIsland' as const,target:island}],methods:[],assignments:[],blockedObjectives:[]},goalPlanner:output };
  return { game,trace,plan,output,force,route,buildHall,trainHull,buildYard,initialGold,hallCost };
}
