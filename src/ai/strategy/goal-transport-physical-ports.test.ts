import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { bodyMass } from '../../shared/physical-body';
import { distanceToHull, shareShipProfile, shipProfile } from '../../shared/ship-geometry';
import { boardingBerth, BOARDING_GAP } from '../../shared/naval';
import { hullFits } from '../../shared/ship-navigation';
import { isWalkable } from '../../shared/terrain';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import { FactWorkQueue } from './fact-work';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory, GoalHullCandidate } from './goal-grounding-ports';
import type { GoalCandidates, GoalEntityReference, GoalFactReader, GoalProductionOption } from './goal-planner-types';
import { createGoalTransportFactPorts, type GoalTransportPhysicalInput } from './goal-transport-physical-ports';
import { regionIndex, seaIdAt } from './regions';
const choices = <T>(candidates: readonly T[]): GoalCandidates<T> => ({ state: 'met', candidates, factIds: ['actual-domain'] });
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
function frame() {
 const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
 const regions = regionIndex(snapshot.map), worker = snapshot.units.find(unit => unit.id === 'unit-p4-worker-2')!;
 const hull = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
 const from = { landId: 'land:2' as const, point: { x: 1584, y: 2448 } }, to = { landId: 'land:3' as const, point: { x: 2864, y: 4208 } };
 const cohort: GoalEntityReference[] = [{ kind: 'existing', entityId: worker.id }];
 const readFact: GoalFactReader = fact => ({ fact, state: 'pending', requestId: fact.id, requestedTick: snapshot.tick,
  observedTick: snapshot.tick, revision: 'route-pending', reason: { code: 'route-pending', factIds: [], values: {} }, evidence: [] });
 let memory: GoalGeometryMemory = { version: 1, entries: [] };
 function think(turn=0,limit=6144,extra:Partial<GoalTransportPhysicalInput>={}) {
  const tick=snapshot.tick+15*turn, work=new FactWorkQueue(tick,limit);
  const input:GoalTransportPhysicalInput={snapshot,owner,tick,byTick:9000,regions,geometry:createGoalGeometryReader({tick,work,memory}),geometryRevision:'native-original',readFact,
   resolveCohort: refs=>choices(refs.flatMap(reference=>reference.kind==='existing'?snapshot.units.filter(unit=>unit.id===reference.entityId).map(assessment=>({reference,assessment})):[])),
   productionOptions:()=>choices([]),readPointRoute:vi.fn<GoalTransportPhysicalInput['readPointRoute']>((_ship,from,to)=>({id:'shared-point-route',fact:{status:'complete',route:{partial:false,points:[{...to,heading:from.heading}]},ticks:20,computedTick:tick,work:0,basis:'continued-native-search'}})),...extra};
  return {ports:createGoalTransportFactPorts(input),work,input,finish(){strict(()=>work.flush());memory=JSON.parse(JSON.stringify(memory));}};
 }
 return {snapshot,owner,regions,worker,hull,from,to,cohort,think};
}

function preferredFixture() {
 const f=frame(), coast=f.regions.shoresByLand.get(f.from.landId)!.get('sea:1')![0]!;
 const dock={...f.hull,...coast.water};shareShipProfile(f.hull,dock);
 // Independent native placement oracle, outside the measured/guarded port.
 const native=boardingBerth(f.snapshot.map,{...f.worker,...coast.ground},dock);
 if(!native?.shore||native.heading===undefined)throw Error('fixture needs a native target dock');
 const shore={...coast,ground:{x:native.shore.x,y:native.shore.y}},pose={x:native.x,y:native.y,heading:native.heading};
 const hull:GoalHullCandidate={id:f.hull.id,reference:{kind:'existing',entityId:f.hull.id},assessment:f.hull,seaId:'sea:1',
  availableTick:f.snapshot.tick,capacity:1000,cargoUnitIds:[],preconditions:[],factIds:['fixture-hull']};
 return {...f,shore,pose,candidate:hull};
}

it('publishes a given target pose after six budgeted native checks and JSON turns, without routes or current arrival',()=>{
 const f=preferredFixture(), before=JSON.stringify(f.snapshot);
 const exact=vi.fn(()=>{throw Error('single target-pose check requested route/projection');});
 for(let turn=0;turn<6;turn++){
  const t=f.think(turn,1,{readFact:exact,readGroundPoint:exact}),read=strict(()=>t.ports.berth(f.worker,f.candidate,f.shore,f.pose));
  expect(read.state).toBe('pending');t.finish();expect(t.work.receipt.used).toBe(1);
  expect(strict(()=>t.ports.berth(f.worker,f.candidate,f.shore,f.pose)).state).toBe('pending');
 }
 const t=f.think(6,0,{readFact:exact,readGroundPoint:exact}),read=strict(()=>t.ports.berth(f.worker,f.candidate,f.shore,f.pose));
 expect(read).toMatchObject({state:'met',value:{water:{x:f.pose.x,y:f.pose.y},heading:f.pose.heading,ground:f.shore.ground}});
 expect(exact).not.toHaveBeenCalled();expect(t.input.readPointRoute).not.toHaveBeenCalled();
 t.finish();expect(t.work.receipt.used).toBe(0);expect(JSON.stringify(f.snapshot)).toBe(before);
 expect(Math.hypot(f.hull.x-f.pose.x,f.hull.y-f.pose.y)).toBeGreaterThan(f.hull.radius);
});

it('keeps exact target-pose proofs stable under live hull movement but versions pose, radius, shore, shape and terrain',()=>{
 const f=preferredFixture(),a=f.think(0),first=strict(()=>a.ports.berth(f.worker,f.candidate,f.shore,f.pose));
 expect(first.state).toBe('pending');a.finish();expect(a.work.receipt.used).toBe(6);
 const b=f.think(1,0),known=strict(()=>b.ports.berth(f.worker,f.candidate,f.shore,f.pose));expect(known.state).toBe('met');
 f.hull.x+=1;f.hull.sailing!.heading+=.321;
 const c=f.think(2,0),moved=strict(()=>c.ports.berth(f.worker,f.candidate,f.shore,f.pose));expect(moved).toEqual(known);
 const variants=[
  c.ports.berth(f.worker,f.candidate,f.shore,{...f.pose,x:f.pose.x+.0001}),
  c.ports.berth(f.worker,f.candidate,f.shore,{...f.pose,heading:f.pose.heading+.0001}),
  c.ports.berth({...f.worker,radius:f.worker.radius+.0001},f.candidate,f.shore,f.pose),
  c.ports.berth(f.worker,f.candidate,{...f.shore,ground:{...f.shore.ground,x:f.shore.ground.x+.0001}},f.pose),
  c.ports.berth(f.worker,{...f.candidate,assessment:{...f.hull,kind:'carrier'}},f.shore,f.pose),
  f.think(2,0,{geometryRevision:'changed-terrain'}).ports.berth(f.worker,f.candidate,f.shore,f.pose),
 ];
 for(const read of variants){expect(read.state).toBe('pending');if(read.state==='pending'&&first.state==='pending')expect(read.requestIds).not.toEqual(first.requestIds);}
 c.finish();expect(c.work.receipt.used).toBe(0);
});

it('waits for a known failed preferred pose before falling back to the unchanged native scan',()=>{
 const f=preferredFixture(),pose={x:-1000,y:-1000,heading:0};
 const a=f.think(0,0),unstarted=strict(()=>a.ports.berth(f.worker,f.candidate,f.shore,pose));
 expect(unstarted.state).toBe('pending');a.finish();expect(a.work.receipt.used).toBe(0);
 const b=f.think(1,6),checking=strict(()=>b.ports.berth(f.worker,f.candidate,f.shore,pose));
 expect(checking.state).toBe('pending');b.finish();expect(b.work.receipt.used).toBe(2);
 const c=f.think(2,0),fallback=strict(()=>c.ports.berth(f.worker,f.candidate,f.shore,pose));
 const original=strict(()=>c.ports.berth(f.worker,f.candidate,f.shore));
 expect(fallback).toEqual(original);expect(fallback.state).toBe('pending');
 if(fallback.state==='pending'&&unstarted.state==='pending')expect(fallback.requestIds).not.toEqual(unstarted.requestIds);
 c.finish();expect(c.work.receipt.used).toBe(0);
});

it.each(['hull-fit','boarding-gap','land-region','sea-region'] as const)('rejects a known invalid %s without publishing the preferred pose',failure=>{
 const f=preferredFixture();let shore=f.shore,pose=f.pose;
 if(failure==='land-region')shore={...shore,landId:'land:999'};
 else if(failure==='sea-region')shore={...shore,seaId:'sea:999'};
 else {
  let found:typeof pose|undefined;
  for(let step=0;step<=128&&!found;step++)for(let direction=0;direction<8&&!found;direction++){
   const value={x:f.pose.x+Math.cos(direction*Math.PI/4)*step,y:f.pose.y+Math.sin(direction*Math.PI/4)*step,
    heading:f.pose.heading+(failure==='hull-fit'?Math.PI/2:0)};
   const dock={...f.hull,x:value.x,y:value.y,sailing:{...f.hull.sailing!,heading:value.heading}};shareShipProfile(f.hull,dock);
   if(!isWalkable(f.snapshot.map,value.x,value.y,'sea')||seaIdAt(f.snapshot.map,value)!==f.shore.seaId)continue;
   const fit=hullFits(f.snapshot.map,dock,value),gap=distanceToHull(dock,f.shore.ground);
   if(failure==='hull-fit'?!fit:fit&&gap>f.worker.radius+BOARDING_GAP)found=value;
  }
  if(!found)throw Error('fixture has no native '+failure+' counterexample');pose=found;
 }
 const a=f.think(0),first=strict(()=>a.ports.berth(f.worker,f.candidate,shore,pose));
 expect(first.state).toBe('pending');a.finish();expect(a.work.receipt.used).toBeGreaterThan(0);expect(a.work.receipt.used).toBeLessThanOrEqual(6);
 const b=f.think(1,0),fallback=strict(()=>b.ports.berth(f.worker,f.candidate,shore,pose));
 expect(fallback).toEqual(strict(()=>b.ports.berth(f.worker,f.candidate,shore)));expect(fallback.state).toBe('pending');
 if(first.state==='pending'&&fallback.state==='pending')expect(first.requestIds).not.toEqual(fallback.requestIds);
 b.finish();expect(b.work.receipt.used).toBe(0);
});

it('keeps an invalid pose, missing hull profile and unfinished region index pending without synchronous work',()=>{
 const f=preferredFixture(),t=f.think(0,0);
 expect(strict(()=>t.ports.berth(f.worker,f.candidate,f.shore,{...f.pose,heading:NaN})))
  .toMatchObject({state:'pending',reason:{code:'preferred-boarding-pose-invalid'}});
 expect(strict(()=>t.ports.berth(f.worker,{...f.candidate,assessment:f.worker},f.shore,f.pose)))
  .toMatchObject({state:'pending',reason:{code:'preferred-boarding-profile-unpublished'}});
 const pendingIndex=f.think(0,0,{regions:{...f.regions,scannedRows:0}});
 expect(strict(()=>pendingIndex.ports.berth(f.worker,f.candidate,f.shore,f.pose)))
  .toMatchObject({state:'pending',reason:{code:'preferred-boarding-regions-unpublished'}});
 t.finish();pendingIndex.finish();expect(t.work.receipt.used).toBe(0);expect(pendingIndex.work.receipt.used).toBe(0);
});

it('slices prepared native shore pairs, survives JSON turns, and leaves omitted alternatives explicit',()=>{
 const f=frame(), before=JSON.stringify(f.snapshot); let t=f.think(0,0);
 expect(strict(()=>t.ports.shores(f.from,f.to)).state).toBe('pending');t.finish();expect(t.work.receipt.used).toBe(0);
 let result= t.ports.shores(f.from,f.to), work=0;
 for(let i=1;i<200&&result.state==='pending';i++){t=f.think(i);result=strict(()=>t.ports.shores(f.from,f.to));t.finish();work+=t.work.receipt.used;expect(t.work.receipt.used).toBeLessThanOrEqual(6144);}
 expect(result.state).toBe('met');if(result.state!=='met')throw Error('not published');
 expect(result.candidates.length).toBeGreaterThan(1);expect(result.candidates.length).toBeLessThanOrEqual(16);
 for(const pair of result.candidates){expect(pair.departure?.landId).toBe(f.from.landId);expect(pair.landing.landId).toBe(f.to.landId);expect(pair.departure?.seaId).toBe(pair.seaId);}
 expect(result.deferred?.[0]?.reason.code).toBe('shore-alternative-prefix-limited');expect(work).toBeGreaterThan(16);expect(JSON.stringify(f.snapshot)).toBe(before);
 const starts=f.regions.shoresByLand.get(f.from.landId)!,ends=f.regions.shoresByLand.get(f.to.landId)!;
 const factoredBound=[...starts.keys()].filter(sea=>ends.has(sea)).reduce((sum,sea)=>sum+starts.get(sea)!.length+ends.get(sea)!.length+16*16,0);
 expect(work).toBeLessThanOrEqual(factoredBound);
 // Independent exhaustive ordering checks the pruned prefix. This oracle is
 // outside the measured queue and never supplies production geometry facts.
 const exhaustive:{id:string;rank:number}[]=[],tag=(s:typeof f.regions.shores[number])=>`${s.landId}:${s.ground.x},${s.ground.y}:${s.water.x},${s.water.y}`;
 for(const [sea,ds] of starts)for(const d of ds)for(const e of ends.get(sea)??[]){
  const id=`shore:${sea}:${tag(d)}>${tag(e)}`,rank=Math.hypot(e.ground.x-f.to.point.x,e.ground.y-f.to.point.y)+Math.hypot(d.ground.x-f.from.point.x,d.ground.y-f.from.point.y),last=exhaustive.at(-1);
  if(exhaustive.length===16&&last&&(rank>last.rank||rank===last.rank&&id>=last.id))continue;
  exhaustive.push({id,rank});exhaustive.sort((a,b)=>a.rank-b.rank||(a.id<b.id?-1:a.id>b.id?1:0));if(exhaustive.length>16)exhaustive.pop();
 }
 expect(result.candidates.map(p=>p.id)).toEqual(exhaustive.map(p=>p.id));
});

it('reads actual payload and all deck/cabin dependencies without confusing kilograms with passenger count',()=>{
 const f=frame(), t=f.think(), result=strict(()=>t.ports.hulls('sea:1',f.from,bodyMass(f.worker),{cohort:f.cohort}));
 expect(result.state).toBe('met');if(result.state!=='met')throw Error('no hull');
 const actual=result.candidates.find(h=>h.reference.kind==='existing'&&h.reference.entityId===f.hull.id)!;
 const cargo=f.snapshot.units.filter(u=>(u.deck?.shipId??u.cabin?.shipId)===f.hull.id);
 expect(actual.cargoUnitIds).toEqual(cargo.map(u=>u.id).sort());
 expect(actual.capacity).toBe(shipProfile(f.hull)!.loadCapacity-cargo.reduce((sum,u)=>sum+bodyMass(u),0));
 expect(strict(()=>t.ports.hulls('sea:1',f.from,1,{cohort:f.cohort}))).toMatchObject({state:'unmet',reason:{code:'transport-payload-binding-mismatch'}});
 expect(t.input.readPointRoute).not.toHaveBeenCalled();
});

it('keeps an aboard coast request stable while its hull moves within the same sea',()=>{
 const f=frame(),t=f.think(0,0);
 const first=strict(()=>t.ports.shores({seaId:'sea:1',point:{x:1500,y:2500}},f.to));
 const moved=strict(()=>t.ports.shores({seaId:'sea:1',point:{x:1600,y:2500}},f.to));
 expect(first.state).toBe('pending');expect(moved.state).toBe('pending');
 if(first.state==='pending'&&moved.state==='pending')expect(first.requestIds).toEqual(moved.requestIds);
});

it('versions coast scans by the prepared shore index independently of dynamic berth geometry',()=>{
 const f=frame();
 const first=f.think(0,0,{shoreGeometryRevision:'terrain-a',geometryRevision:'bodies-a'}).ports.shores(f.from,f.to);
 const dynamic=f.think(1,0,{shoreGeometryRevision:'terrain-a',geometryRevision:'bodies-b'}).ports.shores(f.from,f.to);
 const terrain=f.think(2,0,{shoreGeometryRevision:'terrain-b',geometryRevision:'bodies-b'}).ports.shores(f.from,f.to);
 expect(first.state).toBe('pending');expect(dynamic.state).toBe('pending');expect(terrain.state).toBe('pending');
 if(first.state==='pending'&&dynamic.state==='pending'&&terrain.state==='pending'){
  expect(dynamic.requestIds).toEqual(first.requestIds);expect(terrain.requestIds).not.toEqual(first.requestIds);
 }
});

it('keeps current hulls usable alongside missing future metadata, then accepts only explicit symbolic native shapes',()=>{
 const f=frame(), producer:GoalProductionOption={id:'real-yard',buildingKind:'shipyard',producer:{kind:'existing',entityId:'yard'},at:{seaId:'sea:1',point:f.from.point},availableTick:null,preconditions:[],factIds:['yard']};
 const productionOptions:GoalTransportPhysicalInput['productionOptions']=kind=>choices(kind==='transport'?[producer]:[]);
 const t=f.think(0,6144,{productionOptions});let result=strict(()=>t.ports.hulls('sea:1',f.from,bodyMass(f.worker),{cohort:f.cohort}));
 expect(result.state).toBe('met');if(result.state!=='met')throw Error('no current hull');expect(result.deferred?.[0]?.reason.code).toBe('produced-hull-metadata-unquoted');
 const future:GoalHullCandidate={id:'future-option',reference:{kind:'output',actionId:'train-ship',output:'unit-0'},assessment:{...f.hull,id:'private-future-shape'},seaId:'sea:1',availableTick:8000,capacity:10000,cargoUnitIds:[],preconditions:[],factIds:['native-prototype']};
 const next=f.think(1,6144,{productionOptions,resolveProducedHull:()=>({state:'met',value:future,factIds:['produced-output']})});
 result=strict(()=>next.ports.hulls('sea:1',f.from,bodyMass(f.worker),{cohort:f.cohort}));
 expect(result.state).toBe('met');if(result.state!=='met')throw Error('no hulls');expect(result.candidates.some(h=>h.reference.kind==='output')).toBe(true);
 expect(result.candidates.find(h=>h.reference.kind==='output')!.factIds).toContain('produced-output');
 expect(result.candidates.find(h=>h.reference.kind==='output')!.capacity).toBeLessThanOrEqual(shipProfile(f.hull)!.loadCapacity);
 const route=strict(()=>next.ports.seaLeg(future,{x:2000,y:2400,heading:1.23},{x:2500,y:2400},true));
 expect(route).toMatchObject({state:'met',value:{ticks:20,heading:1.23},factIds:['shared-point-route']});
});

it('preserves shared point-route pending/transient/static answers and exact source heading',()=>{
 const f=frame(), actual:GoalHullCandidate={id:f.hull.id,reference:{kind:'existing',entityId:f.hull.id},assessment:f.hull,seaId:'sea:1',availableTick:f.snapshot.tick,capacity:1000,cargoUnitIds:[],preconditions:[],factIds:[]};
 for(const status of ['pending','transient-blocked','static-infeasible'] as const){
  const t=f.think(0,6144,{readPointRoute:(ship,from)=>{expect(ship.sailing?.heading).toBe(from.heading);return{id:'native-route-request',fact:{status,reasonCode:'native-'+status,work:13}};}});
  const result=strict(()=>t.ports.seaLeg(actual,{x:f.hull.x,y:f.hull.y,heading:2.5},{x:2000,y:2400},false));
  expect(result.state).toBe(status==='static-infeasible'?'unmet':'pending');
  if(result.state==='pending')expect(result.requestIds).toEqual(['native-route-request']);
 }
});

it('requests existing voyage risk only for a published exact native sea leg and preserves the model result',()=>{
 const f=frame(),actual:GoalHullCandidate={id:f.hull.id,reference:{kind:'existing',entityId:f.hull.id},assessment:f.hull,seaId:'sea:1',availableTick:f.snapshot.tick,capacity:1000,cargoUnitIds:[],preconditions:[],factIds:[]};
 const risk={status:'known' as const,survivalProbability:.73,expectedDamage:12,expectedHpLoss:12,damageErrorBound:1,samples:17,totalSamples:17,computedTick:f.snapshot.tick,basis:'native-route-exposure' as const,threatIds:['actual-coastal-enemy']};
 const readVoyageRisk=vi.fn<NonNullable<GoalTransportPhysicalInput['readVoyageRisk']>>(()=>risk),from={x:f.hull.x,y:f.hull.y,heading:2.5},to={x:2000,y:2400};
 const t=f.think(0,6144,{readVoyageRisk}),result=strict(()=>t.ports.seaLeg(actual,from,to,false));
 expect(result).toMatchObject({state:'met',value:{risk}});expect(readVoyageRisk).toHaveBeenCalledTimes(1);
 const request=readVoyageRisk.mock.calls[0]![0];
 expect(request).toMatchObject({shipId:f.hull.id,seaId:'sea:1',start:from,destination:to,route:{partial:false,points:[{...to,heading:from.heading}]}});
 expect(request.id.length).toBeLessThanOrEqual(256);
 const delayed=f.think(0,6144,{readVoyageRisk,readPointRoute:()=>({id:'pending-point',fact:{status:'pending',reasonCode:'shared-pending',work:0}})});
 expect(strict(()=>delayed.ports.seaLeg(actual,from,to,false)).state).toBe('pending');expect(readVoyageRisk).toHaveBeenCalledTimes(1);
 const nearby={x:to.x-1,y:to.y,heading:from.heading};
 const endpoint=f.think(0,6144,{readVoyageRisk,readPointRoute:()=>({id:'legal-short-endpoint',fact:{status:'complete',route:{partial:false,points:[nearby]},ticks:20,computedTick:f.snapshot.tick,work:0,basis:'continued-native-search'}})});
 expect(strict(()=>endpoint.ports.seaLeg(actual,from,to,false)).state).toBe('met');
 expect(readVoyageRisk.mock.calls[1]![0].destination).toEqual({x:nearby.x,y:nearby.y});
});

it('uses known sea connectivity for estimated travel while retaining the native timing request and independent risk',()=>{
 const f=frame(), actual:GoalHullCandidate={id:f.hull.id,reference:{kind:'existing',entityId:f.hull.id},assessment:f.hull,seaId:'sea:1',availableTick:f.snapshot.tick,capacity:1000,cargoUnitIds:[],preconditions:[],factIds:[]};
 const from={x:f.hull.x,y:f.hull.y,heading:2.5},to=f.regions.shores.find(shore=>shore.seaId==='sea:1')!.water;
 const readPointRoute=vi.fn<GoalTransportPhysicalInput['readPointRoute']>(()=>({id:'native-background-time',fact:{status:'pending',reasonCode:'search-in-progress',work:13}}));
 const readVoyageRisk=vi.fn<NonNullable<GoalTransportPhysicalInput['readVoyageRisk']>>(()=>({status:'unknown',reasonCode:'capable-hazard-unquoted',samples:0,totalSamples:0,threatIds:['hostile']}));
 const t=f.think(0,0,{travelTimePolicy:'connectivity-estimate',readPointRoute,readVoyageRisk});
 const result=strict(()=>t.ports.seaLeg(actual,from,to,false));
 expect(result).toMatchObject({state:'met',value:{endpoint:to,timeBasis:'sea-connectivity-estimate',risk:{status:'unknown'}}});
 if(result.state!=='met')throw Error('known connected sea must give a time estimate');
 expect(result.value.ticks).toBe(Math.floor(Math.hypot(to.x-from.x,to.y-from.y)/Math.max(1,f.hull.speed)*20));
 expect(readPointRoute).toHaveBeenCalledTimes(1);expect(readVoyageRisk.mock.calls[0]![0]).not.toHaveProperty('route');
 t.finish();expect(t.work.receipt.used).toBe(0);
});

it('uses the shared basin time quote only while native timing is unpublished, preserving independent risk and pending reasons',()=>{
 const f=frame(), actual:GoalHullCandidate={id:f.hull.id,reference:{kind:'existing',entityId:f.hull.id},assessment:f.hull,seaId:'sea:1',availableTick:f.snapshot.tick,capacity:1000,cargoUnitIds:[],preconditions:[],factIds:[]};
 const from={x:f.hull.x,y:f.hull.y,heading:2.5},to=f.regions.shores.find(shore=>shore.seaId==='sea:1')!.water;
 const readPointRoute:GoalTransportPhysicalInput['readPointRoute']=()=>({id:'native-background-time',fact:{status:'pending',reasonCode:'search-in-progress',work:13}});
 const coarseSeaTicks=vi.fn<NonNullable<GoalTransportPhysicalInput['coarseSeaTicks']>>(()=>({state:'met',value:321,factIds:['published-basin-wind-time']}));
 const t=f.think(0,0,{travelTimePolicy:'connectivity-estimate',readPointRoute,coarseSeaTicks});
 expect(strict(()=>t.ports.seaLeg(actual,from,to,false))).toMatchObject({state:'met',value:{ticks:321,timeBasis:'sea-connectivity-estimate',risk:{status:'unknown'}},factIds:expect.arrayContaining(['native-background-time','published-basin-wind-time'])});
 expect(coarseSeaTicks).toHaveBeenCalledWith(expect.objectContaining({id:f.hull.id}),from,to,false);
 for(const state of ['pending','unmet'] as const){
  const reason={code:'shared-field-'+state,factIds:['field-id'],values:{}};
  const estimate=state==='pending'?{state,requestIds:['same-field-request'],reason}:{state,reason};
  const waiting=f.think(0,0,{travelTimePolicy:'connectivity-estimate',readPointRoute,coarseSeaTicks:()=>estimate});
  expect(strict(()=>waiting.ports.seaLeg(actual,from,to,false))).toEqual(estimate);
 }
 coarseSeaTicks.mockClear();
 const native=f.think(0,0,{travelTimePolicy:'connectivity-estimate',coarseSeaTicks});
 expect(strict(()=>native.ports.seaLeg(actual,from,to,false))).toMatchObject({state:'met',value:{ticks:20}});
 expect(coarseSeaTicks).not.toHaveBeenCalled();t.finish();expect(t.work.receipt.used).toBe(0);
});

it('keeps a future shore-pose scan stable while the actual ship turns, without changing default native hints',()=>{
 const f=frame(), shore=f.regions.shoresByLand.get(f.from.landId)!.get('sea:1')![0]!;
 const hull:GoalHullCandidate={id:f.hull.id,reference:{kind:'existing',entityId:f.hull.id},assessment:f.hull,seaId:'sea:1',availableTick:f.snapshot.tick,capacity:1000,cargoUnitIds:[],preconditions:[],factIds:[]};
 const a=f.think(0,0,{berthOrientation:'shore'}),first=strict(()=>a.ports.berth(f.worker,hull,shore));a.finish();
 expect(first.state).toBe('pending');
 f.hull.sailing!.heading+=.321;
 const before=JSON.stringify(f.snapshot),b=f.think(1,0,{berthOrientation:'shore'}),turning=strict(()=>b.ports.berth(f.worker,hull,shore));b.finish();
 expect(turning.state).toBe('pending');
 if(first.state==='pending'&&turning.state==='pending')expect(turning.requestIds).toEqual(first.requestIds);
 expect(JSON.stringify(f.snapshot)).toBe(before);expect(b.work.receipt.used).toBe(0);
 const c=f.think(2,0),native=strict(()=>c.ports.berth(f.worker,hull,shore));
 if(first.state==='pending'&&native.state==='pending')expect(native.requestIds).not.toEqual(first.requestIds);
});
