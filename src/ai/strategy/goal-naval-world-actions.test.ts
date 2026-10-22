import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { shipPassengers } from '../../shared/ship-geometry';
import { createAiPolicyMemory } from '../memory';
import { EXPANSION_GARRISON_COVERAGE_RADIUS } from '../bootstrap_1/expansion-garrison-rules';
import { assessAllocatedForce } from './allocated-force';
import { goalFact } from './goal-facts';
import { declareGoalGarrison } from './goal-garrison-action';
import { declareGoalAssembly, declareGoalForceTransport, type GoalNavalEstimates, type GoalNavalMember } from './goal-naval-actions';
import { goalNavalActionProvider } from './goal-naval-provider';
import type { GoalCombatOption, GoalEstimate, GoalPlanningContext, GoalTransportOption } from './goal-planner-types';
import { evaluateSituation } from './situation';
const known=<T>(value:T):GoalEstimate<T>=>({state:'met',value,factIds:['published-world-fact']});
const pending={state:'pending' as const,requestIds:['same-query-arrival'],reason:{code:'arrival-pending',factIds:[],values:{}}};
const estimates:GoalNavalEstimates={duration:known(1000),cost:known([{code:'measured-loss',gold:5,factIds:['native-risk']}]),successProbability:known(.8)};
const strict=<T>(run:()=>T)=>withNavigationAudit(event=>{if(event.phase==='strategy-planning'&&!event.authorization)throw Error(event.operation);},()=>withNavigationPhase('strategy-planning',run));
function frame(){
 const snapshot=snapshotGame(sketchScene('naval-world-fact-currencies').map('bareDuel').replaceDefaults().player('us')
  .unit('us','emberRavager',1000,1000,{id:'fighter-a'}).unit('us','archer',1020,1000,{id:'fighter-b'})
  .goldMine('mine',1400,1400,10000).build().createGame());
 const owner='us',from={landId:'land:1' as const,point:{x:1000,y:1000}},post={landId:'land:1' as const,point:{x:1200,y:1300}};
 const at={landId:'land:1' as const,entityId:'mine',point:{x:1400,y:1400}},unitIds=['fighter-a','fighter-b'];
 const cohort:GoalNavalMember[]=snapshot.units.filter(u=>unitIds.includes(u.id)).map(assessment=>({reference:{kind:'existing',entityId:assessment.id},assessment}));
 return {snapshot,owner,from,post,at,unitIds,cohort,byTick:1000,estimates};
}

describe('naval achievers preserve independent world predicates',()=>{
 it('establishes actual whole-cohort field strength at the post without adding a second force inventory',()=>{
  const f=frame(),before=JSON.stringify(f),safePost=goalFact({kind:'site-safe',site:f.post,throughTick:1000});
  const action=strict(()=>declareGoalAssembly({...f,at:f.post,safePost,routes:[]}))!;
  const field=action.effects.find(e=>(e.fact.predicate.kind==='force-at')&&e.fact.predicate.metric==='field-strength')!;
  const combat=action.effects.find(e=>e.fact.predicate.kind==='force-at'&&e.fact.predicate.metric==='combat-rating')!;
  expect(field.fact.predicate).toMatchObject({at:f.post,minimum:assessAllocatedForce(f.owner,f.cohort.map(m=>m.assessment),{metric:'field-strength',requiredForce:0}).force,cohort:f.cohort.map(m=>m.reference)});
  if(field.fact.predicate.kind!=='force-at'||combat.fact.predicate.kind!=='force-at')throw Error();
  expect(field.fact.predicate.minimum).not.toBeCloseTo(combat.fact.predicate.minimum,3);
  expect(action.flows.filter(flow=>flow.resource.kind==='force').every(flow=>flow.resource.kind==='force'&&flow.resource.metric==='combat-rating')).toBe(true);
  const reference={kind:'output' as const,actionId:'train',output:'unit-0'},future=strict(()=>declareGoalAssembly({...f,cohort:[{reference,assessment:f.cohort[0]!.assessment}],at:f.post,safePost,routes:[]}))!;
  expect(future.effects.find(e=>e.fact.predicate.kind==='force-at'&&e.fact.predicate.metric==='field-strength')?.fact.predicate).toMatchObject({cohort:[reference]});
  expect(JSON.stringify(f)).toBe(before);
 });
 it('credits only the selected transported fighters field strength to the destination pool, including real aboard origins',()=>{
  const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/sapphire-control-p4-4180.json.gz',import.meta.url))).toString()) as {snapshot:GameSnapshot;owner:string};
  const hull=f.snapshot.units.find(u=>u.id==='unit-p4-transport-1151')!,cargo=shipPassengers(f.snapshot.units,hull),fighter=cargo.find(u=>u.kind!=='worker')!;
  const at={landId:'land:3' as const,point:{x:2864,y:4208}},from={seaId:'sea:1' as const,point:{x:hull.x,y:hull.y}};
  const crossing=goalFact({kind:'route',mover:'sea',from,to:at});
  const option:GoalTransportOption={id:'published-aboard',transport:{kind:'existing',entityId:hull.id},origin:'aboard',seaId:'sea:1',from,to:at,capacity:1000,loadedUnitIds:cargo.map(u=>u.id),
   departure:{water:from.point,heading:0},landing:{water:at.point,ground:at.point,heading:0},crossing,shoreSafe:goalFact({kind:'shore-safe',landId:at.landId,landing:at,throughTick:9000}),duration:known(100),factIds:['published-crossing']};
  const action=strict(()=>declareGoalForceTransport({...f,unitIds:[fighter.id],byTick:9000,estimates,option,berthTolerance:hull.radius,pickupRoutes:[]}))!;
  const field=action.effects.find(e=>e.fact.predicate.kind==='force-available'&&e.fact.predicate.metric==='field-strength')!;
  expect(field.fact.predicate).toMatchObject({at,minimum:assessAllocatedForce(f.owner,[fighter],{metric:'field-strength',requiredForce:0}).force,cohort:[{kind:'existing',entityId:fighter.id}]});
  expect(field.fact.predicate.kind).toBe('force-available');expect(action.effects.some(e=>e.fact.predicate.kind==='force-at'&&e.fact.predicate.metric==='field-strength')).toBe(false);
  expect(action.flows.every(flow=>flow.resource.kind!=='force'||flow.resource.metric==='combat-rating')).toBe(true);
 });
 it('maps the common hold-position atom to garrison readiness after exact arrival and the real hall prerequisite',()=>{
  const f=frame(),situation=evaluateSituation(f.snapshot,f.owner,createAiPolicyMemory());
  const context:GoalPlanningContext={snapshot:f.snapshot,situation,owner:f.owner,tick:0,version:'v9_summoner',readFact:fact=>({fact,state:'unmet',observedTick:0,revision:'actual-world',evidence:[],reason:{code:'actual-world',factIds:[],values:{}}})};
  const input={...estimates,mineId:'mine',at:f.at,target:f.post,cohort:f.cohort.map(m=>m.reference),requiredForce:1,byTick:1000,throughTick:1000};
  const action=strict(()=>declareGoalGarrison(input,context))!;
  expect(action.kind).toBe('hold-position');expect(action.executor.executor).toBe('goal.hold-position');
  expect(action.preconditions).toContainEqual(goalFact({kind:'hall-complete',mineId:'mine',at:f.at}));
  expect(action.preconditions).toContainEqual(goalFact({kind:'force-at',metric:'combat-rating',minimum:1,at:f.post,cohort:input.cohort,byTick:1000}));
  expect(action.effects.find(e=>e.fact.predicate.kind==='garrison-ready')).toEqual({fact:goalFact({kind:'garrison-ready',mineId:'mine',at:f.at}),operation:'establish',at:'start'});
  expect(action.demands).toHaveLength(2);expect(action.demands.every(d=>d.resource.kind==='entity-control'&&d.until==='finish')).toBe(true);
  expect(action.executor.parameters).toMatchObject({garrisonMineId:'mine',garrisonAt:f.at,target:f.post,throughTick:1000,cohort:input.cohort});
  expect(action.outputs).toEqual([]);expect(action.flows).toEqual([]);
  expect(declareGoalGarrison({...input,duration:pending},context)!.duration).toEqual(pending);
  expect(declareGoalGarrison({...input,mineId:'different-mine'},context)).toBeNull();
  expect(declareGoalGarrison({...input,duration:known(999)},context)).toBeNull();
  const edge={...f.post,point:{x:f.at.point.x+EXPANSION_GARRISON_COVERAGE_RADIUS,y:f.at.point.y}};
  expect(declareGoalGarrison({...input,target:edge},context)).not.toBeNull();
  expect(declareGoalGarrison({...input,target:{...edge,point:{...edge.point,x:edge.point.x+.001}}},context)).toBeNull();
  expect(declareGoalGarrison({...input,target:{...f.post,point:{x:3000,y:3000}}},context)).toBeNull();
 });
 it('exposes field-strength and garrison alternatives through the same provider and preserves distinct mine identities',()=>{
  const f=frame(),situation=evaluateSituation(f.snapshot,f.owner,createAiPolicyMemory());
  const option:GoalCombatOption={id:'published-garrison',target:f.post,from:f.from,cohort:f.cohort.map(m=>m.reference),requiredForce:1,byTick:1000,...estimates,effectDelayTicks:known(40),preconditions:[],factIds:['native-rally']};
  const context:GoalPlanningContext={snapshot:f.snapshot,situation,owner:f.owner,tick:0,version:'v9_summoner',readFact:fact=>({fact,state:'unmet',observedTick:0,revision:'real-input',evidence:[],reason:{code:'world-observed',factIds:[],values:{}}}),
   grounding:{buildSites:()=>({state:'met',candidates:[],factIds:[]}),productionOptions:()=>({state:'met',candidates:[],factIds:[]}),transportOptions:()=>({state:'met',candidates:[],factIds:[]}),resolveCohort:()=>({state:'met',candidates:f.cohort,factIds:[]}),combatOptions:()=>({state:'met',candidates:[option],factIds:[]})}};
  const effect=goalFact({kind:'force-at',at:f.post,metric:'field-strength',minimum:2,byTick:1000});
  const assembly=strict(()=>goalNavalActionProvider.actionsFor(effect,context));expect(assembly).toHaveLength(1);
  expect(assembly[0]!.effects.some(e=>e.fact.predicate.kind==='force-at'&&e.fact.predicate.metric==='field-strength')).toBe(true);
  const ready=goalFact({kind:'garrison-ready',mineId:'mine',at:f.at}),guards=strict(()=>goalNavalActionProvider.actionsFor(ready,context));
  expect(guards).toHaveLength(1);expect(guards[0]!.effects.some(e=>e.fact.id===ready.id)).toBe(true);
  const otherAt={...f.at,entityId:'mine-b'},other=strict(()=>goalNavalActionProvider.actionsFor(goalFact({kind:'garrison-ready',mineId:'mine-b',at:otherAt}),context));
  expect(other[0]!.id).not.toBe(guards[0]!.id);expect(guards[0]!.preconditions.some(p=>p.predicate.kind==='hall-complete')).toBe(true);
 });
});
