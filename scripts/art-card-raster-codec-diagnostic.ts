/** CPU-only codec experiment. No production mutation, browser, simulation or GPU.
 * node --import tsx scripts/art-card-raster-codec-diagnostic.ts --input trace.json
 */
import {createCanvas,type Canvas} from '@napi-rs/canvas';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cpus,platform,release} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'three/examples/jsm/libs/fflate.module.js';
import {paintFigure} from '../src/client/art/painted-units';
import {CardRasterCache} from '../src/client/world3d/card-raster-cache';
import type {UnitKind} from '../src/shared/types';
import type {UnitAnimationFrame} from '../src/client/unit-animation';

const args=process.argv.slice(2),inputs:string[]=[];let output='docs/art/refactor/followup/card-streaming/codec-diagnostic',decodeRepeats=3,addDensity2=false;
for(let i=0;i<args.length;i++){
 if(args[i]==='--input')inputs.push(resolve(args[++i]!));
 else if(args[i]==='--output')output=args[++i]!;
 else if(args[i]==='--decode-repeats')decodeRepeats=Number(args[++i]);
 else if(args[i]==='--add-density-2')addDensity2=true;
 else throw new Error(`Unknown argument ${args[i]}`);
}
if(!inputs.length)inputs.push(...['mixed-before','mixed-after'].map(name=>resolve(`docs/art/refactor/followup/card-streaming/${name}/raw.json`)));
if(!Number.isInteger(decodeRepeats)||decodeRepeats<1)throw new Error('decode-repeats must be a positive integer');
const BUDGET=48*1024*1024;
type Descriptor={key:string;kind:UnitKind;team:string;pose:UnitAnimationFrame;facing:1|-1;density:number;tile:number};
type Pool={name:string;scope:string;keys:Set<string>;requests:string[]};
const samples=new Map<string,Descriptor>(),pools:Pool[]=[],rejected:string[]=[];
function descriptor(key:string):Descriptor {
 const words=key.split(':'),kind=words[0] as UnitKind,team=words[1]==='intrinsic'?'#477b91':words[1]!,mode=words[2] as UnitAnimationFrame['mode'];
 if(!['idle','walk','attack','cast','work'].includes(mode)||!/^#[0-9a-f]{6}$/i.test(team))throw new Error(`Not a stock painted unit: ${key}`);
 const pose:UnitAnimationFrame={mode,frame:Number(words[3]),variant:Number(words[4]),aim:Number(words[5])};
 let cursor=6;
 if(words[cursor]==='carry'){pose.carry=Number(words[cursor+1]);pose.carryAim=Number(words[cursor+2]);cursor+=3;}
 // New paint identities include the empty stock-variant slot before facing.
 if(words[cursor]==='')cursor++;
 const facing=Number(words[cursor]) as 1|-1,density=Number(words.at(-2)),tile=Number(words.at(-1));
 if(![1,-1].includes(facing)||![2,4].includes(density)||![128,160,176].includes(tile)||words[cursor+1]!==String(density))throw new Error(`Unrecognized card identity: ${key}`);
 return{key,kind,team,pose,facing,density,tile};
}
function admit(key:string,pool:Pool){
 try{const value=descriptor(key);samples.set(key,value);pool.keys.add(key);pool.requests.push(key);}catch{rejected.push(key);}
}
for(const input of inputs){
 const raw=JSON.parse(readFileSync(input,'utf8'));
 for(const [index,cycle] of (raw.cycles??[]).entries()){
  const coverage=cycle.assetCoverage?.residentKeys??[],resident:Pool={name:`${input}/cycle-${index}/resident`,scope:'Only the final resident GPU keys; this is not the complete animation working set.',keys:new Set(),requests:[]};
  for(const key of coverage)admit(key,resident);if(resident.keys.size)pools.push(resident);
  for(const [batch,trace] of (cycle.cardTrace?.batches??[]).entries()){
   const pool:Pool={name:`${input}/cycle-${index}/trace-${batch}`,scope:'All observed request keys in order, including warm GPU hits and duplicate instances. Budget replay tests retention only; request hits do not equal CPU raster recoveries.',keys:new Set(),requests:[]};
   for(const frame of trace.frames??[])for(const request of frame.requests??[])admit(`${request.key}:${request.density}:${request.tileSize}`,pool);
   if(pool.keys.size)pools.push(pool);
  }
 }
}
if(addDensity2){
 const pool:Pool={name:'actual-pose-coverage-density-2',scope:'Additional quality-preserving density-2 samples of the observed poses; not the measured density-4 scene working set.',keys:new Set(),requests:[]};
 for(const value of [...samples.values()])if(value.density===4){const key=value.key.replace(/:4:(128|160|176)$/,':2:$1'),next={...value,key,density:2};samples.set(key,next);pool.keys.add(key);pool.requests.push(key);}
 pools.push(pool);
}
if(!samples.size)throw new Error('No stock unit cards found');
const canvases=new Map<number,Canvas>(),rle=new CardRasterCache(Number.MAX_SAFE_INTEGER),rows:Record<string,unknown>[]=[],sizes=new Map<string,Record<string,number>>();
const timings:{name:string;encodeMs:number[];decodeMs:number[];bytes:number;largestEncodedBytes:number}[]=['row-rle','deflate-1','deflate-6','row-rle-deflate-1'].map(name=>({name,encodeMs:[],decodeMs:[],bytes:0,largestEncodedBytes:0}));
let rawBytes=0,maxRawBytes=0,maxKnownLiveBufferBytes=0,maxRleOwnedBytes=0,peakProcessArrayBuffers=0,peakHeapBytes=0,paintValues:number[]=[],readValues:number[]=[],fullDomainDecoded=0;
const sourceHashes=Object.fromEntries(['src/client/world3d/card-raster-cache.ts','src/client/art/painted-units.ts','src/client/art/painted-creatures.ts','src/client/art/paint-identity.ts','src/client/art/raster-cache.ts','scripts/art-viewport-streaming-fixture.js','node_modules/three/examples/jsm/libs/fflate.module.js'].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
function distribution(values:number[]){const sorted=[...values].sort((a,b)=>a-b),at=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];return{samples:values.length,totalMs:values.reduce((a,b)=>a+b,0),meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99),maxMs:sorted.at(-1)};}
function compare(a:Uint8Array|Uint8ClampedArray,b:Uint8Array|Uint8ClampedArray,key:string){if(a.byteLength!==b.byteLength||!Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength)))throw new Error(`RGBA mismatch ${key}`);fullDomainDecoded+=a.byteLength;}
function processMemory(){const m=process.memoryUsage();peakProcessArrayBuffers=Math.max(peakProcessArrayBuffers,m.arrayBuffers);peakHeapBytes=Math.max(peakHeapBytes,m.heapUsed);}
let completed=0;
for(const sample of samples.values()){
 const size=sample.tile*sample.density;let canvas=canvases.get(size);if(!canvas){canvas=createCanvas(size,size);canvases.set(size,canvas);}
 const ctx=canvas.getContext('2d'),start=performance.now();ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(sample.density,sample.density);ctx.translate(sample.tile/2,sample.tile/2);ctx.scale(sample.facing,1);
 try{if(!paintFigure(ctx as unknown as CanvasRenderingContext2D,sample.kind,sample.team,sample.pose,sample.facing))throw new Error(`Unknown painter ${sample.kind}`);}finally{ctx.restore();}
 const painted=performance.now(),rgba=ctx.getImageData(0,0,size,size).data,read=performance.now(),paintMs=painted-start,readMs=read-painted;
 paintValues.push(paintMs);readValues.push(readMs);rawBytes+=rgba.byteLength;maxRawBytes=Math.max(maxRawBytes,rgba.byteLength);
 // The production recovery cache stores the row-flipped full domain. Flipping
 // is outside both compression and paint/readback timers and is shared by arms.
 const line=new Uint8Array(size*4);for(let y=0;y<Math.floor(size/2);y++){const a=y*size*4,b=(size-1-y)*size*4;line.set(rgba.subarray(a,a+line.length));rgba.copyWithin(a,b,b+line.length);rgba.set(line,b);}
 const encodedSizes:Record<string,number>={},codecRows:Record<string,unknown>={};
 const rleStart=performance.now();rle.put(sample.key,rgba,size,size,paintMs+readMs);const rleMs=performance.now()-rleStart;
 // Diagnostic introspection only reads the real codec's typed storage. A large
 // experiment-only budget avoids eviction/backoff changing per-image timings;
 // the unchanged production 48MiB is evaluated separately below.
 const raster=(rle as unknown as {entries:Map<string,{bytes:number;spans:Uint32Array;pixels:Uint32Array}>}).entries.get(sample.key);if(!raster)throw new Error('RLE admission failed');
 const rleStat=rle.stats(),rleDecodes:number[]=[];for(let n=0;n<decodeRepeats;n++){const at=performance.now(),decoded=rle.get(sample.key);rleDecodes.push(performance.now()-at);if(!decoded)throw new Error('RLE recovery failed');compare(rgba,decoded,sample.key);maxKnownLiveBufferBytes=Math.max(maxKnownLiveBufferBytes,rleStat.ownedBytes+rgba.byteLength+decoded.byteLength+line.byteLength);}
 timings[0]!.encodeMs.push(rleMs);timings[0]!.decodeMs.push(...rleDecodes);timings[0]!.bytes+=raster.bytes;timings[0]!.largestEncodedBytes=Math.max(timings[0]!.largestEncodedBytes,raster.bytes);encodedSizes['row-rle']=raster.bytes;codecRows['row-rle']={bytes:raster.bytes,encodeMs:rleMs,decodeMs:rleDecodes};maxRleOwnedBytes=Math.max(maxRleOwnedBytes,rleStat.ownedBytes);
 for(const [level,index] of (completed%2?[[6,2],[1,1]]:[[1,1],[6,2]]) as [1|6,1|2][]){
  const bytes=new Uint8Array(rgba.buffer,rgba.byteOffset,rgba.byteLength),at=performance.now(),encoded=deflateSync(bytes,{level}),encodedMs=performance.now()-at,decodeMs:number[]=[];
  for(let n=0;n<decodeRepeats;n++){const at=performance.now(),output=new Uint8Array(rgba.byteLength),decoded=inflateSync(encoded,{out:output});decodeMs.push(performance.now()-at);compare(bytes,decoded,sample.key);maxKnownLiveBufferBytes=Math.max(maxKnownLiveBufferBytes,rleStat.ownedBytes+rgba.byteLength+encoded.byteLength+output.byteLength+line.byteLength);}
  const metric=timings[index]!;metric.encodeMs.push(encodedMs);metric.decodeMs.push(...decodeMs);metric.bytes+=encoded.byteLength;metric.largestEncodedBytes=Math.max(metric.largestEncodedBytes,encoded.byteLength);encodedSizes[metric.name]=encoded.byteLength;codecRows[metric.name]={bytes:encoded.byteLength,encodeMs:encodedMs,decodeMs};
 }
 // Compress the already compact production RLE representation, avoiding a
 // DEFLATE scan of megabytes of padding. This is a candidate, not a new cache.
 const packedAt=performance.now(),packed=new Uint8Array(8+raster.bytes),header=new DataView(packed.buffer);header.setUint32(0,raster.spans.length,true);header.setUint32(4,raster.pixels.length,true);
 packed.set(new Uint8Array(raster.spans.buffer,raster.spans.byteOffset,raster.spans.byteLength),8);packed.set(new Uint8Array(raster.pixels.buffer,raster.pixels.byteOffset,raster.pixels.byteLength),8+raster.spans.byteLength);
 const encoded=deflateSync(packed,{level:1}),packedMs=performance.now()-packedAt,decodeMs:number[]=[];
 for(let n=0;n<decodeRepeats;n++){
  const at=performance.now(),plain=inflateSync(encoded,{out:new Uint8Array(packed.length)}),header=new DataView(plain.buffer),spanCount=header.getUint32(0,true),pixelCount=header.getUint32(4,true),spans=new Uint32Array(plain.buffer,8,spanCount),pixels=new Uint32Array(plain.buffer,8+spanCount*4,pixelCount),rgbaOutput=new Uint8Array(rgba.byteLength),words=new Uint32Array(rgbaOutput.buffer);let source=0;
  for(let i=0;i<spans.length;i+=2){let destination=spans[i]!/4;const end=destination+spans[i+1]!/4;while(destination<end){const code=pixels[source++]!,count=code&0x7fffffff;if(code>>>31)words.fill(pixels[source++]!,destination,destination+count);else{words.set(pixels.subarray(source,source+count),destination);source+=count;}destination+=count;}}
  decodeMs.push(performance.now()-at);compare(rgba,rgbaOutput,sample.key);maxKnownLiveBufferBytes=Math.max(maxKnownLiveBufferBytes,rleStat.ownedBytes+rgba.byteLength+packed.byteLength+encoded.byteLength+plain.byteLength+rgbaOutput.byteLength+line.byteLength);
 }
 const metric=timings[3]!;metric.encodeMs.push(rleMs+packedMs);metric.decodeMs.push(...decodeMs);metric.bytes+=encoded.byteLength;metric.largestEncodedBytes=Math.max(metric.largestEncodedBytes,encoded.byteLength);encodedSizes[metric.name]=encoded.byteLength;codecRows[metric.name]={bytes:encoded.byteLength,encodeMs:rleMs+packedMs,rleEncodeMs:rleMs,packingAndDeflateMs:packedMs,decodeMs};
 sizes.set(sample.key,encodedSizes);rows.push({...sample,size,rawBytes:rgba.byteLength,rgbaSha256:createHash('sha256').update(rgba).digest('hex'),paintMs,readMs,codecs:codecRows});processMemory();
 if(++completed%100===0)console.log(JSON.stringify({progress:completed,total:samples.size,rleBytes:rle.stats().bytes}));
}
function retain(pool:Pool,codec:string){
 const map=new Map<string,number>();let owned=0,peak=0,hits=0,misses=0,evictions=0;const requests=pool.requests.concat(pool.requests);
 for(const key of requests){const size=sizes.get(key)![codec]!;if(map.has(key)){hits++;map.delete(key);map.set(key,size);continue;}misses++;while(map.size&&(owned+size>BUDGET||map.size>=1024)){const key=map.keys().next().value!,cost=map.get(key)!;map.delete(key);owned-=cost;evictions++;}if(size<=BUDGET){map.set(key,size);owned+=size;peak=Math.max(peak,owned);}}
 const encodedBytes=[...pool.keys].reduce((sum,key)=>sum+sizes.get(key)![codec]!,0);
 return{codec,distinctKeys:pool.keys.size,totalEncodedBytes:encodedBytes,fits48MiB:encodedBytes<=BUDGET,fits1024MetadataLimit:pool.keys.size<=1024,requests:requests.length,hits,misses,evictions,retainedEntries:map.size,retainedBytes:owned,peakRetainedBytes:peak,scope:'48MiB and unchanged 1024-entry limit, two ordered request passes, no backoff. This is retention pressure, not actual CPU recovery hit rate; warm GPU requests would not access a recovery cache.'};
}
const rowByKey=new Map(rows.map(row=>[row.key as string,row]));
function poolMetrics(pool:Pool,codec:string){const selected=[...pool.keys].map(key=>rowByKey.get(key)!),encode:number[]=[],decode:number[]=[],paint:number[]=[];let paintNoCheaper=0;const breakEven:number[]=[];
 for(const row of selected){const metric=(row.codecs as Record<string,{encodeMs:number;decodeMs:number[]}>)[codec]!,paintMs=(row.paintMs as number)+(row.readMs as number),decodeMs=metric.decodeMs.reduce((a,b)=>a+b,0)/metric.decodeMs.length;encode.push(metric.encodeMs);decode.push(...metric.decodeMs);paint.push(paintMs);if(paintMs<=decodeMs)paintNoCheaper++;else breakEven.push(Math.ceil(metric.encodeMs/(paintMs-decodeMs)));}
 return{paintAndReadback:distribution(paint),encode:distribution(encode),decode:distribution(decode),nativePaintNoCheaperThanDecodeSamples:paintNoCheaper,nativeRecoveriesToAmortizeEncoding:distribution(breakEven),amortizationScope:'Per-image native paint+readback minus mean decode, ceil(encode/saving). Microbenchmark only; no request count, GPU upload, cache-hit forecast or browser speedup is implied.'};}
const result={schema:1,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes,scriptSha256:createHash('sha256').update(readFileSync(import.meta.filename??new URL(import.meta.url))).digest('hex'),inputs:inputs.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),environment:{node:process.version,cpu:cpus()[0]?.model,threads:cpus().length,platform:platform(),release:release(),canvas:'@napi-rs/canvas native Skia; not browser Canvas',fflate:'Three bundled official fflate 0.8.2, sync deflate levels 1/6; no new dependency'},budget:BUDGET,decodeRepeats,coverage:{samples:samples.size,kinds:[...new Set([...samples.values()].map(s=>s.kind))].sort(),densities:[...new Set([...samples.values()].map(s=>s.density))].sort(),colors:[...new Set([...samples.values()].map(s=>s.team))].sort(),facings:[...new Set([...samples.values()].map(s=>s.facing))].sort(),rejected:[...new Set(rejected)]},validation:{decodedFullDomainBytes:fullDomainDecoded,maxRgbaDifference:0,includesTransparentRgb:true},paint:distribution(paintValues),readback:distribution(readValues),codecs:timings.map(metric=>({name:metric.name,totalEncodedBytes:metric.bytes,ratioToRaw:metric.bytes/rawBytes,largestEncodedBytes:metric.largestEncodedBytes,encode:distribution(metric.encodeMs),decode:distribution(metric.decodeMs)})),memory:{rawBytesAcrossSamples:rawBytes,maximumOneRawDomainBytes:maxRawBytes,maxRleOwnedBytes,maxKnownLiveBufferBytes,peakProcessArrayBuffers,peakHeapBytes,knownLiveScope:'The diagnostic retains up to 1024 production RLE entries under an experiment-only unlimited byte budget so per-image encode/decode can be measured. knownLiveBufferBytes includes those, one raw input/output, row scratch, compressed result, and in the hybrid arm packed/expanded RLE streams. It excludes fflate internal transient buffers, Canvas native backing/Skia storage and JS metadata. Process peaks are sampled after codecs, not in-call allocation peaks or browser memory.'},pools:pools.map(pool=>({name:pool.name,scope:pool.scope,results:timings.map(codec=>({...retain(pool,codec.name),timing:poolMetrics(pool,codec.name)}))})),rows,method:'All arms use the exact same native-Canvas production paintFigure RGBA, including full transparent padding and alpha-zero RGB, flipped as the production recovery cache expects. Per-image encode once, decode three times into a full domain; every decode timer includes its output allocation. Deflate level 1/6 execution order alternates across samples. Hybrid encode includes measured production RLE encode + packing/deflate of its typed representation. Paint/readback timers include actual Canvas submission/readback but native Node costs are not browser costs. There is no GPU, simulation or engine frame measurement. Size replay never increases the real production recovery budget and does not predict speedups.'};
mkdirSync(resolve(output),{recursive:true});writeFileSync(resolve(output,'raw.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,rows:undefined,pools:result.pools.map(p=>({...p,name:p.name.split('/').slice(-3).join('/')}))},null,2));
