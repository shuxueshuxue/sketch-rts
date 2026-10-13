/** Static-prepared deterministic test runner; no Canvas or measured timing.
 * node --import tsx scripts/art-card-rle-twohit-budget-semantics.ts --original FILE --candidate FILE --out FILE.json */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
type Cache={get(k:string):Uint8ClampedArray|undefined;put(k:string,a:Uint8ClampedArray,w:number,h:number,p?:number):void;clear():void;stats():Record<string,number>};
type Class=new(budget?:number)=>Cache;
type Internal={entries:Map<string,{bytes:number;pixels:Uint32Array;spans:Uint32Array}>;scratch:Uint32Array;probation:Map<string,true>};
const arg=(k:string)=>{const i=process.argv.indexOf(k);return i<0?undefined:process.argv[i+1];};
const a=arg('--original'),b=arg('--candidate');if(!a||!b)throw new Error('--original and --candidate required');
const sha=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex');
async function load(p:string){const file=resolve(p),data=await readFile(file),m=await import(pathToFileURL(file).href);const C=m.CardRasterCache??m.default?.CardRasterCache;assert.equal(typeof C,'function');return{file,sha256:sha(data),C:C as Class};}
const A=await load(a),B=await load(b),output=resolve(arg('--out')??'/tmp/rle-twohit-budget-semantics.json');
const results:{name:string;implementation:string;passed:boolean;details?:unknown;error?:string}[]=[];
const descriptor=Object.getOwnPropertyDescriptor(performance,'now');let base=0,cost=0,calls=0;
Object.defineProperty(performance,'now',{configurable:true,value:()=>base+calls++*cost});
function timed<T>(body:()=>T,n?:number,ms=1){base+=32;cost=ms;calls=0;try{return body();}finally{if(n!==undefined)assert.equal(calls,n,'clock calls');}}
const pixel=new Uint8ClampedArray([1,2,3,255]);
const offer=(c:Cache,k:string,x=pixel,w=1,h=1,p=0,n?:number)=>timed(()=>c.put(k,x,w,h,p),n);
const lookup=(c:Cache,k:string)=>timed(()=>c.get(k),undefined,.125);
function store(c:Cache,k:string,two:boolean,x=pixel,w=1,h=1,p=0){if(two)offer(c,k,x,w,h,p,0);offer(c,k,x,w,h,p,2);}
function owns(c:Cache,two:boolean){
 const i=c as unknown as Internal,s=c.stats();let bytes=0;
 for(const e of i.entries.values()){assert.equal(e.bytes,e.pixels.byteLength+e.spans.byteLength);bytes+=e.bytes;}
 assert.equal(s.bytes,bytes);assert.equal(s.scratchBytes,i.scratch.byteLength);assert.equal(s.ownedBytes,bytes+i.scratch.byteLength);assert.equal(s.entries,i.entries.size);assert.ok(bytes<=s.budget!);assert.ok(i.entries.size<=1024);
 if(two){assert.equal(s.probationEntries,i.probation.size);assert.ok(i.probation.size<=1024);for(const v of i.probation.values())assert.equal(v,true,'ghost never holds RGBA');}
 return s;
}
function test(name:string,implementation:string,fn:()=>unknown){try{results.push({name,implementation,passed:true,details:fn()});}catch(e){results.push({name,implementation,passed:false,error:e instanceof Error?e.stack:String(e)});}}
try{
 test('different default budgets: original 48MiB, candidate 16MiB; explicit zero/64 unchanged','both',()=>{
  const budgets:Record<string,number[]>={};
  for(const [label,source,two,expected] of [['original',A,false,48*1024*1024],['candidate',B,true,16*1024*1024]] as const){
   const defaultCache=new source.C();assert.equal(owns(defaultCache,two).budget,expected);defaultCache.clear();
   budgets[label]=[expected];
   for(const budget of [0,64]){const c=new source.C(budget);assert.equal(owns(c,two).budget,budget);c.clear();assert.equal(owns(c,two).ownedBytes,0);budgets[label]!.push(budget);}
  }
  return{budgets,comparison:'admission plus default-budget change, not equal-budget ablation'};
 });
 for(const [label,source,two] of [['original',A,false],['candidate',B,true]] as const){
  test('codec all RGBA, transparent RGB, low alpha, literal/run, row offset, unaligned source, independent outputs',label,()=>{
   let seed=137;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   for(let sample=0;sample<84;sample++){
    const w=sample<4?[1,3,128,176][sample]!:1+next()%180,h=19,x=new Uint8ClampedArray(w*h*4),words=new Uint32Array(x.buffer);
    for(let n=0;n<words.length;){const len=1+next()%9,v=next()%4===0?0:next();words.fill(v,n,Math.min(words.length,n+len));n+=len;}
    x.set([77,9,111,0]);if(x.length>=8)x.set([6,4,5,1],4);const saved=x.slice(),c=new source.C();store(c,'x',two,x,w,h);
    const got=lookup(c,'x')!;assert.deepEqual(got,saved);assert.notEqual(got.buffer,x.buffer);got.fill(55);x.fill(0);assert.deepEqual(lookup(c,'x'),saved);owns(c,two);c.clear();assert.equal(owns(c,two).ownedBytes,0);
   }
   const x=new Uint8ClampedArray(new ArrayBuffer(17),1,16);x.fill(129);x[3]=0;const c=new source.C();store(c,'offset',two,x,2,2);assert.deepEqual(lookup(c,'offset'),x);c.clear();return{roundtrips:85};
  });
  test('encoded-entry LRU and actual byte budget/1024 entry bounds remain',label,()=>{
   const c=new source.C(50);for(const k of ['a','b','c'])store(c,k,two);assert.deepEqual(lookup(c,'a'),pixel);store(c,'d',two);assert.equal(lookup(c,'b'),undefined);assert.deepEqual(lookup(c,'a'),pixel);owns(c,two);
   const before=c.stats();offer(c,'a',new Uint8ClampedArray(4),1,1,99,0);assert.deepEqual(c.stats(),before);c.clear();
   const empty=new Uint8ClampedArray(4);for(let n=0;n<1100;n++)store(c,String(n),two,empty);assert.equal(owns(c,two).entries,1024);assert.equal(lookup(c,'0'),undefined);assert.deepEqual(lookup(c,'1099'),empty);c.clear();assert.equal(owns(c,two).ownedBytes,0);
  });
  test('zero budget off; both oversized exits retain original timed-finally behavior',label,()=>{
   const off=new source.C(0);offer(off,'x',pixel,1,1,0,0);offer(off,'x',pixel,1,1,0,0);assert.equal(owns(off,two).ownedBytes,0);if(two)assert.equal(off.stats().probationEntries,0);
   for(const [budget,x,w] of [[1,pixel,1],[17,new Uint8ClampedArray([1,2,3,4,5,6,7,8]),2]] as const){
    const c=new source.C(budget);store(c,'big',two,x,w);assert.equal(owns(c,two).entries,0);assert.equal(c.stats().workMs,1);if(two)assert.equal(c.stats().admitted,0);c.clear();assert.equal(owns(c,two).ownedBytes,0);
   }
  });
  test('real admitted scan triggers unchanged backoff; last get permits put; clear and second life',label,()=>{
   const c=new source.C(64);for(let n=0;c.stats().backoffs===0&&n<100;n++)store(c,`scan:${n}`,two);
   assert.equal(c.stats().backoffs,1);assert.equal(c.stats().bypassRequests,4096);assert.equal(owns(c,two).ownedBytes,0);if(two)assert.equal(c.stats().probationEntries,0);
   const before=c.stats();offer(c,'paused',pixel,1,1,10,0);assert.deepEqual(c.stats(),before);
   for(let n=0;n<4095;n++)assert.equal(lookup(c,'absent'),undefined);assert.equal(c.stats().bypassRequests,1);offer(c,'last',pixel,1,1,10,0);assert.equal(lookup(c,'last'),undefined);assert.equal(c.stats().bypassRequests,0);
   if(two){offer(c,'last',pixel,1,1,10,0);assert.equal(c.stats().probationEntries,1);assert.equal(c.stats().entries,0);}
   offer(c,'last',pixel,1,1,10,2);assert.deepEqual(lookup(c,'last'),pixel);
   if(two)offer(c,'unconfirmed',pixel,1,1,0,0);const lifetime=c.stats();c.clear();const after=owns(c,two);assert.equal(after.ownedBytes,0);assert.equal(after.bypassRequests,0);assert.equal(after.backoffs,0);if(two)assert.equal(after.probationEntries,0);
   for(const k of ['hits','misses','evictions','workMs','avoidedPaintMs',...(two?['admissionSkips','admitted']:[])])assert.equal(after[k],lifetime[k]);
   store(c,'secondlife',two,pixel,1,1,10);assert.deepEqual(lookup(c,'secondlife'),pixel);c.clear();return{lifetime};
  });
  test('encoding and decode exceptions propagate; no source retention or false admitted count',label,()=>{
   const c=new source.C(),error=new Error('source access'),bad=new Proxy(pixel,{get(t,k){if(k==='byteOffset')throw error;return Reflect.get(t,k,t);}});
   if(two)offer(c,'bad',bad,1,1,0,0);assert.throws(()=>offer(c,'bad',bad,1,1,0,2),e=>e===error);assert.equal(c.stats().workMs,1);assert.equal(owns(c,two).entries,0);if(two){assert.equal(c.stats().admitted,0);assert.equal(c.stats().probationEntries,0);}
   store(c,'valid',two);const real=globalThis.Uint8ClampedArray;
   try{globalThis.Uint8ClampedArray=new Proxy(real,{construct(){throw error;}});assert.throws(()=>lookup(c,'valid'),e=>e===error);}finally{globalThis.Uint8ClampedArray=real;}
   assert.deepEqual(lookup(c,'valid'),pixel);owns(c,two);c.clear();
  });
 }
 test('first put stores key only; second put stores CURRENT RGBA, not first; get alone never admits','candidate',()=>{
  const c=new B.C(),first=pixel.slice();offer(c,'key',first,1,1,999,0);first.fill(77);const current=new Uint8ClampedArray([7,4,19,0]);
  for(let n=0;n<20;n++)assert.equal(lookup(c,'key'),undefined);assert.equal(c.stats().admissionSkips,1);assert.equal(c.stats().admitted,0);assert.equal(owns(c,true).ownedBytes,0);
  offer(c,'key',current,1,1,3,2);const expected=current.slice();current.fill(0);assert.deepEqual(lookup(c,'key'),expected);assert.equal(c.stats().admitted,1);assert.equal(c.stats().probationEntries,0);owns(c,true);c.clear();
 });
 test('1024 ghost FIFO bound; misses do not refresh order; evicted ghosts need two new puts','candidate',()=>{
  const c=new B.C();for(let n=0;n<1024;n++)offer(c,String(n),pixel,1,1,0,0);assert.equal(owns(c,true).ownedBytes,0);assert.equal(c.stats().probationEntries,1024);
  for(let n=0;n<10;n++)assert.equal(lookup(c,'0'),undefined);offer(c,'1024',pixel,1,1,0,0);
  assert.equal((c as unknown as Internal).probation.has('0'),false);assert.equal((c as unknown as Internal).probation.has('1'),true);
  offer(c,'0',pixel,1,1,0,0);assert.equal((c as unknown as Internal).probation.has('1'),false);assert.equal(c.stats().entries,0);
  offer(c,'0',pixel,1,1,0,2);assert.deepEqual(lookup(c,'0'),pixel);assert.equal(c.stats().probationEntries,1023);owns(c,true);c.clear();assert.equal(c.stats().probationEntries,0);
 });
 test('pure single-observation pollution encodes nothing and keeps only bounded ghost keys','candidate',()=>{
  const c=new B.C();for(let n=0;n<3000;n++){assert.equal(lookup(c,String(n)),undefined);offer(c,String(n),pixel,1,1,0,0);}
  assert.equal(c.stats().admissionSkips,3000);assert.equal(c.stats().admitted,0);assert.equal(c.stats().probationEntries,1024);assert.equal(c.stats().backoffs,0);assert.equal(owns(c,true).ownedBytes,0);c.clear();assert.equal(c.stats().probationEntries,0);
 });
 test('backoff releases unrelated pending ghosts and clear consumes no later scene admission','candidate',()=>{
  const c=new B.C(64);offer(c,'pending',pixel,1,1,0,0);
  for(let n=0;c.stats().backoffs===0&&n<100;n++)store(c,`churn:${n}`,true);
  assert.equal(c.stats().backoffs,1);assert.equal(c.stats().probationEntries,0);const admitted=c.stats().admitted;c.clear();offer(c,'pending',pixel,1,1,0,0);assert.equal(c.stats().admitted,admitted);
  assert.equal(c.stats().entries,0);assert.equal(c.stats().probationEntries,1);c.clear();assert.equal(owns(c,true).ownedBytes,0);
 });
}finally{if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete (performance as unknown as Record<string,unknown>).now;}
const sourceStable=sha(await readFile(A.file))===A.sha256&&sha(await readFile(B.file))===B.sha256;
const result={mode:'deterministic mock costs; no timing or memory-RSS claim',original:{file:A.file,sha256:A.sha256},candidate:{file:B.file,sha256:B.sha256},scriptSha256:sha(await readFile(new URL(import.meta.url))),sourceStable,passed:sourceStable&&results.every(r=>r.passed),cases:results};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,passed:result.passed,cases:results.length,failures:results.filter(r=>!r.passed)}));if(!result.passed)process.exitCode=1;
