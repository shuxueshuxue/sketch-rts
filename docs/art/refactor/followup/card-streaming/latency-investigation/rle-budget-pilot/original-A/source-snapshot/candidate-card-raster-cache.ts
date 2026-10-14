/** Lossless CPU recovery of expensive cards evicted from the smaller GPU cache.
 * Only zero RGBA padding is omitted. No resampling, filtering or alpha cutoff. */
type Raster={width:number;height:number;spans:Uint32Array;pixels:Uint32Array;bytes:number;paintMs:number};
export class CardRasterCache {
 private entries=new Map<string,Raster>();
 // FIFO of first put observations; no source pixels or estimated byte claims.
 private probation=new Map<string,true>();
 private admissionSkips=0;
 private admitted=0;
 private bytes=0;
 private scratch=new Uint32Array(0);
 private hits=0;
 private misses=0;
 private evictions=0;
 private bypass=0;
 private backoffs=0;
 private churnBytes=0;
 private windowWorkMs=0;
 private windowSavedMs=0;
 private workMs=0;
 private savedMs=0;
 constructor(private budget=16*1024*1024){}
 get(key:string){
  if(this.bypass>0){this.bypass--;this.misses++;return undefined;}
  const entry=this.entries.get(key);if(!entry){this.misses++;return undefined;}
  const start=performance.now();this.hits++;this.entries.delete(key);this.entries.set(key,entry);
  const rgba=new Uint8ClampedArray(entry.width*entry.height*4),words=new Uint32Array(rgba.buffer);let source=0;
  for(let i=0;i<entry.spans.length;i+=2){
   let destination=entry.spans[i]!/4;const end=destination+entry.spans[i+1]!/4;
   while(destination<end){const code=entry.pixels[source++]!,count=code&0x7fffffff;
    if(code>>>31)words.fill(entry.pixels[source++]!,destination,destination+count);
    else{words.set(entry.pixels.subarray(source,source+count),destination);source+=count;}
    destination+=count;
   }
  }
  const work=performance.now()-start;this.workMs+=work;this.windowWorkMs+=work;this.savedMs+=entry.paintMs;this.windowSavedMs+=entry.paintMs;
  return rgba;
 }
 put(key:string,rgba:Uint8ClampedArray,width:number,height:number,paintMs=0){
  if(this.bypass>0||!this.budget||this.entries.has(key))return;
  // put is reached only after an actual provider miss and fresh paint/readback.
  // Count that observation, not speculative get requests or retained RGBA.
  if(!this.probation.delete(key)){
   if(this.probation.size>=1024)this.probation.delete(this.probation.keys().next().value!);
   this.probation.set(key,true);this.admissionSkips++;return;
  }
  const start=performance.now();try{
  const words=new Uint32Array(rgba.byteOffset%4===0?rgba.buffer:rgba.slice().buffer,rgba.byteOffset%4===0?rgba.byteOffset:0,rgba.byteLength/4);
  const nonzero=(pixel:number)=>words[pixel]!==0;
  const spans:number[]=[];let count=0;
  for(let y=0;y<height;y++){
   const row=y*width;let left=0,right=width-1;
   while(left<width&&!nonzero(row+left))left++;
   if(left===width)continue;
   while(right>left&&!nonzero(row+right))right--;
   const length=(right-left+1)*4;spans.push((row+left)*4,length);count+=length;
  }
  if(spans.length*8>this.budget)return;
  const capacity=count/4+spans.length/2;
  if(this.scratch.length<capacity)this.scratch=new Uint32Array(2**Math.ceil(Math.log2(capacity)));
  let written=0;
  for(let i=0;i<spans.length;i+=2){
   let cursor=spans[i]!/4;const end=cursor+spans[i+1]!/4;
   while(cursor<end){
    let run=1;while(cursor+run<end&&words[cursor+run]===words[cursor])run++;
    if(run>=3){this.scratch[written++]=(run|0x80000000)>>>0;this.scratch[written++]=words[cursor]!;cursor+=run;}
    else{
     const first=cursor;cursor+=run;
     while(cursor<end){if(cursor+2<end&&words[cursor]===words[cursor+1]&&words[cursor]===words[cursor+2])break;cursor++;}
     this.scratch[written++]=cursor-first;this.scratch.set(words.subarray(first,cursor),written);written+=cursor-first;
    }
   }
  }
  const bytes=written*4+spans.length*4;if(bytes>this.budget)return;
  while(this.bytes+bytes>this.budget&&this.entries.size){const oldest=this.entries.keys().next().value!,entry=this.entries.get(oldest)!;this.bytes-=entry.bytes;this.churnBytes+=entry.bytes;this.entries.delete(oldest);this.evictions++;}
  // Also bound metadata for empty or tiny entries.
  if(this.entries.size>=1024){const oldest=this.entries.keys().next().value!;this.churnBytes+=this.entries.get(oldest)!.bytes;this.bytes-=this.entries.get(oldest)!.bytes;this.entries.delete(oldest);this.evictions++;}
  const pixels=this.scratch.slice(0,written);
  this.entries.set(key,{width,height,spans:new Uint32Array(spans),pixels,bytes,paintMs});this.bytes+=bytes;this.admitted++;
  }finally{
   const work=performance.now()-start;this.workMs+=work;this.windowWorkMs+=work;
   // After two complete turnovers, keep paying for compression only when
   // measured avoided drawing work pays for encoding and reconstruction.
   if(this.churnBytes>=this.budget*2&&this.windowSavedMs<this.windowWorkMs){
    this.release();this.bypass=Math.min(16384,4096*2**this.backoffs);this.backoffs++;
    this.churnBytes=this.windowWorkMs=this.windowSavedMs=0;
   }
  }
 }
 private release(){this.probation.clear();this.entries.clear();this.bytes=0;this.scratch=new Uint32Array(0);}
 clear(){this.release();this.bypass=this.backoffs=this.churnBytes=this.windowWorkMs=this.windowSavedMs=0;}
 stats(){return{admissionSkips:this.admissionSkips,admitted:this.admitted,probationEntries:this.probation.size,backoffs:this.backoffs,bypassRequests:this.bypass,workMs:this.workMs,avoidedPaintMs:this.savedMs,bytes:this.bytes,scratchBytes:this.scratch.byteLength,ownedBytes:this.bytes+this.scratch.byteLength,entries:this.entries.size,hits:this.hits,misses:this.misses,evictions:this.evictions,budget:this.budget};}
}
