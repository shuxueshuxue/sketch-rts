import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import type {Scene} from '../drivers/browser';

export default async function(s:Scene){
 const {applyAiPlanDelta}=await import(pathToFileURL(`${process.cwd()}/src/ai/plan-stream.ts`).href);
 const gpu=await s.page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2')!;const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
 s.must(!/SwiftShader|llvmpipe/i.test(gpu),`Software GPU: ${gpu}`);
 const created:any=await s.api('/api/rooms',{host:{id:'plan-proof-host',name:'Plan proof'},mapId:'twoShores',visibility:'public',humanCount:1,aiCount:3,layoutSeed:'plan-overlay-1'});
 const id=created.id,players=created.slots.map((slot:any)=>slot.playerId);
 await s.api(`/api/rooms/${id}/start`,{userId:'plan-proof-host'});
 await s.api(`/api/rooms/${id}/pause`,{});
 await s.api(`/api/rooms/${id}/reset`,{mapId:'twoShores',options:{players,aiPlayers:players,aiVersions:Object.fromEntries(players.map((p:string)=>[p,'v9_archer'])),layout:{seed:'pool-twoShores-1',kind:'sides',idea:'twoShores'},races:Object.fromEntries(players.map((p:string)=>[p,'grove']))}});
 await s.api(`/api/rooms/${id}/tick`,{ticks:60});
 let planAccessToken='';
 const traffic:{bytes:number;packets:number;baselines:number;deltas:number;nodes:number}={bytes:0,packets:0,baselines:0,deltas:0,nodes:0};
 s.page.on('websocket',(ws:any)=>ws.on('framereceived',(event:any)=>{try{const m=JSON.parse(String(event.payload));if(m.type==='aiPlans'){if(m.accessToken)planAccessToken=m.accessToken;traffic.bytes+=Buffer.byteLength(String(event.payload));traffic.packets++;if(m.packet.type==='trace'){if(m.packet.baseTick===null)traffic.baselines++;else traffic.deltas++;traffic.nodes+=m.packet.upsert.length;}}}catch{}}));
 await s.page.goto(new URL(`?room=${id}`,s.page.url()).href,{waitUntil:'load'});
 await s.page.waitForSelector('[data-watch-room]',{timeout:180000});await s.page.click('[data-watch-room]');
 await s.page.waitForFunction(()=>((window as any).__sketchRtsView?.tick??-1)>=60,null,{timeout:180000});
 await s.page.waitForFunction(()=>!!(window as any).__sketchRtsDebug?.ready(),null,{timeout:180000});
 await s.page.click('.ai-plan-toggle');await s.page.click('[data-action=record]');
 // A single real four-player AI match. The server settles thinks; the browser consumes the same authoritative frames.
 const result:any=await s.api(`/api/rooms/${id}/tick`,{ticks:4800});const tick=result.snapshot.tick;
 await s.page.waitForFunction((t:number)=>((window as any).__sketchRtsView?.tick??-1)>=t,tick,{timeout:180000});
 await s.page.waitForSelector('.plan-band',{timeout:60000});
 const liveRecording:any=await s.api(`/api/rooms/${id}/debug-replay?planToken=${encodeURIComponent(planAccessToken)}`);
 const current=new Map<string,any>(),interesting:any[]=[];
 for(const packet of liveRecording.aiPlans.packets){if(packet.type!=='trace')continue;const trace=applyAiPlanDelta(current.get(packet.owner),packet);if(!trace)continue;current.set(trace.owner,trace);
   for(const node of trace.nodes)if(trace.roots.includes(node.id)&&node.status==='active'&&node.resources.unitIds.length>=3&&node.target.position)interesting.push({tick:trace.tick,owner:trace.owner,id:node.id,label:node.label,position:node.target.position});}
 const liveGoal=[...current.values()].flatMap(trace=>trace.nodes.filter((node:any)=>trace.roots.includes(node.id)&&node.status==='active'&&node.resources.unitIds.length>0&&node.target.position).map((node:any)=>({owner:trace.owner,...node}))).sort((a:any,b:any)=>b.resources.unitIds.length-a.resources.unitIds.length)[0];
 if(liveGoal){if(!await s.page.locator('.plan-panel details').evaluate((e:HTMLDetailsElement)=>e.open))await s.page.locator('.plan-panel details summary').click();await s.page.locator('.plan-list[data-owner="'+liveGoal.owner+'"][data-goal="'+liveGoal.id+'"]').click();}
 const focus=liveGoal?.label;
 if(liveGoal)await s.camera(liveGoal.target.position.x,liveGoal.target.position.y,.7);
 await s.wait(3000);await s.shot('spectator-plans');
 const browser=s.page.context(),cdp=await browser.newCDPSession(s.page);
 const metrics:any[]=[];
 await s.page.click('[data-action=record]'); // Close recording before profiling: closed rounds have both gates off.
 const output=JSON.parse(process.argv[2]!).out;

 for(const open of [false,true,false,true]){
   if(open!==await s.page.locator('.ai-plan-toggle').getAttribute('aria-expanded').then((v:string)=>v==='true'))await s.page.click(open?'.ai-plan-toggle':'[data-action=close]');
   await s.wait(2000);
   const events:any[]=[];const collect=(event:any)=>events.push(...event.value);cdp.on('Tracing.dataCollected',collect);
   await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});
   let advanced=0;const deadline=Date.now()+6000;
   while(Date.now()<deadline){const started=Date.now();await s.api(`/api/rooms/${id}/tick`,{ticks:1});advanced++;await s.wait(Math.max(0,50-(Date.now()-started)));}

   const complete=new Promise(done=>cdp.once('Tracing.tracingComplete',done));await cdp.send('Tracing.end');await complete;cdp.off('Tracing.dataCollected',collect);
   const times=events.filter(e=>e.name==='FireAnimationFrame'&&e.ph==='X').map(e=>(e.tdur??e.dur??0)/1000).sort((a,b)=>a-b);
   const spans=events.filter(e=>String(e.name).startsWith('ai-plan:'));
   const file=`trace-${metrics.length}-${open?'open':'closed'}.json.gz`,compressed=gzipSync(JSON.stringify({traceEvents:events}));
   writeFileSync(`${output}/${file}`,compressed);
   const measures:Record<string,number[]>={},pending=new Map<string,any>();
   for(const e of spans){const key=`${e.name}:${e.id2?.local??e.id??''}:${e.pid}:${e.tid}`;
     if(e.ph==='b'||e.ph==='B')pending.set(key,e);
     else if(e.ph==='e'||e.ph==='E'){const start=pending.get(key);if(start){(measures[e.name]??=[]).push((e.ts-start.ts)/1000);pending.delete(key);}}
     else if(e.ph==='X')(measures[e.name]??=[]).push((e.dur??0)/1000);
   }
   const planMs=Object.fromEntries(Object.entries(measures).map(([name,values])=>{values.sort((a,b)=>a-b);return [name,{count:values.length,median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values.at(-1)}];}));
   metrics.push({open,recording:false,advancedTicks:advanced,file,sha256:createHash('sha256').update(compressed).digest('hex'),planMs,frames:times.length,jsMedianMs:times[Math.floor(times.length*.5)],jsP95Ms:times[Math.floor(times.length*.95)],jsMaxMs:times.at(-1),planTimingEvents:spans.length});
 }
 const replay:any=await s.api(`/api/rooms/${id}/debug-replay?planToken=${encodeURIComponent(planAccessToken)}`);
 const packets=replay.aiPlans?.packets??[];
 s.must(packets.some((p:any)=>p.type==='trace'&&p.baseTick!==null),'No incremental plans recorded');
 await s.page.click('[data-action=replay]');
 await s.page.waitForSelector('[data-plan-seek]',{timeout:60000});
 s.must(interesting.length>0,'No allocated goal in the actual recording');
 const chosen=interesting[Math.floor(interesting.length*.7)]!;
 const requestedSeek=chosen.tick;
 const slider=s.page.locator('[data-plan-seek]'),box=await slider.boundingBox();s.must(box,'Replay slider has no box');
 const x=box.x+8+(box.width-16)*(requestedSeek-replay.initialSave.snapshot.tick)/(replay.throughTick-replay.initialSave.snapshot.tick);
 await s.page.mouse.move(box.x+8,box.y+box.height/2);await s.page.mouse.down();await s.page.mouse.move(x,box.y+box.height/2,{steps:12});await s.page.mouse.up();
 const seek=await slider.inputValue().then(Number);
 await s.page.waitForFunction((t:number)=>(window as any).__sketchRtsView?.tick===t,seek,{timeout:180000});await s.wait(1500);
 if(!await s.page.locator('.plan-panel details').evaluate((e:HTMLDetailsElement)=>e.open))await s.page.locator('.plan-panel details summary').click();
 await s.page.locator('.plan-list[data-owner="'+chosen.owner+'"][data-goal="'+chosen.id+'"]').click();
 s.must(!await s.page.locator('.plan-empty').count(),'Replay lost recorded plan nodes');
 await s.camera(chosen.position.x,chosen.position.y,.7);
 await s.wait(500);await s.shot('replay-scrub');
 s.must(await s.page.locator('.plan-gap').count()>0,'Missing unrecorded prefix');
 s.record('ai-plan-overlay',{gpu,tick,seek,requestedSeek,chosen,focus,metrics,traffic,packets:packets.length,recordingFrom:replay.initialSave.snapshot.tick,recordingThrough:replay.throughTick,deathRecords:packets.flatMap((p:any)=>p.type==='events'?p.deaths:[]).length});
}
