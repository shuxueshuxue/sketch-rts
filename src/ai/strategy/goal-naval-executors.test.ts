import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { createSdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { shipPassengers } from '../../shared/ship-geometry';
import type { GameSnapshot } from '../../shared/types';
import { currentAllocationLandRouteReader, withAllocationLandRoutes, type AllocationLandRouteReader } from './allocation-arrival-query';
import type { ExecutorInput } from './allocation-types';
import { goalCampId } from './goal-facts';
import { goalNavalExecutors } from './goal-naval-executors';
import type { GoalActionKind, GoalExecutorBinding } from './goal-planner-types';
import { regionIndex } from './regions';
import { nativeVoyageBerth } from './voyage-berth';
const ref=(entityId:string)=>({kind:'existing' as const,entityId});
const known:AllocationLandRouteReader=(from,to)=>({status:'known',points:[from,to],distance:Math.hypot(to.x-from.x,to.y-from.y)});
const pending:AllocationLandRouteReader=()=>({status:'unknown',reasonCode:'same-query-pending'});
const unreachable:AllocationLandRouteReader=()=>({status:'unreachable',reasonCode:'same-query-unreachable'});
function strict<T>(run:()=>T,read:AllocationLandRouteReader=known):T {
 return withNavigationAudit(event=>{if(event.phase==='strategy-planning'&&!event.authorization)throw Error(event.operation);},
  ()=>withNavigationPhase('strategy-planning',()=>withAllocationLandRoutes(read,run)));
}
function fixture(snapshot:GameSnapshot,owner:string,kind:GoalActionKind,parameters:GoalExecutorBinding['parameters'],unitIds:string[]):ExecutorInput {
 setBuildingBodies(snapshot.map,standingBodies(snapshot));regionIndex(snapshot.map);
 const target={point:{x:1000,y:1000}},objectiveId='goal',methodId='plan',token={actionId:'ready-atom',generation:1};
 return {snapshot,owner,objective:{id:objectiveId,owner,kind:'ConquerIsland',target,effects:[],utility:{horizonTicks:2400,benefit:[],cost:[],successProbability:1,persistenceBonus:0,score:0},status:'active',sinceTick:snapshot.tick,rank:1,reasons:[],methodIds:[methodId],stability:{minimumStayUntilTick:snapshot.tick,challengerId:null,challengerThinks:0}},
  method:{id:methodId,objectiveId,kind:'staged-beachhead',preconditions:[],subgoals:[],demands:[],estimatedTicks:null,status:'selected',reasons:[]},
  execution:{token,objectiveId,methodId,executor:`goal.${kind}`,intent:{kind:'goal-action',goalId:objectiveId,declarationId:'declaration',actionKind:kind,parameters,outputs:[]},target,dependsOn:[],completionEffects:[],status:'active',phase:'ready',sinceTick:snapshot.tick,lastProgressTick:snapshot.tick,state:{}},
  grant:{revision:1,action:token,objectiveId,methodId,assignments:[],budgets:[],voyages:[],orders:[],commands:[],orderOverrides:[],leases:unitIds.map(id=>({id:`lease:${id}`,resourceKey:`unit:${id}`,objectiveId,methodId,action:token,sinceTick:snapshot.tick,minimumStayUntilTick:snapshot.tick,origin:'allocator',incumbentTask:null}))},events:[]};
}
const run=(input:ExecutorInput)=>goalNavalExecutors.find(executor=>executor.id===input.execution.executor)!.execute(input);
function local() {
 const snapshot=snapshotGame(sketchScene('goal-granted-atoms').map('bareDuel').replaceDefaults().player('us',{team:'a'}).player('foe',{team:'b'})
  .unit('us','footman',800,1000,{id:'fighter'}).unit('us','archer',820,1000,{id:'extra'})
  .worker('us',800,1200,{id:'worker'}).unit('us','transport',1600,1600,{id:'hull'})
  .unit('neutral','ogreWarrior',1500,1000,{id:'guard'}).build().createGame());
 return {snapshot,at:{landId:'land:1' as const,point:{x:1000,y:1000}}};
}
function transport4180() {
 const frame=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/sapphire-control-p4-4180.json.gz',import.meta.url))).toString());
 const snapshot=frame.snapshot as GameSnapshot,boat=snapshot.units.find(u=>u.id==='unit-p4-transport-1151')!,worker=snapshot.units.find(u=>u.id==='unit-p4-worker-2')!;
 setBuildingBodies(snapshot.map,standingBodies(snapshot));const regions=regionIndex(snapshot.map),candidate=regions.shores.find(s=>s.water.x===1648&&s.water.y===2480)!;
 const berth=nativeVoyageBerth(snapshot,worker,boat,candidate);if(berth.status!=='known')throw Error(berth.reasonCode);
 const landing=regions.shores.find(s=>s.landId==='land:3'&&s.seaId===candidate.seaId)!;
 const cargo=shipPassengers(snapshot.units,boat),crew=[...cargo,worker],params={transport:ref(boat.id),cohort:crew.map(u=>ref(u.id)),origin:'land',
  from:{landId:candidate.landId,point:berth.shore.ground},at:{landId:landing.landId,point:landing.ground},departure:{water:berth.shore.water,ground:berth.shore.ground,heading:berth.heading},
  landing:{water:landing.water,ground:landing.ground,heading:0},dependentUnitIds:cargo.map(u=>u.id),berthTolerance:boat.radius};
 return {input:fixture(snapshot,frame.owner,'transport-worker',params,[boat.id,...crew.map(u=>u.id)]),frame,boat,worker,params,cargo};
}

describe('declarative naval actions consume the existing real grant',()=>{
 it('moves only resolved leased assembly members, keeps shared route pending distinct, and never borrows an extra leased neighbor',()=>{
  const f=local(),input=fixture(f.snapshot,'us','assemble',{cohort:[ref('fighter')],at:f.at},['fighter','extra']),before=JSON.stringify(input);
  const p=strict(()=>run(input),pending),u=strict(()=>run(input),unreachable),good=strict(()=>run(input));
  expect(p.commands).toEqual([]);expect(p.reasons[0]?.reason).toBe('assembly-route-pending');expect(u.reasons[0]?.reason).toBe('assembly-route-unreachable');
  expect(good.commands).toHaveLength(1);expect(good.commands[0]!.command).toMatchObject({type:'move',unitIds:['fighter']});
  expect(run({...input,grant:{...input.grant,leases:[]}}).commands).toEqual([]);
  expect(run({...input,execution:{...input.execution,intent:{kind:'borrow-force'}}}).commands).toEqual([]);
  expect(JSON.stringify(input)).toBe(before);expect(strict(()=>run(JSON.parse(before)))).toEqual(good);
  expect(currentAllocationLandRouteReader()).toBeUndefined();
 });
 it('clears only an explicitly bound camp using its safe staging, rather than requiring arrival at the enemy center',()=>{
  const f=local();
  for(let i=0;i<8;i++)f.snapshot.units.push({...f.snapshot.units[0]!,id:`crew-${i}`,x:1000+i,y:1000});
  const cohort=f.snapshot.units.filter(u=>u.id.startsWith('crew-')).map(u=>u.id),at={...f.at,point:{x:1100,y:1000}};
  const input=fixture(f.snapshot,'us','clear-camp',{cohort:cohort.map(ref),at,campId:goalCampId(['guard']),memberIds:['guard']},cohort);
  const good=strict(()=>run(input));expect(good.status).toBe('active');expect(good.state.staging).toEqual(at.point);
  expect(good.commands.length).toBeGreaterThan(0);expect(good.commands.every(c=>'unitIds' in c.command&&c.command.unitIds.every(id=>cohort.includes(id)))).toBe(true);
  const pendingResult=strict(()=>run(input),pending);expect(pendingResult.commands).toEqual([]);
  expect(strict(()=>run({...input,execution:{...input.execution,intent:{...input.execution.intent,kind:'goal-action',goalId:'forged',declarationId:'x',actionKind:'clear-camp',parameters:{},outputs:[]}}})).commands).toEqual([]);
 });
 it('clears an explicit player-held shore without inventing neutral camp members or using ungranted troops',()=>{
  const f=local();f.snapshot.units.find(u=>u.id==='guard')!.owner='foe';
  for(let i=0;i<8;i++)f.snapshot.units.push({...f.snapshot.units[0]!,id:`shore-crew-${i}`,x:1000+i,y:1000});
  const cohort=f.snapshot.units.filter(u=>u.id.startsWith('shore-crew-')).map(u=>u.id);
  const input=fixture(f.snapshot,'us','clear-shore',{cohort:cohort.map(ref),at:f.at,memberIds:[],threatIds:['guard'],throughTick:100},cohort);
  const result=strict(()=>run(input));expect(result.status).toBe('active');
  expect(result.commands.some(c=>c.command.type==='attack'&&c.command.targetId==='guard')).toBe(true);
  expect(result.commands.every(c=>'unitIds' in c.command&&c.command.unitIds.every(id=>cohort.includes(id)))).toBe(true);
 });
 it('guards an empty future construction post through its declared window without requiring an existing hall',()=>{
  const f=local();f.at.point={x:1400,y:1400};const input=fixture(f.snapshot,'us','defend',{cohort:[ref('fighter')],at:f.at,throughTick:100},['fighter']);
  const first=strict(()=>run(input));expect(first.status).toBe('active');expect(first.commands.some(c=>c.command.type==='move')).toBe(true);
  const arrived:ExecutorInput=JSON.parse(JSON.stringify(input));Object.assign(arrived.snapshot.units.find(u=>u.id==='fighter')!,f.at.point);
  const holding=strict(()=>run(arrived));expect(holding.status).toBe('active');expect(holding.phase).toBe('guarding');
  const end={...arrived,snapshot:{...arrived.snapshot,tick:100},execution:{...arrived.execution,state:holding.state}};
  expect(strict(()=>run(end))).toMatchObject({status:'complete',commands:[]});
  expect(strict(()=>run(input),pending).reasons[0]?.reason).toBe('goal-defense-route-pending');
  expect(strict(()=>run({...arrived,snapshot:{...arrived.snapshot,tick:101}}))).toMatchObject({status:'failed',phase:'guard-window-missed'});
 });
 it('moves an empty ship under its own grant and refuses an unleased passenger dependency',()=>{
  const f=local(),at={seaId:'sea:1' as const,point:{x:1800,y:1800}},input=fixture(f.snapshot,'us','position-transport',{transport:ref('hull'),at,tolerance:36,dependentUnitIds:[]},['hull']);
  expect(strict(()=>run(input)).commands[0]!.command).toMatchObject({type:'move',unitIds:['hull'],...at.point});
  const passenger=f.snapshot.units.find(u=>u.id==='worker')!;passenger.deck={shipId:'hull',x:0,y:0};
  expect(strict(()=>run(input)).commands).toEqual([]);
 });
 it('executes an aboard origin directly from its real hull with no departure ground or fabricated voyage allocation',()=>{
  const f=transport4180(),cohort=f.cargo.map(u=>ref(u.id));
  const input={...f.input,execution:{...f.input.execution,intent:{...f.input.execution.intent,kind:'goal-action' as const,goalId:f.input.objective.id,declarationId:'aboard',actionKind:'transport-worker' as const,
   parameters:{...f.params,origin:'aboard',cohort,departure:{water:{x:f.boat.x,y:f.boat.y},heading:0}},outputs:[]}}};
  const before=JSON.stringify(input),result=strict(()=>run(input));expect(result.status).toBe('active');expect(result.commands.some(c=>c.command.type==='unload')).toBe(true);
  expect(result.commands.some(c=>c.command.type==='board'||c.command.type==='move')).toBe(false);expect(input.grant.voyages).toEqual([]);expect(JSON.stringify(input)).toBe(before);
  const missing={...input,grant:{...input.grant,leases:input.grant.leases.filter(l=>l.resourceKey!==`unit:${f.cargo[0]!.id}`)}};
  expect(strict(()=>run(missing)).commands).toEqual([]);
 });
 it('fails an observed loading berth drift at the top level before issuing another board command',()=>{
  const f=transport4180();Object.assign(f.boat,f.params.departure.water);
  const anchored=strict(()=>run(f.input));expect(anchored.phase).toBe('loading');
  f.boat.x+=f.boat.radius*4;
  const request={...f.input,execution:{...f.input.execution,state:anchored.state}},result=strict(()=>run(request));
  expect(result).toMatchObject({status:'failed',phase:'berth-mismatch',commands:[]});expect(result.reasons[0]!.reason).toBe('berth-mismatch');
 });
 it('preserves the native 4180 move → board → deck chain and records only actual loading observations',()=>{
  const f=transport4180(),before=JSON.stringify(f.input),game=createGame(f.input.snapshot.map.id,{players:f.frame.activePlayers,aiPlayers:[]});
  restoreSnapshotIntoGame(game,f.input.snapshot,f.frame.nextId);game.activePlayers=f.frame.activePlayers;
  const runtime=createSdkCommandFrameRuntime(game);let execution=f.input.execution,acceptedBoard=false,observedLoad=false;
  for(let elapsed=0;elapsed<=600;elapsed++){
   if(elapsed%15===0){const snapshot=snapshotGame(game);setBuildingBodies(snapshot.map,standingBodies(snapshot));
    const result=strict(()=>run({...f.input,snapshot,execution}));expect(result.status).not.toBe('failed');
    expect(result.commands.some(c=>c.command.type==='stop')).toBe(false);
    const boat=game.units.find(u=>u.id===f.boat.id)!;
    if(result.commands.some(c=>c.command.type==='board'))expect(distanceTo(boat,f.params.departure.water)).toBeLessThanOrEqual(boat.radius);
    const receipt=runtime.issue(result.commands.map(({command})=>({playerId:f.input.owner,source:'external-agent' as const,scriptId:f.input.execution.executor,command})),{},{checksum:false});
    acceptedBoard ||=receipt.commands.some(c=>c.command.type==='board');execution={...execution,state:result.state,phase:result.phase,status:result.status};
    if(game.units.find(u=>u.id===f.worker.id)!.deck?.shipId===boat.id&&result.progress.some(p=>p.kind==='loaded'&&p.unitIds.includes(f.worker.id))){observedLoad=true;break;}
   }runtime.tick();
  }
  expect(acceptedBoard).toBe(true);expect(observedLoad).toBe(true);expect(JSON.stringify(f.input)).toBe(before);
 },20000);
 it('unloads a real aboard cohort through the public SDK without an invented departure land or speculative completion',()=>{
  const f=transport4180(),game=createGame(f.input.snapshot.map.id,{players:f.frame.activePlayers,aiPlayers:[]});
  restoreSnapshotIntoGame(game,f.input.snapshot,f.frame.nextId);game.activePlayers=f.frame.activePlayers;
  const runtime=createSdkCommandFrameRuntime(game),parameters={...f.params,origin:'aboard',cohort:f.cargo.map(u=>ref(u.id)),
   at:f.params.from,departure:{water:{x:f.boat.x,y:f.boat.y},heading:0},landing:f.params.departure};
  let execution:ExecutorInput['execution']={...f.input.execution,intent:{kind:'goal-action',goalId:f.input.objective.id,declarationId:'aboard-unload',actionKind:'transport-worker',parameters,outputs:[]}},complete=false;
  for(let elapsed=0;elapsed<1200;elapsed++){
   if(elapsed%15===0){const snapshot=snapshotGame(game);setBuildingBodies(snapshot.map,standingBodies(snapshot));
    const result=strict(()=>run({...f.input,snapshot,execution}));expect(result.status).not.toBe('failed');
    expect(result.commands.some(c=>c.command.type==='board')).toBe(false);
    if(result.status==='complete'){
     expect(f.cargo.every(c=>{const unit=game.units.find(u=>u.id===c.id)!;return !unit.deck&&!unit.cabin;})).toBe(true);
     complete=true;break;
    }
    runtime.issue(result.commands.map(({command})=>({playerId:f.input.owner,source:'external-agent' as const,scriptId:f.input.execution.executor,command})),{},{checksum:false});
    execution={...execution,state:result.state,phase:result.phase,status:result.status};
   }runtime.tick();
  }
  expect(complete).toBe(true);
 },20000);
 it('keeps real worker evacuation life saving and acknowledges a preempted cohort without borrowing replacements',()=>{
  const f=local(),at={landId:'land:1' as const,point:{x:200,y:1200}},input=fixture(f.snapshot,'us','evacuate',{unitIds:['worker'],at},['worker']);
  const result=strict(()=>run(input));expect(result.status).toBe('active');expect(result.commands.length).toBeGreaterThan(0);
  expect(result.commands.every(c=>c.purpose==='life-saving'&&'unitIds' in c.command&&c.command.unitIds.every(id=>id==='worker'))).toBe(true);
  const why={code:'defense-preemption',factIds:['worker'],values:{}};
  const preempted:ExecutorInput={...input,grant:{...input.grant,leases:[]},events:[{id:'actual-preemption',tick:0,revision:1,objectiveId:input.objective.id,methodId:input.method.id,action:input.execution.token,reason:why,
   kind:'preempted',handoff:'pending',quotation:{fromObjectiveId:input.objective.id,toObjectiveId:'defense',resourceKeys:['unit:worker'],marginalBenefitGold:100,displacedLossGold:10,switchingCostGold:0,reason:why}}]};
  expect(strict(()=>run(preempted))).toMatchObject({status:'blocked',commands:[],handoffs:[{eventId:'actual-preemption',disposition:'pause'}]});
 });
 it('rejects invalid tokens, future unresolved references and unknown naval kinds before issuing a native command',()=>{
  const f=local(),input=fixture(f.snapshot,'us','assemble',{cohort:[{kind:'output',actionId:'train',output:'unit-0'}],at:f.at},['fighter']);
  expect(strict(()=>run(input)).commands).toEqual([]);
  const wrong={...input,grant:{...input.grant,action:{actionId:'other',generation:1}}};expect(strict(()=>run(wrong)).commands).toEqual([]);
 });
});
function distanceTo(a:{x:number;y:number},b:{x:number;y:number}){return Math.hypot(a.x-b.x,a.y-b.y);}
