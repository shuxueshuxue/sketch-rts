/** Deterministic semantics only. No Canvas, rendering or measured timings.
 * node --import tsx scripts/art-card-rle-backoff-semantics.ts --original FILE --candidate FILE --out FILE.json */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

type Stats=Record<string,number>;
type Entry={bytes:number;pixels:Uint32Array;spans:Uint32Array;reuses?:number;maxDecodeMs?:number};
type Cache={get(key:string):Uint8ClampedArray|undefined;put(key:string,rgba:Uint8ClampedArray,width:number,height:number,paintMs?:number):void;clear():void;stats():Stats};
type Constructor=new(budget?:number)=>Cache;
type Internals={entries:Map<string,Entry>;scratch:Uint32Array;windowWorkMs:number;windowSavedMs:number;churnBytes:number};
const option=(key:string)=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const originalPath=option('--original'),candidatePath=option('--candidate');
if(!originalPath||!candidatePath)throw new Error('Required: --original FILE --candidate FILE [--out FILE.json]');
const output=resolve(option('--out')??'/tmp/rle-backoff-semantics.json');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function load(path:string){
 const file=resolve(path),bytes=await readFile(file),module=await import(pathToFileURL(file).href);
 const Cache=module.CardRasterCache??module.default?.CardRasterCache;
 assert.equal(typeof Cache,'function',`${file} must export CardRasterCache`);
 return{file,sha256:sha(bytes),Cache:Cache as Constructor};
}
const original=await load(originalPath),candidate=await load(candidatePath);
const report:{name:string;implementation:string;passed:boolean;details?:unknown;error?:string}[]=[];
const descriptor=Object.getOwnPropertyDescriptor(performance,'now');
let base=0,cost=0,calls=0;
Object.defineProperty(performance,'now',{configurable:true,value:()=>base+(calls++)*cost});
function clock<T>(duration:number,body:()=>T,expectedCalls?:number):T{
 base+=32;cost=duration;calls=0;
 try{return body();}finally{if(expectedCalls!==undefined)assert.equal(calls,expectedCalls,'mock clock calls');}
}
const raw=new Uint8ClampedArray([1,2,3,255]);
const put=(cache:Cache,key:string,paintMs=.25)=>clock(1,()=>cache.put(key,raw,1,1,paintMs));
const get=(cache:Cache,key:string,duration=.125)=>clock(duration,()=>cache.get(key));
const internal=(cache:Cache)=>cache as unknown as Internals;
function ownership(cache:Cache){
 const state=internal(cache),s=cache.stats();let bytes=0;
 for(const entry of state.entries.values()){
  assert.equal(entry.bytes,entry.pixels.byteLength+entry.spans.byteLength,'entry actual typed-array storage');bytes+=entry.bytes;
 }
 assert.equal(s.bytes,bytes);assert.equal(s.entries,state.entries.size);assert.equal(s.scratchBytes,state.scratch.byteLength);
 assert.equal(s.ownedBytes,bytes+state.scratch.byteLength);assert.ok(bytes<=s.budget!);assert.ok(state.entries.size<=1024);
 return s;
}
function run(name:string,implementation:string,body:()=>unknown){
 try{report.push({name,implementation,passed:true,details:body()});}
 catch(error){report.push({name,implementation,passed:false,error:error instanceof Error?error.stack:String(error)});}
}
/** Naturally churn the same 64-byte cache. Never write policy internals. */
function scan(Cache:Constructor,mode:'none'|'useful'|'slow'){
 const cache=new Cache(64);
 if(mode!=='none')put(cache,'hot');
 let requests=0;
 for(;cache.stats().backoffs===0&&requests<100;requests++){
  if(mode!=='none')assert.deepEqual(get(cache,'hot',mode==='slow'?.5:.125),raw);
  else assert.equal(get(cache,`cold:${requests}`),undefined);
  put(cache,`cold:${requests}`,0);ownership(cache);
 }
 assert.equal(cache.stats().backoffs,1);assert.equal(cache.stats().bypassRequests,4096);assert.ok(requests<100);
 return{cache,requests};
}
try{
 for(const [label,Source] of [['original',original],['candidate',candidate]] as const){
  const Cache=Source.Cache;
  run('all RGBA / alpha0 RGB / low alpha / offsets / literal-repeat codec / fresh outputs',label,()=>{
   let seed=137;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;let cases=0;
   for(let sample=0;sample<84;sample++){
    const width=sample<4?[1,3,128,176][sample]!:1+next()%180,height=19;
    const input=new Uint8ClampedArray(width*height*4),words=new Uint32Array(input.buffer);
    for(let i=0;i<words.length;){const n=1+next()%9,v=next()%4===0?0:next();words.fill(v,i,Math.min(words.length,i+n));i+=n;}
    if(input.length>=8){input.set([231,19,67,0],0);input.set([9,3,2,1],4);}
    const expected=input.slice(),cache=new Cache();clock(1,()=>cache.put('rgba',input,width,height),2);ownership(cache);
    const decoded=get(cache,'rgba')!;assert.deepEqual(decoded,expected);assert.notEqual(decoded.buffer,input.buffer);
    decoded.fill(77);input.fill(0);assert.deepEqual(get(cache,'rgba'),expected);ownership(cache);cache.clear();assert.equal(ownership(cache).ownedBytes,0);cases++;
   }
   const offset=new Uint8ClampedArray(new ArrayBuffer(17),1,16);offset.set([1,2,3,0,4,5,6,1,4,5,6,1,4,5,6,1]);
   const cache=new Cache();clock(1,()=>cache.put('unaligned',offset,2,2),2);assert.deepEqual(get(cache,'unaligned'),offset);cache.clear();ownership(cache);
   return{roundtrips:cases+1,alphaZeroRGBIncluded:true};
  });
  run('byte budget, LRU, 1024 metadata cap and original put preflight/early returns',label,()=>{
   const cache=new Cache(50);for(const key of ['a','b','c'])put(cache,key);
   assert.deepEqual(get(cache,'a'),raw);put(cache,'d');assert.equal(get(cache,'b'),undefined);assert.deepEqual(get(cache,'a'),raw);ownership(cache);
   const before=cache.stats();clock(100,()=>cache.put('a',new Uint8ClampedArray(4),1,1,999),0);assert.deepEqual(cache.stats(),before);
   cache.clear();const blank=new Uint8ClampedArray(4);for(let i=0;i<1100;i++)clock(1,()=>cache.put(String(i),blank,1,1),2);
   assert.equal(ownership(cache).entries,1024);assert.equal(get(cache,'0'),undefined);assert.deepEqual(get(cache,'1099'),blank);
   const disabled=new Cache(0);clock(9,()=>disabled.put('x',raw,1,1),0);assert.equal(ownership(disabled).ownedBytes,0);
   const spansTooBig=new Cache(1);clock(2,()=>spansTooBig.put('x',raw,1,1),2);assert.equal(ownership(spansTooBig).bytes,0);assert.equal(spansTooBig.stats().workMs,2);
   const encodedTooBig=new Cache(17),literal=new Uint8ClampedArray([1,2,3,4,5,6,7,8]);clock(3,()=>encodedTooBig.put('x',literal,2,1),2);
   assert.equal(ownership(encodedTooBig).bytes,0);assert.equal(encodedTooBig.stats().workMs,3);assert.ok(encodedTooBig.stats().scratchBytes!>0);encodedTooBig.clear();assert.equal(ownership(encodedTooBig).ownedBytes,0);
   cache.clear();return{entriesAfterClear:ownership(cache).entries};
  });
  run('pure scanning backoff drops all bytes; zero scratch and unchanged bypass length',label,()=>{
   const {cache,requests}=scan(Cache,'none');const stats=ownership(cache);assert.equal(stats.ownedBytes,0);
   assert.equal(get(cache,'cold:0'),undefined);assert.equal(cache.stats().bypassRequests,4095);cache.clear();return{requests,atTrigger:stats};
  });
  run('natural last-lookup put boundary and clear / second life / cumulative counters',label,()=>{
   const {cache}=scan(Cache,'none');const after=cache.stats();
   clock(100,()=>cache.put('blocked',raw,1,1,99),0);assert.deepEqual(cache.stats(),after);
   for(let i=0;i<4095;i++)assert.equal(get(cache,'absent'),undefined);
   assert.equal(cache.stats().bypassRequests,1);clock(100,()=>cache.put('penultimate',raw,1,1),0);
   assert.equal(get(cache,'last'),undefined);assert.equal(cache.stats().bypassRequests,0);
   clock(1,()=>cache.put('last',raw,1,1,10),2);assert.deepEqual(get(cache,'last'),raw);ownership(cache);
   const lifetime=cache.stats();cache.clear();const empty=ownership(cache);assert.equal(empty.ownedBytes,0);assert.equal(empty.bypassRequests,0);assert.equal(empty.backoffs,0);
   for(const key of ['hits','misses','evictions','workMs','avoidedPaintMs'])assert.equal(empty[key],lifetime[key]);
   assert.equal(internal(cache).windowWorkMs,0);assert.equal(internal(cache).windowSavedMs,0);assert.equal(internal(cache).churnBytes,0);
   put(cache,'second-life',10);assert.deepEqual(get(cache,'second-life'),raw);ownership(cache);cache.clear();return{lifetime,secondLifePassed:true};
  });
  run('encoding exception propagates unchanged through timed finally; decode failure is not successful reuse',label,()=>{
   const cache=new Cache(),sentinel=new Error('injected input access');
   const bad=new Proxy(raw,{get(target,key){if(key==='byteOffset')throw sentinel;return Reflect.get(target,key,target);}});
   assert.throws(()=>clock(2,()=>cache.put('bad',bad,1,1),2),error=>error===sentinel);
   assert.equal(cache.stats().workMs,2);assert.equal(internal(cache).windowWorkMs,2);assert.equal(ownership(cache).entries,0);
   put(cache,'recover');const entry=internal(cache).entries.get('recover')!,reuses=entry.reuses;
   const Constructor=globalThis.Uint8ClampedArray;
   try{
    globalThis.Uint8ClampedArray=new Proxy(Constructor,{construct(){throw sentinel;}});
    assert.throws(()=>clock(.125,()=>cache.get('recover'),1),error=>error===sentinel);
   }finally{globalThis.Uint8ClampedArray=Constructor;}
   assert.equal(entry.reuses,reuses);ownership(cache);assert.deepEqual(get(cache,'recover'),raw);cache.clear();return{sameErrorObject:true};
  });
 }
 run('useful survivor is intentionally different from original release-all', 'paired',()=>{
  const A=scan(original.Cache,'useful'),B=scan(candidate.Cache,'useful');assert.equal(A.requests,B.requests);
  assert.equal(ownership(A.cache).ownedBytes,0);assert.equal(get(A.cache,'hot'),undefined);
  const before=ownership(B.cache);assert.equal(before.retainedAtBackoff,1);assert.equal(before.retainedBytesAtBackoff,16);assert.equal(before.bytes,16);assert.equal(before.scratchBytes,0);
  assert.deepEqual(get(B.cache,'hot'),raw);const after=ownership(B.cache);assert.equal(after.backoffHits,1);assert.equal(after.bypassRequests,4095);
  assert.equal(after.workMs!-before.workMs!,.125);assert.equal(after.avoidedPaintMs!-before.avoidedPaintMs!,.25);
  assert.equal(internal(B.cache).windowWorkMs,0);assert.equal(internal(B.cache).windowSavedMs,0);
  const survivor=internal(B.cache).entries.get('hot')!;assert.ok(survivor.reuses!>0);assert.equal(survivor.maxDecodeMs,.125);
  clock(99,()=>B.cache.put('hot',new Uint8ClampedArray(4),1,1,999),0);assert.deepEqual(get(B.cache,'hot'),raw);
  const cumulative=B.cache.stats();A.cache.clear();B.cache.clear();assert.equal(ownership(B.cache).ownedBytes,0);
  assert.equal(B.cache.stats().backoffHits,cumulative.backoffHits);assert.equal(B.cache.stats().backoffDrops,cumulative.backoffDrops);assert.equal(B.cache.stats().retainedAtBackoff,0);assert.equal(B.cache.stats().retainedBytesAtBackoff,0);
  return{originalAtTrigger:A.requests,candidateAtTrigger:B.requests,retained:before,afterHit:after};
 });
 run('reused but expensive decode is not retained','candidate',()=>{
  const {cache}=scan(candidate.Cache,'slow');assert.equal(ownership(cache).ownedBytes,0);assert.equal(cache.stats().retainedAtBackoff,0);assert.equal(get(cache,'hot'),undefined);cache.clear();
 });
 run('paused survivor returns correct bytes on costly hit before dropping itself','candidate',()=>{
  const {cache}=scan(candidate.Cache,'useful'),before=cache.stats();const rgba=get(cache,'hot',.5);assert.deepEqual(rgba,raw);
  const after=ownership(cache);assert.equal(after.backoffDrops,before.backoffDrops!+1);assert.equal(after.backoffHits,1);assert.equal(after.ownedBytes,0);assert.equal(after.bypassRequests,4095);
  assert.equal(get(cache,'hot'),undefined);assert.equal(cache.stats().bypassRequests,4094);assert.deepEqual(rgba,raw);cache.clear();return{before,after};
 });
 run('surviving hits update LRU and consume the full pause; recovery-only window remains empty','candidate',()=>{
  const {cache}=scan(candidate.Cache,'useful');
  for(let i=0;i<4096;i++)assert.deepEqual(get(cache,'hot'),raw);
  assert.equal(cache.stats().bypassRequests,0);assert.equal(cache.stats().backoffHits,4096);
  assert.equal(internal(cache).windowWorkMs,0);assert.equal(internal(cache).windowSavedMs,0);assert.equal(cache.stats().scratchBytes,0);
  const before=cache.stats();clock(99,()=>cache.put('hot',new Uint8ClampedArray(4),1,1,999),0);assert.deepEqual(cache.stats(),before);
  for(const key of ['a','b','c'])put(cache,key);assert.deepEqual(get(cache,'hot'),raw);put(cache,'d');assert.equal(get(cache,'a'),undefined);assert.deepEqual(get(cache,'hot'),raw);
  ownership(cache);cache.clear();assert.equal(ownership(cache).ownedBytes,0);return{backoffHits:4096};
 });
}finally{
 if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete (performance as unknown as Record<string,unknown>).now;
}
const sourceStable=sha(await readFile(original.file))===original.sha256&&sha(await readFile(candidate.file))===candidate.sha256;
const result={mode:'deterministic semantics; mock time only, no performance claim',original:{file:original.file,sha256:original.sha256},candidate:{file:candidate.file,sha256:candidate.sha256},scriptSha256:sha(await readFile(new URL(import.meta.url))),sourceStable,passed:sourceStable&&report.every(row=>row.passed),cases:report};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,passed:result.passed,cases:report.length,failures:report.filter(row=>!row.passed).map(row=>({name:row.name,error:row.error}))}));
if(!result.passed)process.exitCode=1;
