// Independent CPU micro protocol shared verbatim by Node and Chromium.
// No production imports, Canvas, WebGL, GPU calls, or automatic execution.
export function maskCoverage(image){
 const {rgba,width,height}=image,pixels=width*height;
 let zeroAlphaPixels=0,pickablePixels=0,transparentRgbPixels=0,zeroAlphaBlocks=0;
 for(let p=0;p<pixels;p++){
  const i=p*4,alpha=rgba[i+3];zeroAlphaPixels+=Number(alpha===0);pickablePixels+=Number(alpha>=102);
  if(alpha===0&&(rgba[i]||rgba[i+1]||rgba[i+2]))transparentRgbPixels++;
 }
 const totalBlocks=width%8===0?pixels/8:0;
 if(totalBlocks)for(let p=0;p<pixels;p+=8){let alpha=0;for(let i=0;i<8;i++)alpha|=rgba[(p+i)*4+3];zeroAlphaBlocks+=Number(alpha===0);}
 return{pixels,sourceBytes:rgba.byteLength,maskBytes:Math.ceil(pixels/8),byteOffset:rgba.byteOffset,
  zeroAlphaPixels,zeroAlphaFraction:zeroAlphaPixels/pixels,pickablePixels,pickableFraction:pickablePixels/pixels,
  transparentRgbPixels,totalBlocks,zeroAlphaBlocks,zeroAlphaBlockFraction:totalBlocks?zeroAlphaBlocks/totalBlocks:null};
}

function stats(samples,calls){
 const ordered=samples.map(sample=>sample.elapsedMs).sort((a,b)=>a-b),meanMs=ordered.reduce((a,b)=>a+b,0)/ordered.length;
 return{samples:ordered.length,meanMs,p50Ms:ordered[Math.floor(ordered.length*.5)],p95Ms:ordered[Math.min(ordered.length-1,Math.floor(ordered.length*.95))],maxMs:ordered.at(-1),
  meanMsPerMask:meanMs/calls,firstMeasuredRoundMs:samples[0].elapsedMs};
}

function corpusGroups(images,cutoff){
 const sparse=[],dense=[];for(const image of images)(image.coverage.zeroAlphaBlockFraction>=cutoff?sparse:dense).push(image);
 return[
  {name:'aggregate',kind:'aggregate',images},
  {name:'sparse',kind:'coverage',criterion:`zero-alpha eight-pixel block fraction >= ${cutoff}`,images:sparse},
  {name:'dense',kind:'coverage',criterion:`zero-alpha eight-pixel block fraction < ${cutoff}`,images:dense},
  ...images.map(image=>({name:`asset:${image.index}`,kind:'asset',images:[image]})),
 ];
}

export async function runMaskMatrix(prototype,inputs,{rounds=8,repeats=3,denseCutoff=.5,ringSlots=32}={}){
 if(!inputs.length||!Number.isInteger(rounds)||rounds<8||rounds%8!==0||!Number.isInteger(repeats)||repeats<1||!Number.isInteger(ringSlots)||ringSlots<1||!Number.isFinite(denseCutoff)||denseCutoff<0||denseCutoff>1)throw Error('Invalid mask micro configuration: use a positive multiple of eight rounds');
 const variants=Object.entries(prototype.VARIANTS);
 if(variants.length!==4||!variants.some(([name])=>name==='reference'))throw Error('Expected frozen four-way prototype');
 const semantics=prototype.validateSemantics(),images=inputs.map((image,index)=>({...image,index,coverage:maskCoverage(image)}));
 let exactCorpusComparisons=0;
 // Verify both orientations for every actual full-source sample outside timers.
 for(const image of images)for(const flipY of [false,true]){
  const expected=prototype.referencePack(image.rgba,image.width,image.height,flipY);
  for(const [name,fn] of variants){const actual=fn(image.rgba,image.width,image.height,flipY);
   if(actual.length!==expected.length||actual.some((byte,i)=>byte!==expected[i]))throw Error(`Corpus mask mismatch ${name}/${image.name}/flip${flipY}`);exactCorpusComparisons++;
  }
 }
 const groups=[],ring=new Array(ringSlots);let ringIndex=0,sink=0;
 for(const group of corpusGroups(images,denseCutoff)){
  if(!group.images.length){groups.push({...group,images:[],skipped:true,reason:'No actual source samples in this fixed coverage bin; no synthetic assets substituted.'});continue;}
  const calls=group.images.length*repeats*2,pixels=group.images.reduce((sum,image)=>sum+image.width*image.height,0)*repeats*2;
  const outputBytes=group.images.reduce((sum,image)=>sum+image.coverage.maskBytes,0)*repeats*2;
  const samples=Object.fromEntries(variants.map(([name])=>[name,[]])),schedule=[],positionCounts=Object.fromEntries(variants.map(([name])=>[name,new Array(variants.length).fill(0)]));
  for(let round=0;round<rounds;round++){
   // Rotate the first implementation and alternate forward/reverse. Across
   // eight rounds all four implementations occupy every position equally.
   const start=Math.floor(round/2)%variants.length,rotated=[...variants.slice(start),...variants.slice(0,start)],ordered=round%2?rotated.reverse():rotated;
   schedule.push(ordered.map(([name])=>name));
   for(const [position,[name,fn]] of ordered.entries()){
    positionCounts[name][position]++;
    // Same task boundary for every batch; no forced GC or per-variant pacing.
    await new Promise(done=>setTimeout(done,0));
    const at=performance.now();
    for(let repeat=0;repeat<repeats;repeat++)for(const image of group.images)for(const flipY of [false,true]){
     const mask=fn(image.rgba,image.width,image.height,flipY);
     ring[ringIndex]=mask;ringIndex=(ringIndex+1)%ringSlots;
     sink=(Math.imul(sink^mask[0]^mask[mask.length>>>1]^mask[mask.length-1]^mask.byteLength,16777619))>>>0;
    }
    const elapsedMs=performance.now()-at;
    samples[name].push({round,position,elapsedMs,calls,sourcePixels:pixels,allocatedOutputBytes:outputBytes});
   }
  }
  const summaries=Object.fromEntries(variants.map(([name])=>[name,stats(samples[name],calls)]));
  groups.push({name:group.name,kind:group.kind,criterion:group.criterion,imageIndices:group.images.map(image=>image.index),callsPerSample:calls,sourcePixelsPerSample:pixels,allocatedOutputBytesPerSample:outputBytes,
   schedule,positionCounts,samples,summaries,ratioToReference:Object.fromEntries(variants.map(([name])=>[name,summaries[name].meanMs/summaries.reference.meanMs]))});
 }
 return{
  method:'Mask CPU micro on immutable full original RGBA; no Canvas drawing, GPU work, or frame timing. Same calls, two flips, inputs and output ring per variant; rotate start then forward/reverse. No rounds/outliers/GC samples removed.',
  firstRound:'First measured round after semantic/corpus validation; retained in samples and summaries. Validation can warm JIT, so this is not uninitialized renderer or compiler cold-start.',
  inputOrientations:'Both flipY parameters use the same immutable top-down corpus. The synthetic semantic matrix separately verifies equivalence to row-flipped GPU-oriented recovery bytes; this timing does not claim to benchmark an actual cache-recovery buffer.',
  scope:'Aggregate weights each saved source sample equally, not real frame/miss frequency. Node and Chromium are compared within their own engine; absolute cross-engine times are not speedup evidence.',
  rounds,repeats,denseCutoff,retainedOutputRingSlots:ringSlots,
  allocationScope:'Every call allocates a new mask in the timed function. allocatedOutputBytes is cumulative mask capacity, not total allocations/heap peak; word views share input buffers and still allocate view objects. No input copy occurs inside timers.',
  hostLittleEndian:prototype.HOST_LITTLE_ENDIAN,semantics,exactCorpusComparisons,
  retainedFullRGBABytes:images.reduce((sum,image)=>sum+image.rgba.byteLength,0),
  images:images.map(({rgba,...image})=>image),groups,sink,retainedMaskBytesAtEnd:ring.reduce((sum,mask)=>sum+(mask?.byteLength??0),0),
 };
}
