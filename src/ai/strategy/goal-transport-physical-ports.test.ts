import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { bodyMass } from '../../shared/physical-body';
import { shipProfile } from '../../shared/ship-geometry';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import { FactWorkQueue } from './fact-work';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory, GoalHullCandidate } from './goal-grounding-ports';
import type { GoalCandidates, GoalEntityReference, GoalFactReader, GoalProductionOption } from './goal-planner-types';
import { createGoalTransportFactPorts, type GoalTransportPhysicalInput } from './goal-transport-physical-ports';
import { regionIndex } from './regions';
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
