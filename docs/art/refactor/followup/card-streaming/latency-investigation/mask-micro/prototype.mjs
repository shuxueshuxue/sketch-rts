// Proposal only: no production imports, Canvas, renderer, or automatic execution.
// The reference is the current card-pick-mask.ts algorithm, including flipY.
export function referencePack(rgba,width,height,flipY=true){
 const mask=new Uint8Array(Math.ceil(width*height/8));
 if(width%8===0){
  for(let y=0;y<height;y++){
   let source=y*width*4+3,destination=(flipY?height-1-y:y)*(width/8);
   for(let x=0;x<width;x+=8,source+=32,destination++)mask[destination]=
    Number(rgba[source]>=102)|(Number(rgba[source+4]>=102)<<1)|(Number(rgba[source+8]>=102)<<2)|(Number(rgba[source+12]>=102)<<3)|
    (Number(rgba[source+16]>=102)<<4)|(Number(rgba[source+20]>=102)<<5)|(Number(rgba[source+24]>=102)<<6)|(Number(rgba[source+28]>=102)<<7);
  }
 }else{
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]>=102){const pixel=(flipY?height-1-y:y)*width+x;mask[pixel>>>3]|=1<<(pixel&7);}
 }
 return mask;
}

export const HOST_LITTLE_ENDIAN=new Uint32Array(new Uint8Array([1,0,0,0]).buffer)[0]===1;
const ALPHA_THRESHOLD_WORD=0x66000000;

// This isolates zero-alpha skipping from the word-load proposal. Transparent
// RGB cannot affect skipping; alpha 1..101 does not skip but remains unpickable.
export function byteSkipPack(rgba,width,height,flipY=true){
 if(width%8!==0)return referencePack(rgba,width,height,flipY);
 const mask=new Uint8Array(Math.ceil(width*height/8));
 for(let y=0;y<height;y++){
  let source=y*width*4+3,destination=(flipY?height-1-y:y)*(width/8);
  for(let x=0;x<width;x+=8,source+=32,destination++){
   const a0=rgba[source],a1=rgba[source+4],a2=rgba[source+8],a3=rgba[source+12],a4=rgba[source+16],a5=rgba[source+20],a6=rgba[source+24],a7=rgba[source+28];
   if((a0|a1|a2|a3|a4|a5|a6|a7)===0)continue;
   mask[destination]=Number(a0>=102)|(Number(a1>=102)<<1)|(Number(a2>=102)<<2)|(Number(a3>=102)<<3)|
    (Number(a4>=102)<<4)|(Number(a5>=102)<<5)|(Number(a6>=102)<<6)|(Number(a7>=102)<<7);
  }
 }
 return mask;
}

// Host override exists only for verifying the fallback without BE hardware.
// It does not emulate a BE fast path or change the production proposal.
export function makeWordPack(skipZeroAlpha,littleEndian=HOST_LITTLE_ENDIAN){
 return function wordPack(rgba,width,height,flipY=true){
  const pixels=width*height;
  if(!littleEndian||!Number.isInteger(width)||width<0||!Number.isInteger(height)||height<0||!Number.isSafeInteger(pixels)||width%8!==0||rgba.byteOffset%4!==0||rgba.byteLength<pixels*4)return referencePack(rgba,width,height,flipY);
  // Respect the view's offset and extent. Never read the entire backing buffer.
  const words=new Uint32Array(rgba.buffer,rgba.byteOffset,pixels),mask=new Uint8Array(Math.ceil(pixels/8));
  for(let y=0;y<height;y++){
   let source=y*width,destination=(flipY?height-1-y:y)*(width/8);
   for(let x=0;x<width;x+=8,source+=8,destination++){
    const w0=words[source],w1=words[source+1],w2=words[source+2],w3=words[source+3],w4=words[source+4],w5=words[source+5],w6=words[source+6],w7=words[source+7];
    if(skipZeroAlpha&&((w0|w1|w2|w3|w4|w5|w6|w7)>>>24)===0)continue;
    // Uint32 elements are unsigned numbers. Do not coerce with |0 or compare
    // a signed (word & 0xff000000): alpha>=128 would then be negative.
    mask[destination]=Number(w0>=ALPHA_THRESHOLD_WORD)|(Number(w1>=ALPHA_THRESHOLD_WORD)<<1)|(Number(w2>=ALPHA_THRESHOLD_WORD)<<2)|(Number(w3>=ALPHA_THRESHOLD_WORD)<<3)|
     (Number(w4>=ALPHA_THRESHOLD_WORD)<<4)|(Number(w5>=ALPHA_THRESHOLD_WORD)<<5)|(Number(w6>=ALPHA_THRESHOLD_WORD)<<6)|(Number(w7>=ALPHA_THRESHOLD_WORD)<<7);
   }
  }
  return mask;
 };
}

export const VARIANTS={reference:referencePack,byteSkip:byteSkipPack,words:makeWordPack(false),wordSkip:makeWordPack(true)};

function scalarOracle(rgba,width,height,flipY){
 const result=new Uint8Array(Math.ceil(width*height/8));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(rgba[(y*width+x)*4+3]>=102){const p=(flipY?height-1-y:y)*width+x;result[p>>>3]|=1<<(p&7);}
 }
 return result;
}
function maskHit(mask,width,height,uv){
 if(!uv||!Number.isFinite(uv.x)||!Number.isFinite(uv.y)||uv.x<0||uv.y<0||uv.x>1||uv.y>1)return false;
 const x=Math.min(width-1,Math.floor(uv.x*width)),y=Math.min(height-1,Math.floor(uv.y*height)),p=y*width+x;
 return((mask[p>>>3]??0)&(1<<(p&7)))!==0;
}
function random(seed){let state=seed>>>0;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};}
export function syntheticImage(width,height,pattern='islands',seed=1,offset=0,extra=0){
 const pixels=width*height,backing=new Uint8Array(offset+pixels*4+extra+11);backing.fill(0xa7);
 const rgba=new Uint8ClampedArray(backing.buffer,offset,pixels*4+extra),next=random(seed);
 for(let p=0;p<pixels;p++){
  const r=next(),x=p%width,y=Math.floor(p/width);rgba[p*4]=r&255;rgba[p*4+1]=r>>>8&255;rgba[p*4+2]=r>>>16&255;
  const alpha=pattern==='zero'?0:pattern==='transparentRgb'?0:pattern==='below'?1+(r%101):pattern==='opaque'?255:pattern==='thresholds'?[0,1,100,101,102,103,127,128,254,255][p%10]:pattern==='random'?r>>>24:
   (x>width*.35&&x<width*.65&&y>height*.2&&y<height*.8?r>>>24:0);
  rgba[p*4+3]=alpha;
  if(pattern==='zero')rgba[p*4]=rgba[p*4+1]=rgba[p*4+2]=0;
 }
 return{name:`${pattern}-${width}x${height}-offset${offset}`,width,height,rgba,pattern,backing};
}

export function validateSemantics(){
 const cases=[];
 for(const [width,height] of [[1,1],[2,2],[3,7],[7,3],[8,3],[9,11],[16,13],[176,13],[256,17],[320,5],[352,13],[512,3],[640,7],[704,13]]){
  for(const pattern of ['zero','transparentRgb','below','opaque','thresholds','random','islands'])cases.push(syntheticImage(width,height,pattern,width*97+height));
 }
 for(const offset of [0,1,2,3,4,7,8,15])for(const extra of [0,1,5])cases.push(syntheticImage(16,7,'thresholds',42,offset,extra));
 // All 256 alpha values, with RGB extremes including 101/255RGB and 102/0RGB.
 for(const rgb of [0,255]){
  const image=syntheticImage(16,16,'zero');image.name=`all-alpha-rgb${rgb}`;
  for(let a=0;a<256;a++){image.rgba[a*4]=image.rgba[a*4+1]=image.rgba[a*4+2]=rgb;image.rgba[a*4+3]=a;}cases.push(image);
 }
 const range=syntheticImage(8,1,'opaque',1,4,3);
 for(const length of [0,3,4,31,32,33,35])cases.push({...range,name:`subarray-length${length}`,rgba:range.rgba.subarray(0,length)});
 const boundary=syntheticImage(8,2,'zero');boundary.name='known-threshold-row-bytes';
 [0,101,102,127,128,255,1,100,102,0,0,0,0,0,0,102].forEach((alpha,p)=>{boundary.rgba[p*4+3]=alpha;if(alpha===101)boundary.rgba[p*4]=boundary.rgba[p*4+1]=boundary.rgba[p*4+2]=255;});
 cases.push({...boundary,expectedBytes:{false:[0x3c,0x81],true:[0x81,0x3c]}});
 const lowAlpha=syntheticImage(8,1,'transparentRgb');lowAlpha.name='low-alpha-or-crosses-threshold';[64,32,8,101].forEach((alpha,p)=>lowAlpha.rgba[p*4+3]=alpha);cases.push({...lowAlpha,expectedBytes:{false:[0],true:[0]}});
 for(const [width,height,points,plain,flipped] of [[3,3,[[0,0],[2,0],[2,1],[1,2]],[0xa5,0],[0x62,1]],[9,2,[[8,0],[0,1]],[0,3,0],[1,0,2]]]){
  const image=syntheticImage(width,height,'zero');image.name=`known-continuous-row-bits${width}x${height}`;
  for(const [x,y] of points)image.rgba[(y*width+x)*4+3]=102;cases.push({...image,expectedBytes:{false:plain,true:flipped}});
 }
 const oneHot=syntheticImage(8,8,'zero');oneHot.name='one-bit-per-row';for(let i=0;i<8;i++)oneHot.rgba[(i*8+i)*4+3]=102;cases.push({...oneHot,expectedBytes:{false:[1,2,4,8,16,32,64,128],true:[128,64,32,16,8,4,2,1]}});
 const fallbacks={forcedNonLE:makeWordPack(true,false)},functions={...VARIANTS,...fallbacks};let comparisons=0,uvChecks=0;
 for(const image of cases){
  const before=image.backing.slice();
  for(const flipY of [false,true]){
   const expected=scalarOracle(image.rgba,image.width,image.height,flipY);
   if(image.expectedBytes){const known=image.expectedBytes[flipY];if(expected.length!==known.length||expected.some((byte,i)=>byte!==known[i]))throw Error('Independent known-byte oracle mismatch '+image.name);}
   for(const [name,fn] of Object.entries(functions)){
    const actual=fn(image.rgba,image.width,image.height,flipY);
    if(actual.length!==expected.length)throw Error(`Mask length mismatch ${name}/${image.name}`);
    for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])throw Error(`Mask byte mismatch ${name}/${image.name}/flip${flipY}/byte${i}`);
    // Pixel centers and endpoint/invalid UV are checked against source alpha.
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
     const hit=maskHit(actual,image.width,image.height,{x:(x+.5)/image.width,y:(y+.5)/image.height});
     const sourceY=flipY?image.height-1-y:y;
     if(hit!==(image.rgba[(sourceY*image.width+x)*4+3]>=102))throw Error(`UV mismatch ${name}/${image.name}`);uvChecks++;
    }
    for(const uv of [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:1,y:.5},undefined,{x:NaN,y:0},{x:0,y:Infinity},{x:-.001,y:.5},{x:.5,y:1.001}]){
     if(maskHit(actual,image.width,image.height,uv)!==maskHit(expected,image.width,image.height,uv))throw Error(`Endpoint mismatch ${name}/${image.name}`);uvChecks++;
    }
    comparisons++;
   }
  }
  for(let i=0;i<before.length;i++)if(before[i]!==image.backing[i])throw Error(`Input or subarray sentinel mutated ${image.name}`);
 }
 const source=syntheticImage(176,13,'random',17),flipped=source.rgba.slice();
 for(let y=0;y<source.height;y++)flipped.set(source.rgba.subarray(y*source.width*4,(y+1)*source.width*4),(source.height-1-y)*source.width*4);
 for(const [name,fn] of Object.entries(functions)){
  const plain=fn(source.rgba,source.width,source.height,true),restored=fn(flipped,source.width,source.height,false);
  if(plain.some((byte,i)=>byte!==restored[i]))throw Error(`GPU-oriented recovery mismatch ${name}`);comparisons++;
 }
 return{passed:true,cases:cases.length,comparisons,uvChecks,hostLittleEndian:HOST_LITTLE_ENDIAN,forcedNonLE:'fallback branch only; no BE hardware claim',variants:Object.keys(functions)};
}

function describeImage(image){
 let alphaNonzero=0,pickable=0,zeroAlphaBlocks=0;
 for(let p=0;p<image.width*image.height;p++){const a=image.rgba[p*4+3];alphaNonzero+=Number(a>0);pickable+=Number(a>=102);}
 if(image.width%8===0)for(let p=0;p<image.width*image.height;p+=8){let any=0;for(let i=0;i<8;i++)any|=image.rgba[(p+i)*4+3];zeroAlphaBlocks+=Number(any===0);}
 return{name:image.name,width:image.width,height:image.height,byteOffset:image.rgba.byteOffset,sourceBytes:image.rgba.byteLength,alphaNonzero,pickable,zeroAlphaBlocks};
}
export function syntheticCorpus(){
 const result=[];for(const size of [256,512,704])for(const pattern of ['zero','transparentRgb','islands','opaque','random'])result.push(syntheticImage(size,size,pattern,size));return result;
}
function summary(values){const sorted=[...values].sort((a,b)=>a-b);return{samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:sorted[Math.floor(values.length*.5)],p95Ms:sorted[Math.min(values.length-1,Math.floor(values.length*.95))],maxMs:sorted.at(-1)};}
export function benchmarkMasks(images,{rounds=10,warmups=2,repeats=3}={}){
 if(!images.length||![rounds,warmups,repeats].every(Number.isInteger)||rounds<2||warmups<0||repeats<1)throw Error('Invalid benchmark configuration');
 // Exact old/new corpus validation occurs outside timing, including both flips.
 for(const image of images)for(const flipY of [false,true]){
  const expected=referencePack(image.rgba,image.width,image.height,flipY);
  for(const [name,fn] of Object.entries(VARIANTS)){const mask=fn(image.rgba,image.width,image.height,flipY);if(mask.length!==expected.length||mask.some((byte,i)=>byte!==expected[i]))throw Error(`Corpus mismatch ${name}/${image.name}`);}
 }
 const names=Object.keys(VARIANTS),samples=Object.fromEntries(names.map(name=>[name,[]]));let checksum=0;
 for(let round=-warmups;round<rounds;round++)for(const name of (round%2?[...names].reverse():names)){
  const fn=VARIANTS[name],at=performance.now();
  for(let repeat=0;repeat<repeats;repeat++)for(const image of images)for(const flipY of [false,true]){
   const mask=fn(image.rgba,image.width,image.height,flipY);checksum=(checksum+mask[0]+mask[mask.length>>>1]+mask[mask.length-1])>>>0;
  }
  const elapsed=performance.now()-at;if(round>=0)samples[name].push(elapsed);
 }
 const masksPerSample=images.length*repeats*2,summaries=Object.fromEntries(names.map(name=>[name,{...summary(samples[name]),meanMsPerMask:summary(samples[name]).meanMs/masksPerSample}]));
 return{method:'Independent mask micro only; balanced forward/reverse order, output allocations included, warmup excluded. Setup and semantic checking outside timing. Not frame/GPU timing.',rounds,warmups,repeats,masksPerSample,images:images.map(describeImage),samplesMs:samples,summaries,ratioToReference:Object.fromEntries(names.map(name=>[name,summaries[name].meanMs/summaries.reference.meanMs])),checksum,hostLittleEndian:HOST_LITTLE_ENDIAN};
}
