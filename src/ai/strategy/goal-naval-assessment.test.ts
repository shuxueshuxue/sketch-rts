import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { assessAllocatedCampBattle, assessAllocatedDefenseBattle, assessAllocatedForce } from './allocated-force';
import { arrivalWeightedForce } from './arrival-force';
import { defenseProtectionValue, defenseThreatScenarios } from './defense-risk';
import { FactWorkQueue } from './fact-work';
import { goalCampId, goalFact } from './goal-facts';
import { declareGoalCampClearing, declareGoalDefense } from './goal-naval-actions';
import { assessGoalCampCombatOption, assessGoalDefenseCombatOption, type GoalCampCombatInput, type GoalDefenseCombatInput } from './goal-naval-assessment';
import type { GoalCombatOption, GoalEstimate, GoalFact, GoalFactObservation } from './goal-planner-types';
import { evaluateSituation } from './situation';
import type { Target } from './types';
const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['published-model-input'] });
const pending = { state: 'pending' as const, requestIds: ['same-query-risk'], reason: { code: 'published-risk-pending', factIds: ['risk-source'], values: {} } };
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
function observed(fact: GoalFact): GoalFactObservation {
 return { fact, state: 'met', observedTick: 0, revision: 'published-route', reason: { code: 'published-route', factIds: [fact.id], values: {} },
  evidence: [], route: { ticks: 20, distance: 200, points: [] } };
}
function campFixture(): GoalCampCombatInput {
 const snapshot = snapshotGame(sketchScene('shared-camp-option-assessment').map('bareDuel').replaceDefaults()
  .player('us', {team:'us'}).player('foe', {team:'foe'})
  .unit('us','footman',1000,1000,{id:'fighter-a',hp:40}).unit('us','archer',1020,1000,{id:'fighter-b',hp:35})
  .unit('neutral','ogreWarrior',2000,2000,{id:'guard-a'}).unit('neutral','ogreMage',2040,2000,{id:'guard-b'}).build().createGame());
 const situation = evaluateSituation(snapshot,'us',createAiPolicyMemory()), exposure=neutralCampExposure(snapshot).camps[0]!,campId=goalCampId(exposure.memberIds);
 const from:Target={landId:'land:1',point:{x:1000,y:1000}},staging:Target={landId:'land:1',point:{x:1700,y:1700}};
 const target:Target={landId:'land:1',point:exposure.camp.center};
 const cohort=snapshot.units.filter(unit=>unit.owner==='us').map(assessment=>({reference:{kind:'existing' as const,entityId:assessment.id},assessment}));
 return { snapshot,situation,cohort,from,target,staging,campId,effect:goalFact({kind:'camp-cleared',campId}),byTick:1000,
  arrivalTicks:known(20),movementRisk:known({expectedLossGold:7,survivalProbability:.8}),
  routes:[observed(goalFact({kind:'route',mover:'land',from:staging,to:target}))],
  stagingFacts:[observed(goalFact({kind:'camp-staging',campId,at:staging,cohort:cohort.map(member=>member.reference)}))] };
}
function defenseFixture(): GoalDefenseCombatInput {
 const game=sketchScene('shared-defense-option-assessment').map('bareDuel').replaceDefaults()
  .player('us',{team:'us'}).player('foe',{team:'foe'}).townHall('us',1400,1400,{id:'hall'}).goldMine('mine',1680,1400,10000)
  .unit('us','footman',1100,1400,{id:'fighter-a',hp:35}).unit('us','archer',1100,1420,{id:'fighter-b',hp:30})
  .unit('foe','footman',1500,1400,{id:'foe',order:{type:'attack',targetId:'hall'}}).build().createGame();
 const snapshot=snapshotGame(game),situation=evaluateSituation(snapshot,'us',createAiPolicyMemory());
 const cohort=snapshot.units.filter(u=>u.owner==='us').map(assessment=>({reference:{kind:'existing' as const,entityId:assessment.id},assessment}));
 const target:Target={entityId:'hall',landId:'land:1',point:{x:1400,y:1400}},from:Target={landId:'land:1',point:{x:1100,y:1400}};
 const observedThreat=situation.lands.flatMap(land=>land.threats).find(threat=>threat.siteId==='hall')!;
 expect(observedThreat).toBeDefined();const threat=defenseThreatScenarios(observedThreat,{status:'none'});
 return {snapshot,situation,cohort,from,target,byTick:900,effect:goalFact({kind:'site-safe',site:target,throughTick:900}),
  routes:[observed(goalFact({kind:'route',mover:'land',from,to:target}))],arrivalTicks:known(20),
  movementRisk:known({expectedLossGold:9,survivalProbability:.8}),requiredCombatRating:known(1.75),
  defense:known({threat,opponents:snapshot.units.filter(u=>u.owner==='foe').map(unit=>({unit,share:1})),hostileTowers:[],staticForce:0,windowTicks:900,onStation:[]})};
}
function only(result:ReturnType<typeof assessGoalCampCombatOption>):GoalCombatOption {
 expect(result.state).toBe('met');if(result.state!=='met')throw Error(JSON.stringify(result));return result.candidates[0]!;
}

describe('pure shared naval combat assessment',()=>{
 it('uses the same replaceable camp-model contract for exact refinement without adding a second loss margin',()=>{
  const f=campFixture(),result=only(strict(()=>assessGoalCampCombatOption({...f,battleModel:()=>({state:'met',factIds:['camp-mixture'],value:{
   modelId:'camp-mixture',expectedLossGold:12,successProbability:.91,battleTicks:80,requiredForce:3,
   lossDistribution:{zeroProbability:.8,positive:[{probability:1,lossGold:60}]},factIds:['camp-mixture']}})})));
  expect(result.cost).toMatchObject({state:'met',value:[{gold:.8*12},{gold:7}]});
  expect(result.successProbability).toMatchObject({state:'met',value:.8*.91});
  expect(result.duration).toMatchObject({state:'met',value:100});
 });
 it('prices the same real camp cohort with native P/catalog deaths and keeps staging separate from the enemy camp',()=>{
  const f=campFixture(),before=JSON.stringify(f),work=new FactWorkQueue(0,0);
  const result=only(strict(()=>assessGoalCampCombatOption(f)));
  const native=assessAllocatedCampBattle({snapshot:f.snapshot,situation:f.situation,target:f.target,unitIds:f.cohort.map(m=>m.assessment.id),battleStartTicks:20});
  expect(native.status).toBe('known');expect(native.attrition.expectedLossGold).toBeGreaterThan(0);
  expect(result.target).toEqual(f.staging);expect(result.target).not.toEqual(f.target);expect(result.campId).toBe(f.campId);
  expect(result.requiredForce).toBe(native.requiredForce);expect(result.duration).toMatchObject({state:'met',value:native.battleUntilTicks});
  expect(result.successProbability).toMatchObject({state:'met',value:.8*native.successProbability!});
  expect(result.cost.state).toBe('met');if(result.cost.state==='met')expect(result.cost.value.map(c=>c.gold)).toEqual([.8*native.attrition.expectedLossGold,7]);
  const action=declareGoalCampClearing({snapshot:f.snapshot,owner:'us',cohort:f.cohort,at:result.target,campId:f.campId,byTick:f.byTick,routes:result.preconditions,
   estimates:{duration:result.duration,cost:result.cost,successProbability:result.successProbability}})!;
  expect(action.preconditions.find(f=>f.predicate.kind==='force-at')?.predicate).toMatchObject({at:f.staging,campId:f.campId});
  expect(action.preconditions).toContainEqual(f.stagingFacts[0]!.fact);expect(action.effects[0]!.fact).toEqual(f.effect);
  strict(()=>work.flush());expect(work.receipt.used).toBe(0);expect(JSON.stringify(f)).toBe(before);
  expect(assessGoalCampCombatOption(JSON.parse(before))).toEqual(assessGoalCampCombatOption(f));
 });
 it('retains missing risk and pending route identity without claiming zero loss or certain success',()=>{
  const f=campFixture(),{movementRisk:_risk,...withoutRisk}=f,unquoted=only(assessGoalCampCombatOption(withoutRisk));
  expect(unquoted.duration.state).toBe('met');expect(unquoted.cost).toMatchObject({state:'pending',reason:{code:'combat-movement-risk-unquoted'}});
  expect(unquoted.successProbability.state).toBe('pending');
  const route={...f.routes[0]!,state:'pending' as const,requestId:'land-query-stable',requestedTick:0};
  const routed=only(strict(()=>assessGoalCampCombatOption({...f,routes:[route],movementRisk:pending})));
  expect(routed.duration).toMatchObject({state:'pending',requestIds:['land-query-stable']});expect(routed.cost.state).toBe('pending');
 });
 it('assesses symbolic members without world IDs, rejects foreign bindings, and does not borrow an unselected neighbor',()=>{
  const f=campFixture(),symbolic={reference:{kind:'output' as const,actionId:'paid-training',output:'unit-0'},assessment:{...f.cohort[0]!.assessment,id:'private-native-copy'}};
  const result=only(strict(()=>assessGoalCampCombatOption({...f,cohort:[symbolic],stagingFacts:[observed(goalFact({kind:'camp-staging',campId:f.campId,at:f.staging,cohort:[symbolic.reference]}))]})));
  expect(result.cohort).toEqual([symbolic.reference]);expect(JSON.stringify(result)).not.toContain('private-native-copy');
  expect(result.cohort).not.toContainEqual(f.cohort[1]!.reference);
  expect(assessGoalCampCombatOption({...f,cohort:[]})).toMatchObject({state:'unmet',reason:{code:'clearing-force-empty'}});
  expect(assessGoalCampCombatOption({...f,cohort:[{reference:{kind:'existing',entityId:'guard-a'},assessment:f.cohort[0]!.assessment}]}).state).toBe('unmet');
 });
 it('leaves enemy aboard unload affiliation pending before the shared camp assessor can project a native ground goal',()=>{
  const f=campFixture(),enemy={...f.cohort[0]!.assessment,id:'enemy-passenger',owner:'foe',deck:{shipId:'enemy-hull',x:0,y:0}};
  const ship={...enemy,id:'enemy-hull',deck:undefined,order:{type:'unload' as const,x:2000,y:2000}};
  const result=only(strict(()=>assessGoalCampCombatOption({...f,snapshot:{...f.snapshot,units:[...f.snapshot.units,enemy,ship]}})));
  expect(result.cost).toMatchObject({state:'pending',reason:{code:'combat-enemy-unload-binding-pending'}});
  expect(result.successProbability.state).toBe('pending');
 });
 it('reuses exact defense scenarios, calibrated battle losses and arrival weighting while retaining combat-rating as a separate requirement',()=>{
  const f=defenseFixture(),before=JSON.stringify(f),result=only(strict(()=>assessGoalDefenseCombatOption(f)));
  if(f.defense.state!=='met')throw Error();const d=f.defense.value,units=f.cohort.map(m=>m.assessment);
  const weighted=arrivalWeightedForce([],units.map(unit=>({unit,etaTicks:20})),900,
   group=>assessAllocatedForce('us',group,{metric:'field-strength',requiredForce:0}).force);
  const protection=defenseProtectionValue({threat:d.threat,assetValueGold:1,cohortForce:weighted.effectiveForce,staticForce:0})!;
  const here=defenseProtectionValue({threat:d.threat,assetValueGold:1,cohortForce:0,staticForce:0})!;
  const loss=d.threat.scenarios.reduce((sum,s)=>sum+s.probability*assessAllocatedDefenseBattle({snapshot:f.snapshot,units,opponents:d.opponents.filter(o=>s.unitIds.includes(o.unit.id)),towers:[],windowTicks:900}).casualties.expectedLossGold,0);
  expect(result.cost.state).toBe('met');if(result.cost.state==='met')expect(result.cost.value.map(c=>c.gold)).toEqual([.8*loss,9]);
  expect(result.successProbability).toMatchObject({state:'met',value:.8*protection.successProbability+.2*here.successProbability});
  expect(result.requiredForce).toBe(1.75);expect(result.effectDelayTicks).toEqual(f.arrivalTicks);expect(result.duration).toMatchObject({state:'met',value:900});
  const action=declareGoalDefense({snapshot:f.snapshot,owner:'us',cohort:f.cohort,site:f.target,byTick:900,throughTick:900,requiredForce:result.requiredForce,
   routes:result.preconditions,...(result.effectDelayTicks?{effectDelayTicks:result.effectDelayTicks}:{}),estimates:result})!;
  expect(action.effects[0]!.at).toEqual({offsetTicks:20});expect(action.demands.every(d=>d.until==='finish')).toBe(true);
  expect(JSON.stringify(f)).toBe(before);
 });
 it('assesses a garrison at its explicit safe post while keeping the logical mine and protection deadline separate',()=>{
  const f=defenseFixture(),target={...f.target,entityId:'mine',point:{x:1680,y:1400}},post={...f.from,point:{x:1200,y:1300}};
  const result=only(strict(()=>assessGoalDefenseCombatOption({...f,target,post,effect:goalFact({kind:'garrison-ready',mineId:'mine',at:target})})));
  expect(result.target).toEqual(post);expect(result.target).not.toEqual(target);expect(result.effectDelayTicks).toEqual(f.arrivalTicks);
  expect(result.duration).toMatchObject({state:'met',value:f.byTick-f.snapshot.tick});expect(result.requiredForce).toBe(1.75);
  expect(result.successProbability.state).toBe('met');expect(result.cost.state).toBe('met');
 });
 it('keeps unknown defense requirements and threat shapes pending instead of relabeling field-strength or omitting an enemy',()=>{
  const f=defenseFixture();expect(assessGoalDefenseCombatOption({...f,requiredCombatRating:pending})).toEqual(pending);
  const unquoted=only(assessGoalDefenseCombatOption({...f,defense:pending}));expect(unquoted.cost).toEqual(pending);
  if(f.defense.state!=='met')throw Error();
  expect(assessGoalDefenseCombatOption({...f,defense:known({...f.defense.value,opponents:[]})})).toMatchObject({state:'pending',reason:{code:'combat-defense-opponent-shape-pending'}});
 });
});
