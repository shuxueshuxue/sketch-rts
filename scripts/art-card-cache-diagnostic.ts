/** Cache-policy audit. No production mutations, real GPU timing, or FPS claim.
 * The production policy runs against deterministic Canvas and transfer mocks.
 * A metadata-only replay is checked against production before comparing policies.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import * as THREE from 'three';
import {cardTextureBytes} from '../src/client/world3d/card-mip-uploader';

const BUDGET=12*1024*1024,MAX_LAYERS=16;
const sourceFlag=process.argv.indexOf('--source'),sourceRoot=resolve(sourceFlag>=0?process.argv[sourceFlag+1]!:'.');
const {PaintedCardBatches}=await import(pathToFileURL(resolve(sourceRoot,'src/client/world3d/painted-card-batches.ts')).href) as typeof import('../src/client/world3d/painted-card-batches');
const candidateSourceFlag=process.argv.indexOf('--candidate-source'),candidateRoot=candidateSourceFlag>=0?resolve(process.argv[candidateSourceFlag+1]!):undefined;
const candidateConstructor=candidateRoot?(await import(pathToFileURL(resolve(candidateRoot,'src/client/world3d/painted-card-batches.ts')).href) as typeof import('../src/client/world3d/painted-card-batches')).PaintedCardBatches:undefined;
type Request={key:string;size:number};
type Frame={name?:string;requests:Request[]};
type Trace={name:string;frames:Frame[]};
type Page={id:number;size:number;depth:number;cards:(Card|undefined)[];used:number};
type Card={key:string;page:Page;layer:number;used:number};
type Policy='production'|'budget-tail-in-place';
type Event={frame:number;event:string;[key:string]:unknown};

class Replay {
 pages:Page[]=[];cards=new Map<string,Card>();events:Event[]=[];frame=0;nextPage=0;
 uploads=0;uploadBytes=0;copies=0;created=0;removed=0;peakAllocatedMipBytes=0;peakCards=0;
 constructor(readonly policy:Policy){}
 pixels(){return this.pages.reduce((sum,p)=>sum+p.size*p.size*p.depth,0);}
 bytes(){return this.pages.reduce((sum,p)=>sum+cardTextureBytes(p.size,p.size,p.depth),0);}
 peak(){this.peakAllocatedMipBytes=Math.max(this.peakAllocatedMipBytes,this.bytes());this.peakCards=Math.max(this.peakCards,this.cards.size);}
 create(size:number,depth=MAX_LAYERS){const page={id:++this.nextPage,size,depth,cards:new Array<Card|undefined>(depth).fill(undefined),used:this.frame};this.pages.push(page);this.created++;this.peak();return page;}
 dropCard(card:Card){if(this.cards.get(card.key)===card)this.cards.delete(card.key);card.page.cards[card.layer]=undefined;}
 remove(page:Page){for(const card of page.cards)if(card)this.dropCard(card);this.pages.splice(this.pages.indexOf(page),1);this.removed++;}
 slot(size:number){
  let oldest:Card|undefined;
  for(const page of this.pages){if(page.size!==size)continue;for(let layer=0;layer<page.depth;layer++){
   const card=page.cards[layer];if(!card)return{page,layer};
   if(card.used!==this.frame&&(!oldest||card.used<oldest.used))oldest=card;
  }}
  const remaining=BUDGET-this.pixels(),tail=Math.floor(remaining/(size*size));
  if(oldest&&(this.pixels()>=BUDGET||(this.policy!=='production'&&tail<1))){this.dropCard(oldest);return{page:oldest.page,layer:oldest.layer};}
  const depth=this.policy==='production'?MAX_LAYERS:tail>0?Math.min(MAX_LAYERS,tail):MAX_LAYERS;
  return{page:this.create(size,depth),layer:0};
 }
 compact(){
  if(this.pixels()<=BUDGET)return;
  for(const size of new Set(this.pages.map(p=>p.size))){
   const pages=this.pages.filter(p=>p.size===size),active=pages.flatMap(p=>p.cards.filter((c):c is Card=>!!c&&c.used===this.frame));
   if(!active.length)continue;
   if(this.policy==='production'){
    const needed=Math.ceil(active.length/MAX_LAYERS);if(needed*2>pages.length)continue;
    let destination:Page|undefined;
    for(let i=0;i<active.length;i++){
     const old=active[i]!,layer=i%MAX_LAYERS;if(!layer)destination=this.create(size);
     const card={...old,page:destination!,layer};destination!.cards[layer]=card;this.cards.set(card.key,card);this.copies++;
    }
    for(const page of pages)this.remove(page);
   }else{
    // Copy only sources outside the kept set into existing inactive holes.
    // No current-frame source can also be a destination; no copy cycle exists.
    const sorted=[...pages].sort((a,b)=>b.cards.filter(c=>c?.used===this.frame).length-a.cards.filter(c=>c?.used===this.frame).length||b.depth-a.depth||a.id-b.id);
    let capacity=0,needed=0;
    for(const page of [...pages].sort((a,b)=>b.depth-a.depth)){if(capacity>=active.length)break;capacity+=page.depth;needed++;}
    const targets=sorted.slice(0,needed);capacity=targets.reduce((sum,page)=>sum+page.depth,0);
    while(capacity<active.length){const smallest=[...targets].sort((a,b)=>a.depth-b.depth)[0]!,replacement=pages.filter(p=>!targets.includes(p)).sort((a,b)=>b.depth-a.depth)[0]!;capacity+=replacement.depth-smallest.depth;targets[targets.indexOf(smallest)]=replacement;}
    if(targets.length*2>pages.length)continue;
    const kept=new Set(targets),holes=targets.flatMap(page=>page.cards.flatMap((card,layer)=>card?.used===this.frame?[]:[{page,layer}]));
    const moves=active.filter(c=>!kept.has(c.page));
    if(holes.length<moves.length)throw Error('Invalid in-place compaction plan');
    for(const [i,old] of moves.entries()){
     const {page,layer}=holes[i]!,previous=page.cards[layer];if(previous)this.dropCard(previous);
     const card={...old,page,layer};page.cards[layer]=card;page.used=this.frame;this.cards.set(card.key,card);this.copies++;
    }
    for(const page of pages)if(!kept.has(page))this.remove(page);
   }
  }
 }
 run(frames:Frame[]){
  for(const frame of frames){
   this.frame++;
   // Production add() protects every warm current-frame card before misses.
   for(const request of frame.requests){const card=this.cards.get(request.key);if(card)card.used=card.page.used=this.frame;}
   for(const request of frame.requests){
    let card=this.cards.get(request.key);if(!card){
     const {page,layer}=this.slot(request.size);card={key:request.key,page,layer,used:this.frame};page.cards[layer]=card;this.cards.set(card.key,card);
     this.uploads++;this.uploadBytes+=request.size*request.size*4;this.peak();
    }card.used=card.page.used=this.frame;
   }
   this.compact();
   for(const page of [...this.pages])if(!page.cards.some(c=>c?.used===this.frame)&&(this.frame-page.used>120||this.pixels()>BUDGET))this.remove(page);
   this.events.push({frame:this.frame,event:'finish',name:frame.name??'',cards:this.cards.size,pages:this.pages.length,livePixels:[...this.cards.values()].reduce((n,c)=>n+c.page.size*c.page.size,0),allocatedPixels:this.pixels(),uploads:this.uploads,copies:this.copies});
  }
  return{policy:this.policy,frames:this.frame,requests:frames.reduce((n,f)=>n+f.requests.length,0),uploads:this.uploads,uploadBytes:this.uploadBytes,copies:this.copies,createdPages:this.created,removedPages:this.removed,finalPages:this.pages.length,finalCards:this.cards.size,finalAllocatedMipBytes:this.bytes(),peakAllocatedMipBytes:this.peakAllocatedMipBytes,peakCards:this.peakCards,events:this.events};
 }
}

function mockProduction(trace:Trace,Constructor=PaintedCardBatches){
 // A single ink texel guarantees nonempty cards without depending on Canvas
 // backend painting. RGBA/readback/mip dimensions remain full production size.
 const oldDocument=globalThis.document;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>{
  const canvas={width:1,height:1,getContext:()=>({resetTransform(){},clearRect(){},save(){},scale(){},translate(){},restore(){},getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);data[3]=255;return{data};}})};return canvas;
 }}});
 const renderer={initTexture(){},copyTextureToTexture(){},getRenderTarget:()=>null,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget(){}};
 const cards=new Constructor(new THREE.Scene(),1,{pickable:false});
 // Disable compressed CPU recovery solely to isolate GPU residency policy.
 // Never claim a saved painter/upload by spending 48 MiB on another cache.
 const internal=cards as unknown as {rasterCache:{budget:number};createPage:(width:number,height:number)=>unknown;remove:(page:unknown)=>void};
 internal.rasterCache.budget=0;
 let created=0,removed=0;const create=internal.createPage,remove=internal.remove;
 internal.createPage=function(...args){created++;return create.apply(this,args);};
 internal.remove=function(page){removed++;return remove.call(this,page);};
 const at=performance.now(),matrix=new THREE.Matrix4();
 try{
  for(const frame of trace.frames){cards.begin();for(const [i,r] of frame.requests.entries())cards.add(r.key,1,()=>{},matrix,`${i}`,0,r.size);cards.finish(renderer);}
  const stats=cards.stats();return{scope:'Production metadata/cache/transfer control flow with mock Canvas pixels and mock GPU calls; not rendering time',wallMs:performance.now()-at,createdPages:created,removedPages:removed,stats};
 }finally{cards.dispose();Object.defineProperty(globalThis,'document',{configurable:true,value:oldDocument});}
}

const request=(key:string,size:number):Request=>({key:`${key}:1:${size}`,size});
const cycle=(size:number,count:number,cycles:number):Trace=>({name:`one-visible-${size}px-${count}-poses-${cycles}-cycles`,frames:Array.from({length:count*cycles},(_,i)=>({requests:[request(`pose-${i%count}`,size)]}))});
const traces:Trace[]=[cycle(640,20,3),cycle(704,20,3),cycle(512,40,3),cycle(640,31,3),
 {name:'64-to-4-sparse-survivors',frames:[{requests:Array.from({length:64},(_,i)=>request(`pose-${i}`,512))},{requests:[0,16,32,48].map(i=>request(`pose-${i}`,512))}]},
 {name:'100-visible-unique-steady',frames:Array.from({length:4},()=>({requests:Array.from({length:100},(_,i)=>request(`pose-${i}`,640))}))},
];
const traceFlag=process.argv.indexOf('--trace');if(traceFlag>=0){
 const data=JSON.parse(readFileSync(resolve(process.argv[traceFlag+1]!), 'utf8'));
 if(data.cycles){
  for(const [cycleIndex,cycleRow] of data.cycles.entries())for(const [batchIndex,batch] of cycleRow.cardTrace.batches.entries()){
   if(!batch.frames.some((frame:{requests:unknown[]})=>frame.requests.length))continue;
   traces.push({name:`actual-viewport-cycle-${cycleIndex}-batch-${batchIndex}`,frames:batch.frames.map((frame:{requests:{key:string;density:number;tileSize:number}[]},i:number)=>({name:`trace-frame-${i}`,requests:frame.requests.map(r=>({key:`${r.key}:${r.density}:${r.tileSize}`,size:r.density*r.tileSize}))}))});
  }
 }else traces.push(...(Array.isArray(data)?data:[data]));
}
const rows=traces.map(trace=>{
 const production=new Replay('production').run(trace.frames),candidate=new Replay('budget-tail-in-place').run(trace.frames),real=mockProduction(trace);
 for(const [label,actual,expected] of [
  ['rasterizations',real.stats.rasterizations,production.uploads],['mipLayerUpdates',real.stats.mipLayerUpdates,production.uploads],
  ['copies',real.stats.copiedLayers,production.copies],['createdPages',real.createdPages,production.createdPages],
  ['finalCards',real.stats.cards,production.finalCards],['finalPages',real.stats.pages,production.finalPages],
  ['allocatedMipBytes',real.stats.allocatedMipBytes,production.finalAllocatedMipBytes],['scratchUploadBytes',real.stats.scratchUploadBytes,production.uploadBytes],
 ] as const)if(actual!==expected)throw Error(`${trace.name}: replay mismatch ${label}: ${actual} != ${expected}`);
 const candidateReal=candidateConstructor?mockProduction(trace,candidateConstructor):undefined;
 if(candidateReal)for(const [label,actual,expected] of [
  ['rasterizations',candidateReal.stats.rasterizations,candidate.uploads],['copies',candidateReal.stats.copiedLayers,candidate.copies],
  ['createdPages',candidateReal.createdPages,candidate.createdPages],['finalCards',candidateReal.stats.cards,candidate.finalCards],
  ['finalPages',candidateReal.stats.pages,candidate.finalPages],['allocatedMipBytes',candidateReal.stats.allocatedMipBytes,candidate.finalAllocatedMipBytes],
 ] as const)if(actual!==expected)throw Error(`${trace.name}: candidate replay mismatch ${label}: ${actual} != ${expected}`);
 return{name:trace.name,uniqueKeys:new Set(trace.frames.flatMap(f=>f.requests.map(r=>r.key))).size,production,candidate,mockProduction:real,mockCandidate:candidateReal};
});
const result={sourceRoot,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),candidateRoot,budgetPixels:BUDGET,productionMaxLayers:MAX_LAYERS,method:'Deterministic request metadata replay verified against actual PaintedCardBatches running mock Canvas + GPU. Exact logical uploads/page allocations, not wall-time improvement prediction. Candidate uses a budget-sized tail page and compaction into existing inactive holes; same requests/resolution/full mip domains, CPU recovery disabled in production control probe. Replay uploadBytes means full requested RGBA domains; it excludes the separate uploader partial-rectangle optimization. With --candidate-source, the candidate metadata replay is independently checked against its actual production class.',rows};
const outFlag=process.argv.indexOf('--out'),out=resolve(outFlag>=0?process.argv[outFlag+1]!:'work/art-card-cache-diagnostic.json');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({out,rows:rows.map(row=>({name:row.name,before:{uploads:row.production.uploads,copies:row.production.copies,createdPages:row.production.createdPages,finalCards:row.production.finalCards,peakBytes:row.production.peakAllocatedMipBytes},candidate:{uploads:row.candidate.uploads,copies:row.candidate.copies,createdPages:row.candidate.createdPages,finalCards:row.candidate.finalCards,peakBytes:row.candidate.peakAllocatedMipBytes}}))},null,2));
