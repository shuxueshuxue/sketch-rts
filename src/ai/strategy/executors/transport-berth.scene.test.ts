import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../../shared/sim';
import {createSdkCommandFrameRuntime} from '../../../sdk/commands/frame';
import {shipPassengers} from '../../../shared/ship-geometry';
import {setBuildingBodies} from '../../../shared/terrain';
import {standingBodies} from '../../../shared/structure-bodies';
import {transportExecutor} from './transport';
import {nativeVoyageBerth} from '../voyage-berth';
import {landIdAt,regionIndex,unitLocation} from '../regions';
import {unitRoles} from '../commitments';
import type {ExecutorInput} from '../allocation-types';

// Real world geometry; the explicit grant below is an executor/native contract fixture, not allocator acceptance.
function request4180() {
const frame=JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/sapphire-control-p4-4180.json.gz',import.meta.url))).toString());
const snapshot=frame.snapshot as import('../../../shared/types').GameSnapshot, owner=frame.owner as string;
setBuildingBodies(snapshot.map,standingBodies(snapshot));
const actors=new Map(snapshot.units.map((u:any)=>[u.id,u]));
const boat=snapshot.units.find((u:any)=>u.id==='unit-p4-transport-1151')!;
const worker=snapshot.units.find((u:any)=>u.id==='unit-p4-worker-2')!;
const candidate=regionIndex(snapshot.map).shores.find(s=>s.water.x===1648&&s.water.y===2480)!;
const berth=nativeVoyageBerth(snapshot,worker,boat,candidate);
if(berth.status!=='known')throw new Error(berth.reasonCode);
const mine=snapshot.resources.find((r:any)=>r.id==='gold-satellite-3')!;
const target={entityId:mine.id,landId:landIdAt(snapshot.map,mine)!,point:{x:mine.x,y:mine.y}};
const landing=regionIndex(snapshot.map).shores.find(s=>s.landId===target.landId&&s.seaId===candidate.seaId)!;
const crew=[...shipPassengers(snapshot.units,boat),worker];
const objectiveId='binding-probe',methodId='binding-probe/transport',token={actionId:'binding-probe/deliver',generation:1};
const assignments=[boat,...crew].map(u=>({authority:'committed' as const,id:`assignment:${u.id}`,leaseId:`lease:${u.id}`,unitId:u.id,
 role:unitRoles(u)[0]!,objectiveId,methodId,action:token,target,stage:u.deck?'en-route' as const:'assigned' as const,
 eta:{status:'known' as const,forecastTick:snapshot.tick,arrivalTick:snapshot.tick+100},lastLocation:unitLocation(snapshot.map,u,actors as any,snapshot.tick),interruption:null}));
const voyage={id:'binding-probe/voyage',objectiveId,action:token,shipAssignmentId:`assignment:${boat.id}`,crewAssignmentIds:crew.map(u=>`assignment:${u.id}`),passengerIds:shipPassengers(snapshot.units,boat).map(u=>u.id),
 departure:{point:berth.shore.water,seaId:candidate.seaId},destination:{...target,point:landing.water},
 departureGround:{point:berth.shore.ground,landId:candidate.landId},landingGround:{point:landing.ground,landId:target.landId},
 phase:'loading',startedTick:snapshot.tick,expectedFreeTick:null,decision:'continue'};
const input={snapshot,owner,objective:{id:objectiveId,owner,kind:'ConquerIsland',target,effects:[],utility:{horizonTicks:2400,benefit:[],cost:[],successProbability:1,persistenceBonus:0,score:0},status:'active',sinceTick:snapshot.tick,rank:1,reasons:[],methodIds:[methodId],stability:{minimumStayUntilTick:snapshot.tick,challengerId:null,challengerThinks:0}},
 method:{id:methodId,objectiveId,kind:'staged-beachhead',preconditions:[],subgoals:[],demands:[],estimatedTicks:null,status:'selected',reasons:[]},
 execution:{token,objectiveId,methodId,executor:'strategy.transport',intent:{kind:'deliver-workers'},target,dependsOn:[],completionEffects:[],status:'active',phase:'loading',sinceTick:snapshot.tick,lastProgressTick:snapshot.tick,state:{}},
 grant:{revision:1,action:token,objectiveId,methodId,assignments,voyages:[voyage],leases:assignments.map(a=>({id:a.leaseId,resourceKey:`unit:${a.unitId}`,objectiveId,methodId,action:token,sinceTick:snapshot.tick,minimumStayUntilTick:snapshot.tick,origin:'allocator',incumbentTask:null})),budgets:[],orders:[],commands:[],orderOverrides:[]},events:[]} as unknown as ExecutorInput;
return {input, frame};
}

function atRendezvous(input: ExecutorInput): ExecutorInput {
  const copy: ExecutorInput = JSON.parse(JSON.stringify(input)), voyage=copy.grant.voyages[0]!;
  const boatId=copy.grant.assignments.find(a=>a.id===voyage.shipAssignmentId)!.unitId;
  const crewIds=new Set(copy.grant.assignments.filter(a=>voyage.crewAssignmentIds.includes(a.id)).map(a=>a.unitId));
  for(const unit of copy.snapshot.units) {
    if(unit.id===boatId) { Object.assign(unit,voyage.departure.point); unit.order={type:'idle'}; }
    else if(crewIds.has(unit.id)&&!unit.deck&&!unit.cabin) { Object.assign(unit,voyage.departureGround.point); unit.order={type:'idle'}; }
  }
  setBuildingBodies(copy.snapshot.map,standingBodies(copy.snapshot));
  return copy;
}
function fork(input: ExecutorInput): ExecutorInput {
  const copy: ExecutorInput=JSON.parse(JSON.stringify(input));
  setBuildingBodies(copy.snapshot.map,standingBodies(copy.snapshot));
  return copy;
}

it('moves the granted hull before boarding people in the real 4180 frame',()=>{
  const {input}=request4180(), before=JSON.stringify(input), result=transportExecutor.execute(input);
  expect(result.status).toBe('active');
  expect(result.commands.some(entry=>entry.command.type==='board')).toBe(false);
  const voyage=input.grant.voyages[0]!;
  expect(result.commands.some(({command})=>command.type==='move'&&command.unitIds.includes('unit-p4-transport-1151')
    &&command.x===voyage.departure.point.x&&command.y===voyage.departure.point.y)).toBe(true);
  expect(result.commands.some(({command})=>command.type==='move'&&command.unitIds.includes('unit-p4-worker-2'))).toBe(false);
  const granted=new Set(input.grant.assignments.map(a=>a.unitId));
  expect(result.commands.every(({command})=>!('unitIds' in command)||command.unitIds.every(id=>granted.has(id)))).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
  expect(transportExecutor.execute(fork(input))).toEqual(result);
});

it('accepts the planned native board berth after both sides rendezvous and preserves a JSON fork',()=>{
  const {input:initial,frame}=request4180(), input=atRendezvous(initial), before=JSON.stringify(input);
  const result=transportExecutor.execute(input);
  expect(result.status).toBe('active');
  expect(result.commands.some(entry=>entry.command.type==='board')).toBe(true);
  const game=createGame(input.snapshot.map.id,{players:frame.activePlayers,aiPlayers:[]});
  restoreSnapshotIntoGame(game,input.snapshot,frame.nextId);game.activePlayers=frame.activePlayers;
  const runtime=createSdkCommandFrameRuntime(game);
  const receipt=runtime.issue(result.commands.map(({command})=>({playerId:input.owner,source:'external-agent' as const,scriptId:'strategy.transport',command})),{}, {checksum:false});
  expect(receipt.commands.some(({command})=>command.type==='board')).toBe(true);
  const worker=game.units.find(u=>u.id==='unit-p4-worker-2')!, voyage=input.grant.voyages[0]!;
  expect(worker.order.type).toBe('board'); if(worker.order.type!=='board')return;
  expect(worker.order.berth).toMatchObject({...voyage.departure.point,shore: voyage.departureGround.point});
  expect(JSON.stringify(input)).toBe(before);
  expect(transportExecutor.execute(fork(input))).toEqual(result);
});

it('propagates actual hull drift outside one radius as a top-level failed action',()=>{
  const {input:initial}=request4180(), input=atRendezvous(initial), voyage=input.grant.voyages[0]!;
  const anchored=transportExecutor.execute(input), request={...input,execution:{...input.execution,state:anchored.state}};
  const boat=request.snapshot.units.find(unit=>unit.id==='unit-p4-transport-1151')!;
  boat.x+=boat.radius*4;
  const before=JSON.stringify(request);
  const result=transportExecutor.execute(request);
  expect(result.status).toBe('failed');
  expect(result.reasons.some(reason=>reason.reason==='berth-mismatch')).toBe(true);
  expect(result.commands.some(entry=>entry.command.type==='board')).toBe(false);
  expect(result.state.voyages).toMatchObject({[voyage.id]:{status:'failed',phase:'berth-mismatch'}});
  expect(JSON.stringify(request)).toBe(before);
  expect(transportExecutor.execute(fork(request))).toEqual(result);
});

it('does not confuse a proposed native berth with the observed hull position',()=>{
  const {input:initial}=request4180(), input=atRendezvous(initial), voyage=input.grant.voyages[0]!;
  const person=input.snapshot.units.find(unit=>unit.id==='unit-p4-worker-2')!;
  person.order={type:'board',transportId:'unit-p4-transport-1151',berth:{x:1648,y:2480,shore:{...voyage.departureGround.point}}};
  const result=transportExecutor.execute(input);
  expect(result.status).toBe('active');
  expect(result.reasons.some(reason=>reason.reason==='berth-mismatch')).toBe(false);
});

it('loads onto the planned hull through the full public native command chain in 4180',()=>{
  const {input,frame}=request4180(), before=JSON.stringify(input);
  const game=createGame(input.snapshot.map.id,{players:frame.activePlayers,aiPlayers:[]});
  restoreSnapshotIntoGame(game,input.snapshot,frame.nextId);game.activePlayers=frame.activePlayers;
  const runtime=createSdkCommandFrameRuntime(game), voyage=input.grant.voyages[0]!;
  let execution=input.execution, acceptedBoard=false, loaded=false;
  for(let elapsed=0;elapsed<=600;elapsed++) {
    if(elapsed%15===0) {
      const snapshot=snapshotGame(game);setBuildingBodies(snapshot.map,standingBodies(snapshot));
      const result=transportExecutor.execute({...input,snapshot,execution});
      expect(result.status).not.toBe('failed');
      expect(result.commands.some(({command})=>command.type==='stop'&&command.unitIds.includes('unit-p4-transport-1151'))).toBe(false);
      const boat=game.units.find(unit=>unit.id==='unit-p4-transport-1151')!;
      if(result.commands.some(entry=>entry.command.type==='board'))
        expect(Math.hypot(boat.x-voyage.departure.point.x,boat.y-voyage.departure.point.y)).toBeLessThanOrEqual(boat.radius);
      const receipt=runtime.issue(result.commands.map(({command})=>({playerId:input.owner,source:'external-agent' as const,scriptId:'strategy.transport',command})),{}, {checksum:false});
      acceptedBoard ||= receipt.commands.some(entry=>entry.command.type==='board');
      execution={...execution,state:result.state,status:result.status,phase:result.phase};
      const worker=game.units.find(unit=>unit.id==='unit-p4-worker-2')!;
      if(worker.deck?.shipId===boat.id&&result.progress.some(progress=>progress.kind==='loaded'&&progress.unitIds.includes(worker.id))) {
        expect(Math.hypot(boat.x-voyage.departure.point.x,boat.y-voyage.departure.point.y)).toBeLessThanOrEqual(boat.radius);
        expect(result.state.voyages).toMatchObject({[voyage.id]:{loadReceipts:{[worker.id]:{
          predictedLoadedTick:null,observedLoadedTick:game.tick,errorTicks:null,aboardAtStart:false}}}});
        loaded=true;break;
      }
    }
    runtime.tick();
  }
  expect(acceptedBoard).toBe(true);expect(loaded).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
},20000);

it('keeps the first real loading forecast when later quotations revise it',()=>{
  const {input:initial,frame}=request4180(), voyage=initial.grant.voyages[0]!, expected=initial.snapshot.tick+400;
  // Forecast numbers are injected to test receipt identity, not fitted ETA accuracy.
  const epoch=initial.snapshot.tick-30, revisedEpoch=initial.snapshot.tick-15;
  const input={...initial,grant:{...initial.grant,voyages:[{...voyage,expectedLoadedTick:expected,loadingForecastTick:epoch}]}};
  const first=transportExecutor.execute(input);
  const revised=atRendezvous({...input,execution:{...input.execution,state:first.state},
    grant:{...input.grant,voyages:[{...voyage,expectedLoadedTick:expected+100,loadingForecastTick:revisedEpoch}]}});
  const boarding=transportExecutor.execute(revised);
  const game=createGame(input.snapshot.map.id,{players:frame.activePlayers,aiPlayers:[]});
  restoreSnapshotIntoGame(game,revised.snapshot,frame.nextId);game.activePlayers=frame.activePlayers;
  const runtime=createSdkCommandFrameRuntime(game);
  runtime.issue(boarding.commands.map(({command})=>({playerId:input.owner,source:'external-agent' as const,scriptId:'strategy.transport',command})),{}, {checksum:false});
  for(let step=0;step<90&&!game.units.find(unit=>unit.id==='unit-p4-worker-2')!.deck;step++)runtime.tick();
  expect(game.units.find(unit=>unit.id==='unit-p4-worker-2')!.deck?.shipId).toBe('unit-p4-transport-1151');
  const snapshot=snapshotGame(game);setBuildingBodies(snapshot.map,standingBodies(snapshot));
  const result=transportExecutor.execute({...revised,snapshot,execution:{...revised.execution,state:boarding.state}});
  expect(result.state.voyages).toMatchObject({[voyage.id]:{
    expectedLoadedTick:expected,loadingForecastTick:epoch,
    latestLoadingPrediction:{forecastTick:revisedEpoch,expectedLoadedTick:expected+100},
    loadReceipts:{'unit-p4-worker-2':{forecastTick:epoch,predictedLoadedTick:expected,
      observedLoadedTick:game.tick,errorTicks:game.tick-expected,aboardAtStart:false}}}});
});

it('retains a forecast epoch across thinks and records a new epoch even when its expected tick is unchanged',()=>{
  const {input:initial}=request4180(), voyage=initial.grant.voyages[0]!, expected=initial.snapshot.tick+400;
  const epoch=initial.snapshot.tick-30;
  const input={...initial,grant:{...initial.grant,voyages:[{...voyage,expectedLoadedTick:expected,loadingForecastTick:epoch}]}};
  const first=transportExecutor.execute(input);
  const retained=fork({...input,execution:{...input.execution,state:first.state}});
  retained.snapshot.tick+=15;
  const before=JSON.stringify(retained), replay=transportExecutor.execute(retained);
  expect(replay.state.voyages).toMatchObject({[voyage.id]:{
    expectedLoadedTick:expected,loadingForecastTick:epoch,
    latestLoadingPrediction:{forecastTick:epoch,expectedLoadedTick:expected},
  }});
  expect(JSON.stringify(retained)).toBe(before);
  expect(transportExecutor.execute(fork(retained))).toEqual(replay);
  const freshEpoch=retained.snapshot.tick;
  const refreshed=transportExecutor.execute({...retained,execution:{...retained.execution,state:replay.state},
    grant:{...retained.grant,voyages:[{...voyage,expectedLoadedTick:expected,loadingForecastTick:freshEpoch}]}});
  expect(refreshed.state.voyages).toMatchObject({[voyage.id]:{
    expectedLoadedTick:expected,loadingForecastTick:epoch,
    latestLoadingPrediction:{forecastTick:freshEpoch,expectedLoadedTick:expected},
  }});
  const unknown=transportExecutor.execute({...retained,execution:{...retained.execution,state:refreshed.state},
    grant:{...retained.grant,voyages:[voyage]}});
  expect(unknown.state.voyages).toMatchObject({[voyage.id]:{
    expectedLoadedTick:expected,loadingForecastTick:epoch,
    latestLoadingPrediction:{forecastTick:freshEpoch,expectedLoadedTick:expected},
  }});
});

it('does not turn an expected tick without its source epoch into a loading prediction or error sample',()=>{
  const {input:initial}=request4180(), voyage=initial.grant.voyages[0]!, expected=initial.snapshot.tick+400;
  const input={...initial,grant:{...initial.grant,voyages:[{...voyage,expectedLoadedTick:expected}]}};
  const first=transportExecutor.execute(input);
  expect(first.commands).toEqual(transportExecutor.execute(initial).commands);
  expect(first.state.voyages).toMatchObject({[voyage.id]:{
    expectedLoadedTick:null,loadingForecastTick:null,latestLoadingPrediction:null,
  }});
  const aboard=atRendezvous({...input,execution:{...input.execution,state:first.state}});
  aboard.snapshot.tick+=15;
  aboard.snapshot.units.find(unit=>unit.id==='unit-p4-worker-2')!.deck={shipId:'unit-p4-transport-1151',x:0,y:0};
  const result=transportExecutor.execute(aboard);
  expect(result.state.voyages).toMatchObject({[voyage.id]:{loadReceipts:{'unit-p4-worker-2':{
    forecastTick:null,predictedLoadedTick:null,observedLoadedTick:aboard.snapshot.tick,errorTicks:null,aboardAtStart:false,
  }}}});
});
